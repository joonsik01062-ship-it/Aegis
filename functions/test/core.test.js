const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { encrypt, decrypt } = require('../lib/crypto');
const { redact } = require('../lib/redact');
const { checkPhrase, confirmsDeleteAll } = require('../lib/unlock');
const { rank } = require('../lib/memory');
const { handleChat, toApiMessages } = require('../lib/chat');
const C = require('../lib/config');
const { makeFakeStore, makeFakeFetch, text, toolUse, readResult } = require('./fakes');

const KEY = crypto.randomBytes(32).toString('base64');

// ---------- 암호화 ----------
test('암호화: 복호화하면 원문이 나온다', () => {
  const c = encrypt(KEY, 'user-a', '목요일 세 시 치과');
  assert.notEqual(c, '목요일 세 시 치과');
  assert.equal(decrypt(KEY, 'user-a', c), '목요일 세 시 치과');
});

test('암호화: 다른 사용자 키로는 못 푼다', () => {
  const c = encrypt(KEY, 'user-a', '비밀 메모');
  assert.throws(() => decrypt(KEY, 'user-b', c));
});

test('암호화: 같은 글도 매번 다른 암호문이고, 변조하면 거부된다', () => {
  const a = encrypt(KEY, 'u', 'x');
  const b = encrypt(KEY, 'u', 'x');
  assert.notEqual(a, b);
  const raw = Buffer.from(a.slice(3), 'base64');
  raw[raw.length - 1] ^= 1;
  assert.throws(() => decrypt(KEY, 'u', 'v1:' + raw.toString('base64')));
});

test('암호화: 용도(AAD)가 다르면 바꿔치기해도 복호화되지 않는다', () => {
  const c = encrypt(KEY, 'u', '원문', 'mem');
  assert.equal(decrypt(KEY, 'u', c, 'mem'), '원문');
  assert.throws(() => decrypt(KEY, 'u', c, 'msg'));
  assert.throws(() => decrypt(KEY, 'u', c));
});

test('암호화: 키 교체("새키,옛키") 후에도 옛 데이터를 읽고, 새 데이터는 새 키로 만든다', () => {
  const OLD = crypto.randomBytes(32).toString('base64');
  const NEW = crypto.randomBytes(32).toString('base64');
  const oldData = encrypt(OLD, 'u', '옛 데이터', 'msg');
  assert.equal(decrypt(`${NEW},${OLD}`, 'u', oldData, 'msg'), '옛 데이터');
  const fresh = encrypt(`${NEW},${OLD}`, 'u', '새 데이터', 'msg');
  assert.equal(decrypt(NEW, 'u', fresh, 'msg'), '새 데이터'); // 새 키 하나만으로도 읽힘
  assert.throws(() => decrypt(OLD, 'u', fresh, 'msg')); // 옛 키로는 못 읽음
});

test('암호화: 짧은 마스터 키는 거부', () => {
  assert.throws(() => encrypt('c2hvcnQ=', 'u', 'x'));
});

// ---------- 민감정보 삭제 ----------
test('redact: 주민번호, 유효한 카드번호, 비밀번호를 지운다', () => {
  assert.match(redact('주민번호 900101-1234567 이야'), /\[주민등록번호 삭제됨\]/);
  assert.match(redact('카드 4111 1111 1111 1111 이야'), /\[카드번호 삭제됨\]/);
  assert.match(redact('와이파이 비밀번호는 hunter2'), /\[삭제됨\]/);
  assert.ok(!redact('와이파이 비밀번호는 hunter2').includes('hunter2'));
});

test('redact: 평범한 숫자는 건드리지 않는다', () => {
  assert.equal(redact('내일 오후 3시에 12345 번지 방문'), '내일 오후 3시에 12345 번지 방문');
  assert.equal(redact('번호 1234567890123456'), '번호 1234567890123456'); // Luhn 불일치
});

// ---------- 해금 문장 ----------
test('해금: 다양한 표기를 인식한다', () => {
  for (const t of ['아이 엠 아이언맨', '아이엠 아이언맨!', 'I am Iron Man', "I'm iron man", 'i am ironman.', '나는 아이언맨이다'])
    assert.equal(checkPhrase(t), 'on', t);
});

