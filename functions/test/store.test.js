const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { makeFakeDb } = require('./fakedb');
const { makeStore } = require('../lib/store');
const { makeKeyring } = require('../lib/keyring');
const { encryptWithKey, aad } = require('../lib/crypto');

const KEY = crypto.randomBytes(32).toString('base64');
const mk = (key = KEY) => {
  const db = makeFakeDb();
  return { db, store: makeStore(db, makeKeyring({ masterKey: key })) };
};
const dump = (db) => JSON.stringify([...db.data.entries()]);

test('저장소: 대화, 기억, 설정, 루틴이 DB에는 암호문으로만 남는다', async () => {
  const { db, store } = mk();
  await store.addMessage('u1', 'user', '엄마 생신은 비밀문장ABC', 'basic');
  await store.saveMemory('u1', '금고 위치 비밀문장DEF', '이유GHI', 'master');
  await store.setPref('u1', 'home_city', '비밀도시JKL');
  await store.saveRoutine('u1', '비밀이름MNO', '비밀단계PQR');
  await store.addTodo('u1', '비밀할일STU', null);
  const raw = dump(db);
  for (const w of ['비밀문장ABC', '비밀문장DEF', '이유GHI', '비밀도시JKL', '비밀이름MNO', '비밀단계PQR', '비밀할일STU']) assert.ok(!raw.includes(w), w);
  assert.equal((await store.recentMessages('u1', 5))[0].text, '엄마 생신은 비밀문장ABC');
  assert.equal((await store.listMemories('u1', 5))[0].text, '금고 위치 비밀문장DEF');
  assert.deepEqual(await store.getPrefs('u1'), { home_city: '비밀도시JKL' });
  assert.deepEqual((await store.listRoutines('u1')).map((r) => r.steps), ['비밀단계PQR']);
});

test('저장소: 기본 등급은 만료일이 있고 마스터는 없다', async () => {
  const { db, store } = mk();
  await store.addMessage('u1', 'user', 'a', 'basic');
  await store.addMessage('u1', 'user', 'b', 'master');
  const docs = [...db.data.entries()].filter(([k]) => k.includes('/messages/')).map(([, v]) => v);
  assert.equal(docs.filter((d) => d.expireAt).length, 1);
});

test('바꿔치기 방어: 다른 사용자/다른 필드로 복사한 암호문은 읽히지 않는다', async () => {
  const { db, store } = mk();
  await store.saveMemory('u1', '나만의 기억', '', 'master');
  await store.saveMemory('u2', '다른 사람 기억', '', 'master');
  const m1 = [...db.data.entries()].find(([k]) => k.startsWith('users/u1/memories/'));
  const m2 = [...db.data.entries()].find(([k]) => k.startsWith('users/u2/memories/'));
  m2[1].textEnc = m1[1].textEnc; // u1의 암호문을 u2 문서에 복사
  assert.deepEqual(await store.listMemories('u2', 5), []);
  // 같은 사용자라도 필드(reason)로 옮기면 거부
  const m1b = [...db.data.entries()].find(([k]) => k.startsWith('users/u1/memories/'));
  m1b[1].reasonEnc = m1b[1].textEnc;
  const out = await store.listMemories('u1', 5);
  assert.equal(out[0].reason, '');
});

test('사용자마다 다른 데이터 키, 마스터 키 없이는 못 읽는다', async () => {
  const { db, store } = mk();
  await store.addMessage('u1', 'user', 'x', 'basic');
  await store.addMessage('u2', 'user', 'x', 'basic');
  assert.notEqual(db.data.get('users/u1').dekWrapped, db.data.get('users/u2').dekWrapped);
  const other = makeStore(db, makeKeyring({ masterKey: crypto.randomBytes(32).toString('base64') }));
  assert.deepEqual(await other.recentMessages('u1', 5), []); // 읽히지 않고 건너뜀
});

test('키 교체: "새키,옛키"로 옛 데이터를 계속 읽는다', async () => {
  const OLD = crypto.randomBytes(32).toString('base64');
  const NEW = crypto.randomBytes(32).toString('base64');
  const { db, store } = mk(OLD);
  await store.addMessage('u1', 'user', '옛 대화', 'basic');
  const rotated = makeStore(db, makeKeyring({ masterKey: `${NEW},${OLD}` }));
  assert.equal((await rotated.recentMessages('u1', 5))[0].text, '옛 대화');
});

test('전부 삭제: 데이터와 감긴 키가 사라지고, 옛 암호문 백업은 새 키로 읽히지 않는다 (키 파기)', async () => {
  const { db, store } = mk();
  await store.setTier('u1', 'master');
  await store.addMessage('u1', 'user', '지울 대화', 'master');
  await store.setPref('u1', 'home_city', '서울');
  const backup = structuredClone([...db.data.entries()].find(([k]) => k.includes('/messages/'))[1]);
  await store.deleteAll('u1');
  assert.deepEqual(await store.recentMessages('u1', 5), []);
  assert.deepEqual(await store.getPrefs('u1'), {});
  assert.equal((await store.getUser('u1')).tier, 'master');
  await store.addMessage('u1', 'user', '새 대화', 'master'); // 새 DEK 생성
  db.data.set('users/u1/messages/backup', backup); // 공격자가 옛 암호문을 되돌려 넣어도
  const texts = (await store.recentMessages('u1', 10)).map((m) => m.text);
  assert.deepEqual(texts, ['새 대화']);
});

test('설정/루틴 개수 제한과 stats', async () => {
  const { store } = mk();
  for (let i = 0; i < 30; i++) assert.equal(await store.setPref('u', 'k' + String.fromCharCode(97 + (i % 26)) + 'x'.repeat(Math.floor(i / 26)), 'v'), 'ok');
  assert.equal(await store.setPref('u', 'overflow', 'v'), 'full');
  assert.equal(await store.saveRoutine('u', 'A', '1'), 'ok');
  assert.equal(await store.saveRoutine('u', 'a', '2'), 'ok'); // 같은 이름은 덮어쓰기
  assert.equal((await store.listRoutines('u')).length, 1);
  assert.equal(await store.deleteRoutine('u', 'A'), true);
  const s = await store.stats('u');
  assert.equal(s.routines, 0);
});

test('사용량 카운터: 한도에서 막힌다', async () => {
  const { store } = mk();
  for (let i = 0; i < 3; i++) assert.equal(await store.consumeBurst('u', 3), true);
  assert.equal(await store.consumeBurst('u', 3), false);
  assert.equal(await store.consumeGlobal(1), true);
  assert.equal(await store.consumeGlobal(1), false);
});

test('암호문 직접 검증: AAD가 다르면 실패', () => {
  const k = crypto.randomBytes(32);
  const c = encryptWithKey(k, aad('u', 'messages', 'text'), 'hi');
  assert.throws(() => require('../lib/crypto').decryptWithKey(k, aad('u', 'memories', 'text'), c));
});
