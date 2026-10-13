// 보안 보조 함수들. (전부 순수 함수라 테스트하기 쉽다)
const crypto = require('crypto');

// 로그에는 사용자 ID 원본 대신 짧은 해시만 남긴다.
const uidHash = (uid) => crypto.createHash('sha256').update(String(uid)).digest('hex').slice(0, 10);

const parseList = (s) =>
  String(s || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

// 브라우저가 보낸 Origin이 우리 사이트가 아니면 거부한다. (Origin이 없는 요청은 로그인 토큰 검사가 막는다)
function originAllowed(origin, allowed) {
  if (!origin) return true;
  return allowed.includes(String(origin).toLowerCase());
}

// 허용 목록이 비어 있으면 누구나, 있으면 목록의 이메일만 사용 가능 (개인용/비공개 베타 모드)
function emailAllowed(email, allowed) {
  if (!allowed.length) return true;
  return allowed.includes(String(email || '').toLowerCase());
}

// 슬라이딩 윈도우 속도 제한 (인스턴스별 메모리). 연속 요청 폭주를 막는다.
function makeRateLimiter() {
  const hits = new Map();
  return function allow(key, limit, windowMs, now = Date.now()) {
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= limit) {
      hits.set(key, arr);
      return false;
    }
    arr.push(now);
    hits.set(key, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
    return true;
  };
}

// 로그인한 지 얼마 안 됐는지 (삭제, 전체 로그아웃 같은 위험한 작업 전에 확인). 정보가 없으면 거부(fail closed).
function isRecentLogin(authTimeSec, nowMs, maxAgeSec) {
  if (!authTimeSec) return false;
  return nowMs / 1000 - authTimeSec <= maxAgeSec;
}

// 입력 정리: 제어 문자, 보이지 않는 글자(글 속에 명령을 숨기는 수법), 방향 전환 문자를 제거한다.
function cleanInput(text) {
  return String(text)
    .normalize('NFC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[​-‏‪-‮⁠-⁤⁦-⁩﻿]/g, '')
    .replace(/[\u{E0000}-\u{E007F}]/gu, '')
    .trim();
}

module.exports = { uidHash, parseList, originAllowed, emailAllowed, makeRateLimiter, isRecentLogin, cleanInput };
