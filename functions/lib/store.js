// Firestore 저장소. 모든 텍스트는 저장 전에 "사용자별 데이터 키(DEK)"로 암호화한다.
// 기본 등급: 30일 뒤 만료(expireAt, Firestore TTL이 삭제). 다시 언급되면 만료일이 30일 뒤로 밀린다.
// 마스터: expireAt 없음 = 영구 보관.
const crypto = require('crypto');
const { Timestamp } = require('firebase-admin/firestore');
const { aad, newDek, encryptWithKey, decryptWithKey } = require('./crypto');
const C = require('./config');

const DAY = 86400000;

function makeStore(db, keyring) {
  const userRef = (uid) => db.collection('users').doc(uid);
  const expiry = (tier, nowMs) => (tier === 'master' ? null : Timestamp.fromMillis(nowMs + C.BASIC_RETENTION_DAYS * DAY));
  const alive = (data) => !data.expireAt || data.expireAt.toMillis() > Date.now();
  const kst = () => new Intl.DateTimeFormat('en-CA', { timeZone: C.TZ }).format(new Date());

  // ---- 사용자별 데이터 키(DEK) ----
  // 사용자마다 무작위 키를 하나 만들고, 키 보관소(keyring)로 감싸서 사용자 문서에 저장한다.
  // 요청 한 번 안에서는 한 번만 풀고 메모리에 둔다.
  const deks = new Map();
  function dek(uid) {
    if (!deks.has(uid)) {
      const p = (async () => {
        const ref = userRef(uid);
        const s = await ref.get();
        if (s.exists && s.data().dekWrapped) return keyring.unwrap(uid, s.data().dekWrapped);
        const fresh = newDek();
        const wrapped = await keyring.wrap(uid, fresh);
        return db.runTransaction(async (tx) => {
          const s2 = await tx.get(ref);
          if (s2.exists && s2.data().dekWrapped) return keyring.unwrap(uid, s2.data().dekWrapped); // 동시 요청이 먼저 만들었으면 그걸 쓴다
          tx.set(ref, { dekWrapped: wrapped }, { merge: true });
          return fresh;
        });
      })();
      p.catch(() => deks.delete(uid));
      deks.set(uid, p);
    }
    return deks.get(uid);
  }
  const enc = async (uid, col, field, text) => encryptWithKey(await dek(uid), aad(uid, col, field), text);
  const dec = async (uid, col, field, payload) => {
    try {
      return decryptWithKey(await dek(uid), aad(uid, col, field), payload);
    } catch (_) {
      return null; // 변조되었거나 다른 곳에서 복사해 온 데이터는 조용히 건너뛴다
    }
  };

  return {
    async getUser(uid) {
      const ref = userRef(uid);
      const s = await ref.get();
      if (s.exists && s.data().tier) return { tier: s.data().tier };
      await ref.set({ tier: 'basic', createdAt: Date.now() }, { merge: true });
      return { tier: 'basic' };
    },

    async setTier(uid, tier) {
      await userRef(uid).set({ tier, ...(tier === 'master' ? { masterSince: Date.now() } : {}) }, { merge: true });
    },

    // 한 문서에 카운터를 올리고 한도를 넘으면 false. (transaction)
    async _bump(ref, limit, ttlMs) {
      return db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        const n = s.exists ? s.data().count : 0;
        if (n >= limit) return false;
        tx.set(ref, { count: n + 1, expireAt: Timestamp.fromMillis(Date.now() + ttlMs) });
        return true;
      });
    },
    // 1분당 횟수 제한 (연타, 자동화 공격 방어)
    async consumeBurst(uid, max) {
      const minute = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      return this._bump(userRef(uid).collection('usage').doc('m' + minute), max, 3600000);
    },
    // 하루 사용량 (한국 시간 기준)
    async consumeUsage(uid, limit) {
      return this._bump(userRef(uid).collection('usage').doc('d' + kst()), limit, 3 * DAY);
    },
    // 서비스 전체 하루 한도 (계정을 여러 개 만들어 비용을 터뜨리는 공격 방어)
    // 주의: 한 문서에 초당 약 1회까지만 쓸 수 있다. 사용자가 많아지면 분산 카운터로 바꿀 것.
    async consumeGlobal(limit) {
      return this._bump(db.collection('system').doc('usage-' + kst()), limit, 3 * DAY);
    },

    async addMessage(uid, role, text, tier) {
      const now = Date.now();
      const doc = { role, textEnc: await enc(uid, 'messages', 'text', text), ts: now };
      const e = expiry(tier, now);
      if (e) doc.expireAt = e;
      const r = await userRef(uid).collection('messages').add(doc);
      return r.id;
    },

    async recentMessages(uid, n) {
      const snap = await userRef(uid).collection('messages').orderBy('ts', 'desc').limit(n).get();
      const out = [];
      for (const d of snap.docs) {
        const x = d.data();
        if (!alive(x)) continue;
        const text = await dec(uid, 'messages', 'text', x.textEnc);
        if (text !== null) out.push({ id: d.id, role: x.role === 'assistant' ? 'assistant' : 'user', text, ts: x.ts });
      }
      return out.reverse();
    },

    async listMemories(uid, n) {
      const snap = await userRef(uid).collection('memories').orderBy('createdAt', 'desc').limit(n).get();
      const out = [];
      for (const d of snap.docs) {
        const x = d.data();
        if (!alive(x)) continue;
        const text = await dec(uid, 'memories', 'text', x.textEnc);
        if (text === null) continue;
        const reason = x.reasonEnc ? await dec(uid, 'memories', 'reason', x.reasonEnc) : '';
        out.push({ id: d.id, text, reason: reason || '', createdAt: x.createdAt });
      }
      return out;
    },

    async saveMemory(uid, text, reason, tier) {
      const now = Date.now();
      const doc = {
        textEnc: await enc(uid, 'memories', 'text', text),
        reasonEnc: reason ? await enc(uid, 'memories', 'reason', reason) : null,
        createdAt: now,
      };
      const e = expiry(tier, now);
      if (e) doc.expireAt = e;
      const r = await userRef(uid).collection('memories').add(doc);
      return r.id;
    },

    // 다시 언급된 기록은 보관 기간을 처음부터 다시 센다 (기본 등급만).
    async touch(uid, col, id, tier) {
      if (tier !== 'basic' || !['memories', 'messages'].includes(col)) return;
      try {
        await userRef(uid).collection(col).doc(id).update({ expireAt: expiry('basic', Date.now()) });
      } catch (_) {
        /* 이미 삭제된 문서면 무시 */
      }
    },

    async deleteItem(uid, col, id) {
      if (!['memories', 'messages'].includes(col) || !id) return false;
      const ref = userRef(uid).collection(col).doc(id);
      const s = await ref.get();
      if (!s.exists) return false;
      await ref.delete();
      return true;
    },

    async addTodo(uid, text, due) {
      const r = await userRef(uid)
        .collection('todos')
        .add({ textEnc: await enc(uid, 'todos', 'text', text), due: due || null, done: false, createdAt: Date.now() });
      return r.id;
    },

    async listTodos(uid) {
      const snap = await userRef(uid).collection('todos').orderBy('createdAt', 'desc').limit(100).get();
      const out = [];
      for (const d of snap.docs) {
        const x = d.data();
        if (x.done) continue;
        const text = await dec(uid, 'todos', 'text', x.textEnc);
        if (text !== null) out.push({ id: d.id, text, due: x.due });
      }
      return out;
    },

    async completeTodo(uid, id) {
      if (!id) return false;
      const ref = userRef(uid).collection('todos').doc(id);
      const s = await ref.get();
      if (!s.exists) return false;
      await ref.update({ done: true });
      return true;
    },

    // ---- 설정(prefs): 사는 도시, 기상 시간 같은 고정 정보. key는 평문(영문 소문자), 값은 암호화 ----
    async getPrefs(uid) {
      const snap = await userRef(uid).collection('prefs').limit(C.MAX_PREFS + 5).get();
      const out = {};
      for (const d of snap.docs) {
        const v = await dec(uid, 'prefs', d.id, d.data().valueEnc);
        if (v !== null) out[d.id] = v;
      }
      return out;
    },
    // 반환: 'ok' | 'full'. 값이 비면 삭제.
    async setPref(uid, key, value) {
      const ref = userRef(uid).collection('prefs').doc(key);
      if (!value) {
        await ref.delete();
        return 'ok';
      }
      const s = await ref.get();
      if (!s.exists) {
        const cnt = (await userRef(uid).collection('prefs').count().get()).data().count;
        if (cnt >= C.MAX_PREFS) return 'full';
      }
      await ref.set({ valueEnc: await enc(uid, 'prefs', key, value), updatedAt: Date.now() });
      return 'ok';
    },

    // ---- 루틴(프로토콜): 이름과 단계 모두 암호화. 문서 id는 이름의 해시라 같은 이름이면 덮어쓴다 ----
    async listRoutines(uid) {
      const snap = await userRef(uid).collection('routines').limit(C.MAX_ROUTINES + 5).get();
      const out = [];
      for (const d of snap.docs) {
        const name = await dec(uid, 'routines', 'name', d.data().nameEnc);
        const steps = await dec(uid, 'routines', 'steps', d.data().stepsEnc);
        if (name !== null && steps !== null) out.push({ id: d.id, name, steps });
      }
      return out;
    },
    async saveRoutine(uid, name, steps) {
      const id = crypto.createHmac('sha256', await dek(uid)).update(name.toLowerCase()).digest('hex').slice(0, 24);
      const ref = userRef(uid).collection('routines').doc(id);
      const s = await ref.get();
      if (!s.exists) {
        const cnt = (await userRef(uid).collection('routines').count().get()).data().count;
        if (cnt >= C.MAX_ROUTINES) return 'full';
      }
      await ref.set({
        nameEnc: await enc(uid, 'routines', 'name', name),
        stepsEnc: await enc(uid, 'routines', 'steps', steps),
        updatedAt: Date.now(),
      });
      return 'ok';
    },
    async deleteRoutine(uid, name) {
      const id = crypto.createHmac('sha256', await dek(uid)).update(String(name).toLowerCase()).digest('hex').slice(0, 24);
      const ref = userRef(uid).collection('routines').doc(id);
      const s = await ref.get();
      if (!s.exists) return false;
      await ref.delete();
      return true;
    },

    // 상태 점검용 개수. 내용은 읽지 않는다.
    async stats(uid) {
      const n = async (col) => (await userRef(uid).collection(col).count().get()).data().count;
      const u = await userRef(uid).collection('usage').doc('d' + kst()).get();
      return {
        messages: await n('messages'),
        memories: await n('memories'),
        todos: await n('todos'),
        routines: await n('routines'),
        usageToday: u.exists ? u.data().count : 0,
      };
    },

    // 대화, 기억, 할 일, 설정, 루틴을 전부 지운다. 사용자 문서(= 감긴 데이터 키)도 함께 지워지므로,
    // 혹시 복제본이나 백업에 암호문이 남아 있어도 키가 없어서 영원히 읽을 수 없다. (키 파기)
    // 마스터 등급은 유지하고, 새 데이터 키는 다음에 쓸 때 새로 만들어진다.
    async deleteAll(uid) {
      const s = await userRef(uid).get();
      const prev = s.exists ? s.data() : {};
      await db.recursiveDelete(userRef(uid));
      deks.delete(uid);
      await userRef(uid).set({
        tier: prev.tier || 'basic',
        masterSince: prev.masterSince || null,
        createdAt: prev.createdAt || Date.now(),
        resetAt: Date.now(),
      });
    },
  };
}

module.exports = { makeStore };
