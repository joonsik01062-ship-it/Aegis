// 이지스 서버 진입점. 화면은 /api/chat, /api/me, /api/upcoming, /api/export 만 호출한다.
// AI 키와 암호화 키는 서버의 비밀 저장소(Secret Manager)에만 있고, 브라우저에는 절대 내려가지 않는다.
// 이 서버에는 대화 내용을 평문으로 읽어 주는 관리자 기능, 디버그 출력, 내용 로그가 없다.
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const C = require('./lib/config');
const { makeStore } = require('./lib/store');
const { makeKeyring } = require('./lib/keyring');
const { parseAllowlist } = require('./lib/unlock');
const { handleChat, getMe, getUpcoming, exportData } = require('./lib/chat');
const sec = require('./lib/security');

admin.initializeApp();

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const ENC_MASTER_KEY = defineSecret('ENC_MASTER_KEY');
// 일반 설정값 (배포할 때 물어보거나 functions/.env 에 적는다)
const KMS_KEY_NAME = defineString('KMS_KEY_NAME', { default: '' }); // 예: projects/P/locations/asia-northeast3/keyRings/aegis/cryptoKeys/user-keys
const MASTER_ALLOWLIST = defineString('MASTER_ALLOWLIST', { default: '' }); // 마스터를 허용할 이메일들(쉼표). '*' 이면 누구나. 비우면 아무도 불가.
// 아래 AEGIS_* 값은 functions/.env 에 적는다 (.env.example 참고)
const ALLOWED_EMAILS = sec.parseList(process.env.AEGIS_ALLOWED_EMAILS); // 비우면 로그인한 누구나
const ENFORCE_APPCHECK = process.env.AEGIS_ENFORCE_APPCHECK === 'true';
const EXTRA_ORIGINS = sec.parseList(process.env.AEGIS_ALLOWED_ORIGINS);
const rateLimiter = sec.makeRateLimiter(); // 인스턴스별 1차 방어. 정확한 제한은 저장소의 카운터가 맡는다.

const short = sec.uidHash;
const deny = (res, code, error) => res.status(code).json({ error });

exports.api = onRequest(
  {
    region: C.REGION,
    secrets: [ANTHROPIC_API_KEY, ENC_MASTER_KEY],
    timeoutSeconds: 120,
    memory: '512MiB',
    maxInstances: 10,
  },
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const ipTag = short(req.ip || '');
    // 보안 사건 기록: 누가(해시), 무슨 일이 있었는지만 남긴다. 대화 내용은 절대 남기지 않는다.
    const auditFor = (uid) => (event) => logger.warn('audit', { event, user: uid ? short(uid) : null, ip: ipTag });

    try {
      // 1) 요청 형태 검사
      if (req.method === 'POST') {
        if (!String(req.get('content-type') || '').includes('application/json')) return deny(res, 415, 'unsupported');
        const size = req.rawBody ? req.rawBody.length : 0;
        if (size > C.MAX_BODY_BYTES) return deny(res, 413, 'too large');
      }

      // 1-1) 출처 검사: 우리 사이트(*.web.app, *.firebaseapp.com, 직접 연결한 도메인)가 아닌 브라우저 요청 차단
      const projectId = process.env.GCLOUD_PROJECT || '';
      const allowedOrigins = [`https://${projectId}.web.app`, `https://${projectId}.firebaseapp.com`, ...EXTRA_ORIGINS];
      if (!sec.originAllowed(req.get('Origin'), allowedOrigins)) {
        auditFor(null)('origin_rejected');
        return deny(res, 403, 'forbidden');
      }
      // 1-2) 로그인 전 단계 폭주 방어 (IP별 분당 60회)
      if (!rateLimiter('ip:' + ipTag, 60, 60000)) return deny(res, 429, 'too many');

      // 2) 앱 확인 (App Check): 우리 앱이 아닌 곳(스크립트, 다른 사이트)에서 온 요청 차단
      if (ENFORCE_APPCHECK) {
        const t = req.get('X-Firebase-AppCheck');
        if (!t) {
          auditFor(null)('appcheck_missing');
          return deny(res, 401, 'unauthorized');
        }
        try {
          await admin.appCheck().verifyToken(t);
        } catch (_) {
          auditFor(null)('appcheck_invalid');
          return deny(res, 401, 'unauthorized');
        }
      }

      // 3) 로그인 확인: 유효하고 폐기되지 않은 Firebase 토큰 + 인증된 Google 계정만
      const m = (req.get('Authorization') || '').match(/^Bearer (.+)$/);
      if (!m) return deny(res, 401, 'unauthorized');
      let decoded;
      try {
        decoded = await admin.auth().verifyIdToken(m[1], true);
      } catch (_) {
        auditFor(null)('auth_invalid');
        return deny(res, 401, 'unauthorized');
      }
      if (decoded.email_verified !== true || (decoded.firebase && decoded.firebase.sign_in_provider) !== 'google.com') {
        auditFor(decoded.uid)('auth_provider_rejected');
        return deny(res, 403, 'forbidden');
      }
      const uid = decoded.uid;
      // 허용 계정 목록: 개인용이면 내 이메일만 쓰게 잠근다 (남이 로그인해도 AI 비용이 나가지 않는다)
      if (!sec.emailAllowed(decoded.email, ALLOWED_EMAILS)) {
        auditFor(uid)('email_not_allowed');
        return deny(res, 403, 'forbidden');
      }
      if (!rateLimiter('uid:' + uid, 30, 60000)) return deny(res, 429, 'too many');

      const deps = {
        store: makeStore(
          admin.firestore(),
          makeKeyring({ masterKey: ENC_MASTER_KEY.value(), kmsKeyName: KMS_KEY_NAME.value() || null })
        ),
        fetchFn: fetch,
        apiKey: ANTHROPIC_API_KEY.value(),
        email: decoded.email,
        masterAllowlist: parseAllowlist(MASTER_ALLOWLIST.value()),
        log: (...a) => logger.error(...a),
        audit: auditFor(uid),
        authTime: decoded.auth_time,
        revokeSessions: (u) => admin.auth().revokeRefreshTokens(u),
        flags: { appCheck: ENFORCE_APPCHECK, allowlist: ALLOWED_EMAILS.length > 0 },
      };

      if (req.path === '/api/me' && req.method === 'GET') return res.json(await getMe(deps, uid));
      if (req.path === '/api/upcoming' && req.method === 'GET') return res.json(await getUpcoming(deps, uid));
      if (req.path === '/api/export' && req.method === 'GET') {
        const out = await exportData(deps, uid);
        if (out.status === 200) res.set('Content-Disposition', 'attachment; filename="aegis-export.json"');
        return res.status(out.status).json(out.body);
      }
      if (req.path === '/api/chat' && req.method === 'POST') {
        const out = await handleChat(deps, uid, req.body && req.body.text);
        return res.status(out.status).json(out.body);
      }
      return deny(res, 404, 'not found');
    } catch (e) {
      logger.error('api error', e.message);
      return res.status(500).json({ reply: `서버에 문제가 생겼습니다, ${C.ADDRESS}. 잠시 후 다시 말씀해 주세요.` });
    }
  }
);