test('해금: 긴 문장 속 인용은 발동하지 않는다', () => {
  assert.equal(checkPhrase('어제 영화에서 아이 엠 아이언맨 하고 말하는 장면이 진짜 멋있었어 너도 봤어'), null);
  assert.equal(checkPhrase('오늘 날씨 어때'), null);
});

test('해제와 전부삭제 확인 문장', () => {
  assert.equal(checkPhrase('마스터 모드 꺼 줘'), 'off');
  assert.equal(confirmsDeleteAll('전부 삭제 확인'), true);
  assert.equal(confirmsDeleteAll('전부 삭제해 줘'), false);
});

// ---------- 기억 검색 ----------
test('검색: 관련 기억만 찾고 무관한 건 제외한다', () => {
  const items = [
    { id: '1', text: '목요일 오후 세 시 치과 예약', ts: 1 },
    { id: '2', text: '고양이 사료는 월요일에 주문', ts: 2 },
    { id: '3', text: '엄마 생신은 11월 3일', ts: 3 },
  ];
  assert.deepEqual(rank(items, '치과 얘기한 거 뭐였지').map((x) => x.id), ['1']);
  assert.deepEqual(rank(items, '엄마 생신').map((x) => x.id), ['3']);
  assert.deepEqual(rank(items, '자동차 보험'), []);
});

test('API 메시지: 항상 user로 시작하고 번갈아 간다', () => {
  const out = toApiMessages(
    [{ role: 'assistant', text: 'a0' }, { role: 'user', text: 'u1' }, { role: 'user', text: 'u2' }, { role: 'assistant', text: 'a1' }],
    'u3'
  );
  assert.deepEqual(out, [
    { role: 'user', content: 'u1\nu2' },
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'u3' },
  ]);
});

// ---------- 대화 흐름 ----------
const NOW = new Date('2026-10-13T09:00:00Z');
const deps = (store, fetchFn, extra = {}) => ({
  store, fetchFn, apiKey: 'k', now: () => NOW, log: () => {},
  email: 'owner@example.com', masterAllowlist: ['*'],
  authTime: NOW.getTime() / 1000 - 30, // 30초 전에 로그인
  revokeSessions: async () => {},
  ...extra,
});

test('마스터 해금: AI를 호출하지 않고 서버가 처리, 이후 상위 모델 사용', async () => {
  const store = makeFakeStore();
  const f = makeFakeFetch([text('네, 주인님.')]);
  const r1 = await handleChat(deps(store, f), 'u', '아이 엠 아이언맨');
  assert.equal(r1.body.master, true);
  assert.equal(r1.body.unlocked, true);
  assert.equal(f.calls.length, 0);
  assert.equal(store.state.tier, 'master');

  await handleChat(deps(store, f), 'u', '안녕');
  assert.equal(f.calls[0].body.model, C.MODELS.master);
  assert.ok(f.calls[0].body.system.includes('마스터'));
});

test('기본 등급은 기본 모델, 도구 목록과 주인님 호칭이 전달된다', async () => {
  const store = makeFakeStore();
  const f = makeFakeFetch([text('안녕하세요, 주인님.')]);
  const r = await handleChat(deps(store, f), 'u', '안녕');
  assert.equal(r.status, 200);
  assert.equal(r.body.reply, '안녕하세요, 주인님.');
  assert.equal(f.calls[0].body.model, C.MODELS.basic);
  assert.equal(f.calls[0].headers['x-api-key'], 'k');
  assert.ok(f.calls[0].body.tools.some((t) => t.name === 'search_memory'));
  assert.ok(f.calls[0].body.system.includes('주인님'));
  assert.equal(store.state.messages.length, 2); // 사용자 말 + 이지스 답, 모두 저장
});

test('민감한 번호는 저장도, AI 전달도 되기 전에 지워진다', async () => {
  const store = makeFakeStore();
  const f = makeFakeFetch([text('알겠습니다.')]);
  await handleChat(deps(store, f), 'u', '내 카드는 4111 1111 1111 1111 이야');
  assert.ok(!JSON.stringify(f.calls[0].body.messages).includes('4111'));
  assert.ok(!store.state.messages[0].text.includes('4111'));
});

