// 마스터 모드 해금 문장 판별. 반드시 서버에서만 실행한다.
// 이 문장은 유명한 대사라 인증 수단이 아니라 "기능 해금 스위치"일 뿐이다.
// 실제 보안은 로그인(Firebase Auth)과 "마스터 허용 목록"이 맡는다.
const norm = (s) => String(s).toLowerCase().replace(/[^0-9a-z가-힣]/g, '');

const ON = ['iamironman', 'imironman', '아이엠아이언맨', '나는아이언맨이다'];
const OFF = ['마스터모드꺼', '마스터모드해제', '마스터모드종료'];

// 문장이 길게 섞인 대화(예: 영화 얘기 중 인용)에서는 발동하지 않도록 길이를 제한한다.
function checkPhrase(text) {
  const n = norm(text);
  for (const p of ON) if (n.includes(p) && n.length <= p.length + 8) return 'on';
  for (const p of OFF) if (n.includes(p) && n.length <= p.length + 6) return 'off';
  return null;
}

// "전부 삭제" 같은 되돌릴 수 없는 명령은 사용자가 확인 문장만 단독으로 말했을 때만 허용한다.
// (긴 글 속에 섞여 있거나 붙여넣은 내용에 들어 있는 경우는 인정하지 않는다)
const CONFIRM = ['전부삭제확인', '모두삭제확인'];
function confirmsDeleteAll(text) {
  const n = norm(text);
  return CONFIRM.some((p) => n.includes(p) && n.length <= p.length + 4);
}

const REVOKE = ['모든기기로그아웃확인', '전체로그아웃확인'];
function confirmsRevoke(text) {
  const n = norm(text);
  return REVOKE.some((p) => n.includes(p) && n.length <= p.length + 4);
}

// 마스터 허용 목록. "*" 이면 누구나, 비어 있으면 아무도 불가 (기본은 닫힘).
function parseAllowlist(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
function masterAllowed(email, allowlist) {
  if (!allowlist || !allowlist.length) return false;
  if (allowlist.includes('*')) return true;
  return !!email && allowlist.includes(String(email).toLowerCase());
}

module.exports = { checkPhrase, confirmsDeleteAll, confirmsRevoke, norm, parseAllowlist, masterAllowed };
