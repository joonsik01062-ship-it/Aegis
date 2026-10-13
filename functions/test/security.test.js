const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/security');
const { calculate } = require('../lib/calc');
const { confirmsRevoke } = require('../lib/unlock');

test('Origin: 우리 사이트만 허용, 다른 사이트는 거부, Origin이 없으면 토큰 검사에 맡김', () => {
  const allowed = ['https://aegis.web.app'];
  assert.equal(S.originAllowed('https://aegis.web.app', allowed), true);
  assert.equal(S.originAllowed('https://HTTPS-evil.example', allowed), false);
  assert.equal(S.originAllowed('https://aegis.web.app.evil.com', allowed), false);
  assert.equal(S.originAllowed(undefined, allowed), true);
});

test('허용 계정: 목록이 있으면 목록의 이메일만', () => {
  assert.equal(S.emailAllowed('a@x.com', []), true);
  const list = S.parseList('Me@Gmail.com, you@gmail.com');
  assert.equal(S.emailAllowed('me@gmail.com', list), true);
  assert.equal(S.emailAllowed('ME@GMAIL.COM', list), true);
  assert.equal(S.emailAllowed('hacker@gmail.com', list), false);
  assert.equal(S.emailAllowed('', list), false);
  assert.equal(S.emailAllowed(undefined, list), false);
});

test('속도 제한: 한도를 넘으면 막고, 시간이 지나면 다시 허용', () => {
  const allow = S.makeRateLimiter();
  for (let i = 0; i < 3; i++) assert.equal(allow('u', 3, 60000, 1000 + i), true);
  assert.equal(allow('u', 3, 60000, 1100), false);
  assert.equal(allow('other', 3, 60000, 1100), true); // 다른 사용자는 영향 없음
  assert.equal(allow('u', 3, 60000, 62000), true);
});

test('최근 로그인: 정보가 없으면 거부(fail closed), 오래되면 거부', () => {
  const now = Date.now();
  assert.equal(S.isRecentLogin(undefined, now, 600), false);
  assert.equal(S.isRecentLogin(now / 1000 - 100, now, 600), true);
  assert.equal(S.isRecentLogin(now / 1000 - 3600, now, 600), false);
});

test('입력 정리: 보이지 않는 글자와 제어 문자를 제거한다', () => {
  const sneaky = '안녕​하세‮요\u0007' + String.fromCodePoint(0xe0041, 0xe0042) + '!';
  assert.equal(S.cleanInput(sneaky), '안녕하세요!');
  assert.equal(S.cleanInput('  ​  '), '');
});

test('로그용 사용자 해시는 원본을 드러내지 않는다', () => {
  const h = S.uidHash('abcdef123456');
  assert.equal(h.length, 10);
  assert.ok(!h.includes('abcdef'));
});

test('계산기: 정확하게 계산하고 위험한 입력은 거부한다', () => {
  assert.equal(calculate('12000*0.15'), 1800);
  assert.equal(calculate('(2+3)*4^2'), 80);
  assert.equal(calculate('2^3^2'), 512); // 오른쪽 결합
  assert.equal(calculate('-3 + sqrt(16)'), 1);
  assert.equal(calculate('10 % 3'), 1);
  assert.equal(calculate('1,000 + 500'), 1500);
  assert.equal(calculate('0.1+0.2'), 0.3);
  for (const bad of ['1/0', '2+', 'process.exit()', 'require("fs")', '(1+2', 'abc', '1+2)', '9'.repeat(300), 'sqrt(-1)'])
    assert.throws(() => calculate(bad), bad.slice(0, 20));
  assert.throws(() => calculate('('.repeat(60) + '1' + ')'.repeat(60)));
});

test('확인 문장: 전체 로그아웃', () => {
  assert.equal(confirmsRevoke('모든 기기 로그아웃 확인'), true);
  assert.equal(confirmsRevoke('모든 기기 로그아웃 해줘'), false);
});
