// 암호화 도구 (AES-256-GCM).
// - 모든 글은 사용자마다 따로 만든 무작위 데이터 키(DEK)로 암호화한다.
// - AAD(추가 인증 데이터)에 "누구의, 어느 컬렉션의, 어느 필드인지"를 묶어 둔다.
//   그래서 DB를 건드릴 수 있는 공격자가 암호문을 다른 사용자나 다른 필드로 바꿔치기해도 복호화가 실패한다.
const crypto = require('crypto');

const VER = 'v2:';

const aad = (uid, col, field) => `${uid}|${col}|${field}`;

function newDek() {
  return crypto.randomBytes(32);
}

function encryptWithKey(key, aadStr, plain) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('키는 32바이트여야 합니다.');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(String(aadStr)));
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return VER + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

function decryptWithKey(key, aadStr, payload) {
  if (typeof payload !== 'string' || !payload.startsWith(VER)) throw new Error('알 수 없는 암호문 형식');
  const raw = Buffer.from(payload.slice(VER.length), 'base64');
  if (raw.length < 29) throw new Error('암호문이 너무 짧습니다');
  const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  d.setAAD(Buffer.from(String(aadStr)));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

// ---- v1: 마스터 키에서 사용자별 키를 유도하는 단순 방식 (키 교체 "새키,옛키" 지원) ----
// 저장소는 v2(사용자별 무작위 DEK)를 쓰고, 이 함수들은 마스터 키만으로 소규모 값을 감쌀 때 쓴다.
const V1 = 'v1:';
function v1Keys(masterKeys, uid) {
  const list = String(masterKeys || '').split(',').map((k) => Buffer.from(k.trim(), 'base64'));
  if (!list.length || list.some((k) => k.length < 32)) throw new Error('마스터 키는 32바이트 이상(base64)이어야 합니다.');
  return list.map((m) => Buffer.from(crypto.hkdfSync('sha256', m, Buffer.from(String(uid)), Buffer.from('aegis-user-key-v1'), 32)));
}
function encrypt(masterKeys, uid, plain, aadLabel = '') {
  const key = v1Keys(masterKeys, uid)[0];
  return V1 + encryptWithKey(key, `${uid}|${aadLabel}`, plain).slice(VER.length);
}
function decrypt(masterKeys, uid, payload, aadLabel = '') {
  if (typeof payload !== 'string' || !payload.startsWith(V1)) throw new Error('알 수 없는 암호문 형식');
  let last;
  for (const key of v1Keys(masterKeys, uid)) {
    try {
      return decryptWithKey(key, `${uid}|${aadLabel}`, VER + payload.slice(V1.length));
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

module.exports = { aad, newDek, encryptWithKey, decryptWithKey, encrypt, decrypt };