test('도구 루프: save_memory 호출 → 결과 전달 → 최종 답', async () => {
  const store = makeFakeStore();
  const f = makeFakeFetch([
    toolUse('save_memory', { text: '목요일 세 시 치과 예약', reason: '약속' }),
    text('저장했습니다, 주인님.'),
  ]);
  const r = await handleChat(deps(store, f), 'u', '목요일 세 시에 치과 예약했어 기억해');
  assert.equal(r.body.reply, '저장했습니다, 주인님.');
  assert.equal(store.state.memories.length, 1);
  assert.equal(store.state.memories[0].text, '목요일 세 시 치과 예약');
  const second = f.calls[1].body.messages;
  assert.equal(second[second.length - 1].content[0].type, 'tool_result');
  assert.equal(second[second.length - 1].content[0].tool_use_id, 'tu_1');
});

test('기억 검색: 저장된 기억을 찾고, 방금 한 말 자체는 결과에서 제외, 기본 등급은 보관기간 갱신(touch)', async () => {
  const store = makeFakeStore();
  await store.saveMemory('u', '목요일 세 시 치과 예약', '약속', 'basic');
  const f = makeFakeFetch([toolUse('search_memory', { query: '치과' }), text('목요일 세 시입니다, 주인님.')]);
  await handleChat(deps(store, f), 'u', '치과 언제였지');
  const rawContent = f.calls[1].body.messages.at(-1).content[0].content;
  assert.ok(rawContent.startsWith('<untrusted_data>'), '저장된 기억은 데이터 표시가 붙어야 한다');
  const result = readResult(rawContent);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].kind, 'memory');
  assert.ok(result.results[0].내용.includes('치과'));
  assert.deepEqual(store.state.touched.map((t) => t.col), ['memories']);
});

test('전부 삭제: 확인 문장 없이는 거부, 말한 직후에는 실행', async () => {
  const store = makeFakeStore();
  await store.saveMemory('u', '중요한 것', '', 'basic');
  const f1 = makeFakeFetch([toolUse('delete_all_data', {}), text('확인이 필요합니다.')]);
  await handleChat(deps(store, f1), 'u', '다 지워 줘');
  assert.equal(store.state.deleted.length, 0);
  assert.equal(f1.calls[1].body.messages.at(-1).content[0].is_error, true);

  const f2 = makeFakeFetch([toolUse('delete_all_data', {}), text('전부 삭제했습니다, 주인님.')]);
  await handleChat(deps(store, f2), 'u', '전부 삭제 확인');
  assert.equal(store.state.deleted.length, 1);
});

test('날씨 도구', async () => {
  const store = makeFakeStore();
  const f = makeFakeFetch([toolUse('get_weather', { city: '서울' }), text('맑고 이십일 도입니다, 주인님.')]);
  const r = await handleChat(deps(store, f), 'u', '서울 날씨 어때');
  assert.equal(r.body.reply, '맑고 이십일 도입니다, 주인님.');
  const w = JSON.parse(f.calls[1].body.messages.at(-1).content[0].content);
  assert.equal(w.현재.날씨, '맑음');
});

test('하루 한도 초과 시 429', async () => {
  const store = makeFakeStore();
  store.state.usage = C.DAILY_LIMIT.basic;
  const f = makeFakeFetch([]);
  const r = await handleChat(deps(store, f), 'u', '안녕');
  assert.equal(r.status, 429);
  assert.equal(f.calls.length, 0);
});

test('AI 서버 오류 시 안전한 안내 문구만 돌려준다 (내부 오류 노출 없음)', async () => {
  const store = makeFakeStore();
  const f = async () => ({ ok: false, status: 500, text: async () => 'secret internal detail' });
  const r = await handleChat(deps(store, f), 'u', '안녕');
  assert.equal(r.status, 502);
  assert.ok(!JSON.stringify(r.body).includes('secret'));
});

test('빈 입력과 너무 긴 입력은 거부', async () => {
  const store = makeFakeStore();
  const f = makeFakeFetch([]);
  assert.equal((await handleChat(deps(store, f), 'u', '  ')).status, 400);
  assert.equal((await handleChat(deps(store, f), 'u', 'a'.repeat(C.MAX_INPUT_CHARS + 1))).status, 400);
  assert.equal((await handleChat(deps(store, f), 'u', 123)).status, 400);
});
