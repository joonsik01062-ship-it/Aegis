// 키 보관소: 사용자별 데이터 키(DEK)를 "감싸서(wrap)" DB에 저장하고, 필요할 때 "풀어서(unwrap)" 쓴다.
//
//  - secret: 비밀 저장소(Secret Manager)의 마스터 키로 감싼다. 설정이 쉽다.
//  - kms   : Google Cloud KMS 키로 감싼다. 키가 서버 밖(KMS)에 있고, 풀 때마다 감사 로그가 남고,
//            IAM으로 "누가 풀 수 있는지"를 따로 통제할 수 있다. (개발자 계정은 권한을 주지 않는 식으로 분리 가능)
//
// 둘 다 있으면 새 키는 KMS로 감싸고, 이미 secret으로 감싼 키도 계속 풀 수 있다.
const crypto = require('crypto');
const { encryptWithKey, decryptWithKey } = require('./crypto');

function secretKeyring(masterKeysB64) {
  // "새키,옛키" 형태로 여러 개를 줄 수 있다. 감쌀 때는 첫 번째, 풀 때는 순서대로 시도한다. (키 교체용)
  const keks = String(masterKeysB64 || '')
    .split(',')
    .map((k) => Buffer.from(k.trim(), 'base64'))
    .map((master) => {
      if (master.length < 32) throw new Error('ENC_MASTER_KEY는 32바이트 이상(base64)이어야 합니다.');
      return Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), Buffer.from('aegis-kek-v2'), 32));
    });
  return {
    kind: 'secret',
    prefix: 'v2:',
    async wrap(uid, dek) {
      return encryptWithKey(keks[0], `${uid}|dek`, dek.toString('base64'));
    },
    async unwrap(uid, wrapped) {
      let last;
      for (const kek of keks) {
        try {
          return Buffer.from(decryptWithKey(kek, `${uid}|dek`, wrapped), 'base64');
        } catch (e) {
          last = e;
        }
      }
      throw last;
    },
  };
}

// client는 테스트에서 가짜를 넣을 수 있다. 실제로는 @google-cloud/kms 의 KeyManagementServiceClient.
function kmsKeyring(keyName, client) {
  const kms = client || new (require('@google-cloud/kms').KeyManagementServiceClient)();
  return {
    kind: 'kms',
    prefix: 'kms1:',
    async wrap(uid, dek) {
      const [r] = await kms.encrypt({
        name: keyName,
        plaintext: dek,
        additionalAuthenticatedData: Buffer.from(`${uid}|dek`),
      });
      return 'kms1:' + Buffer.from(r.ciphertext).toString('base64');
    },
    async unwrap(uid, wrapped) {
      const [r] = await kms.decrypt({
        name: keyName,
        ciphertext: Buffer.from(wrapped.slice(5), 'base64'),
        additionalAuthenticatedData: Buffer.from(`${uid}|dek`),
      });
      return Buffer.from(r.plaintext);
    },
  };
}

// 새 키는 preferred(kms가 있으면 kms)로 감싸고, 풀 때는 접두사를 보고 알맞은 쪽으로 보낸다.
function makeKeyring({ masterKey, kmsKeyName, kmsClient }) {
  const secret = secretKeyring(masterKey);
  const kms = kmsKeyName ? kmsKeyring(kmsKeyName, kmsClient) : null;
  const preferred = kms || secret;
  return {
    kind: preferred.kind,
    wrap: (uid, dek) => preferred.wrap(uid, dek),
    unwrap(uid, wrapped) {
      if (typeof wrapped !== 'string') throw new Error('감긴 키 형식 오류');
      if (wrapped.startsWith('kms1:')) {
        if (!kms) throw new Error('이 키는 KMS로 감겨 있습니다. KMS_KEY_NAME을 설정하세요.');
        return kms.unwrap(uid, wrapped);
      }
      return secret.unwrap(uid, wrapped);
    },
  };
}

module.exports = { secretKeyring, kmsKeyring, makeKeyring };
