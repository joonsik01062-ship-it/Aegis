const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { handleChat, getUpcoming, exportData } = require('../lib/chat');
const { convert } = require('../lib/convert');
const { dateCalc, parseWhen } = require('../lib/dates');
const { buildSystem } = require('../lib/persona');
const { makeFakeStore, makeFakeFetch, text, toolUse, readResult } = require('./fakes');
const { makeFakeDb } = require('./fakedb');
const { makeStore } = require('../lib/store');
const { makeKeyring } = require('../lib/keyring');

const NOW = new Date('2026-10-13T09:00:00Z'); // 한국 시간 2026-10-13(화) 18:00
const deps = (store, fetchFn, extra = {}) => ({
  store, fetchFn, apiKey: 'k', now: () => NOW, log: () => {},
  email: 'owner@example.com', masterAllowlist: ['*'],
  authTime: NOW.getTime() / 1000 - 30,
  revokeSessions: async () => {},
  ...extra,
});
const lastResult = (f, i = 1) => f.calls[i].body.messages.at(-1).content[0];
const run1 = async (name, input, store = makeFakeStore(), extra = {}) => {
  const f = makeFakeFetch([toolUse(name, input), text('네, 주인님.')]);
  const r = await handleChat(deps(store, f, extra), 'u', '요청');
  return { r, f, store, res: lastResult(f) };
};

// ---------- 단위 변환 ----------
test('단위 변환: 평, 온도, 길이, 무게, 속도', () => {
  assert.equal(convert(30, '평', 'm2'), 99.17355372);
  assert.equal(convert(100, '섭씨', '화씨'), 212);
  assert.equal(convert(-40, 'f', 'c'), -40);
  assert.equal(convert(1, 'mi', 'km'), 1.609344);
  assert.equal(convert(1, '파운드', '그램'), 453.59237);
  assert.equal(convert(100, 'km/h', 'm/s'), 27.77777778);
  assert.throws(() => convert(1, 'kg', 'm'), /바꿀 수 없습니다/);
  assert.throws(() => convert('abc', 'kg', 'g'), /숫자/);
});

// ---------- 날짜 ----------
test('날짜 계산: 디데이, 일수 차이, 더하기와 요일, 잘못된 날짜', () => {
  assert.equal(dateCalc({ op: 'dday', date: '2026-12-25' }, NOW).표기, 'D-73');
  assert.equal(dateCalc({ op: 'dday', date: '2026-10-13' }, NOW).표기, 'D-DAY');
  assert.equal(dateCalc({ op: 'dday', date: '2026-10-10' }, NOW).표기, 'D+3');
  assert.equal(dateCalc({ op: 'diff', date: '2026-01-01', date2: '2026-12-31' }, NOW).일수, 364);
  assert.deepEqual(dateCalc({ op: 'add', days: 100 }, NOW).결과, { 날짜: '2027-01-21', 요일: '목요일' });
  assert.throws(() => dateCalc({ op: 'dday', date: '2026-02-30' }, NOW), /없는 날짜/);
  assert.throws(() => dateCalc({ op: 'nope' }, NOW));
});

test('한국 시간 해석: 시간대가 없으면 KST, 형식이 틀리면 거부', () => {
  assert.equal(parseWhen('2026-10-15T15:00'), Date.parse('2026-10-15T06:00:00Z'));
  assert.equal(parseWhen('2026-10-15 15:00'), Date.parse('2026-10-15T06:00:00Z'));
  assert.equal(parseWhen('2026-10-15T15:00Z'), Date.parse('2026-10-15T15:00:00Z'));
  assert.throws(() => parseWhen('내일 3시'));
  assert.throws(() => parseWhen('2026-10-15T25:00'));
});

// ---------- 일정 ----------
test('일정: 추가하면 알림 예약 동작이 가고, 조회/삭제된다', async () => {
  const { r, res, store } = await run1('add_event', { title: '치과 예약', start: '2026-10-14T15:00', remind_minutes: 30 });
  assert.ok(!res.is_error, res.content);
  assert.deepEqual(r.body.actions, [{ type: 'reminders' }]);
  assert.equal(store.state.events[0].at, Date.parse('2026-10-14T06:00:00Z'));
  assert.equal(store.state.events[0].remindMin, 30);

  const { res: listed } = await run1('list_events', { days: 3 }, store);
  const ev = readResult(listed.content).events;
  assert.equal(ev.length, 1);
  assert.equal(ev[0].내용, '치과 예약');
  assert.match(String(listed.content), /^<untrusted_data>/); // 사용자 글은 데이터로 표시

  const { res: del } = await run1('delete_event', { id: ev[0].id }, store);
  assert.ok(!del.is_error);
  assert.equal(store.state.events.length, 0);
});

test('일정: 지난 시각, 너무 먼 미래, 잘못된 알림, 민감정보는 걸러진다', async () => {
  assert.equal((await run1('add_event', { title: 'x', start: '2026-10-01T10:00' })).res.is_error, true);
  assert.equal((await run1('add_event', { title: 'x', start: '2035-01-01T10:00' })).res.is_error, true);
  assert.equal((await run1('add_event', { title: 'x', start: '2026-10-20T10:00', remind_minutes: -5 })).res.is_error, true);
  assert.equal((await run1('add_event', { title: '', start: '2026-10-20T10:00' })).res.is_error, true);
  const { store } = await run1('add_event', { title: '카드 4111-1111-1111-1111 결제', start: '2026-10-20T10:00' });
  assert.ok(!store.state.events[0].title.includes('4111-1111'));
});

test('알림 예약용 일정: 알림 시각이 하루 안인 것만 내려간다', async () => {
  const store = makeFakeStore();
  const h = 3600000;
  const t = NOW.getTime();
  await store.addEvent('u', '곧', t + 2 * h, 10);
  await store.addEvent('u', '이틀 뒤지만 이틀 전 알림', t + 48 * h, 2 * 24 * 60);
  await store.addEvent('u', '사흘 뒤', t + 72 * h, 10);
  await store.addEvent('u', '이미 지남', t - 5 * h, 0);
  const up = await getUpcoming({ store, now: () => NOW }, 'u');
  assert.deepEqual(up.events.map((e) => e.title), ['곧', '이틀 뒤지만 이틀 전 알림']);
  assert.equal(up.events[0].remindAt, t + 2 * h - 10 * 60000);
});

// ---------- 할 일 삭제 ----------
test('할 일 삭제', async () => {
  const store = makeFakeStore();
  const id = await store.addTodo('u', '우유 사기', null);
  assert.ok(!(await run1('delete_todo', { id }, store)).res.is_error);
  assert.equal(store.state.todos.length, 0);
  assert.equal((await run1('delete_todo', { id: 'none' }, store)).res.is_error, true);
});

// ---------- 미세먼지, 환율 ----------
test('미세먼지: 한국 기준 등급', async () => {
  const { res } = await run1('get_air_quality', { city: '서울' });
  const a = JSON.parse(res.content);
  assert.equal(a.미세먼지_PM10.등급, '보통');
  assert.equal(a.초미세먼지_PM2_5.등급, '나쁨');
});

test('환율: 계산, 잘못된 통화 코드는 외부에 묻기 전에 거부', async () => {
  const { res, f } = await run1('exchange_rate', { from: 'usd', to: 'KRW', amount: 100 });
  const x = JSON.parse(res.content);
  assert.equal(x.결과, 138050);
  assert.match(f.fxUrls[0], /base=USD&symbols=KRW$/);

  const bad = await run1('exchange_rate', { from: 'US D&x=1', to: 'KRW' });
  assert.equal(bad.res.is_error, true);
  assert.equal(bad.f.fxUrls, undefined);

  const unknown = await run1('exchange_rate', { from: 'XXX', to: 'KRW' });
  assert.match(JSON.parse(unknown.res.content).error, /가져오지 못했습니다/);
});

// ---------- 무작위 ----------
test('무작위: 동전, 주사위 범위, 고르기는 중복 없이', async () => {
  for (let i = 0; i < 20; i++) {
    const d = JSON.parse((await run1('random', { mode: 'dice', sides: 6 })).res.content).결과;
    assert.ok(d >= 1 && d <= 6);
  }
  assert.match(JSON.parse((await run1('random', { mode: 'coin' })).res.content).결과, /^(앞면|뒷면)$/);
  const picks = JSON.parse((await run1('random', { mode: 'pick', options: ['짜장', '짬뽕', '볶음밥'], count: 3 })).res.content).결과;
  assert.deepEqual(picks.slice().sort(), ['볶음밥', '짜장', '짬뽕']);
  assert.equal((await run1('random', { mode: 'dice', sides: 1 })).res.is_error, true);
  assert.equal((await run1('random', { mode: 'number', min: 5, max: 1 })).res.is_error, true);
});

// ---------- 기억 목록 ----------
test('기억 목록: 최근 것부터, 데이터로 표시', async () => {
  const store = makeFakeStore();
  await store.saveMemory('u', '엄마 생신은 3월 2일', '가족 일정', 'basic');
  const { res } = await run1('list_memories', {}, store);
  assert.match(String(res.content), /^<untrusted_data>/);
  assert.equal(readResult(res.content).memories[0].내용, '엄마 생신은 3월 2일');
});

// ---------- 내 데이터 내려받기 ----------
test('내려받기 도구: 최근 로그인일 때만 화면에 내려받기 동작을 보낸다', async () => {
  const ok = await run1('export_data', {});
  assert.deepEqual(ok.r.body.actions, [{ type: 'export' }]);
  const old = await run1('export_data', {}, makeFakeStore(), { authTime: NOW.getTime() / 1000 - 3600 });
  assert.equal(old.res.is_error, true);
  assert.equal(old.r.body.actions, undefined);
});

test('내려받기 API: 오래된 로그인은 거부, 최근 로그인은 기록을 돌려준다', async () => {
  const store = makeFakeStore();
  await store.addMessage('u', 'user', '안녕', 'basic');
  const audits = [];
  const denied = await exportData({ store, now: () => NOW, authTime: NOW.getTime() / 1000 - 3600 }, 'u');
  assert.equal(denied.status, 403);
  const ok = await exportData({ store, now: () => NOW, authTime: NOW.getTime() / 1000 - 30, audit: (e) => audits.push(e) }, 'u');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.messages[0].text, '안녕');
  assert.deepEqual(audits, ['export']);
});

// ---------- 실제 저장소(가짜 DB) ----------
test('저장소: 일정 제목은 암호문, 범위 조회, 내려받기, 전부 삭제', async () => {
  const db = makeFakeDb();
  const store = makeStore(db, makeKeyring({ masterKey: crypto.randomBytes(32).toString('base64') }));
  const now = Date.now();
  await store.addEvent('u1', '비밀일정XYZ', now + 3600000, 10, 'basic');
  await store.addEvent('u1', '먼일정', now + 30 * 86400000, 10, 'master');
  await store.addTodo('u1', '할일A', null);
  assert.ok(!JSON.stringify([...db.data.entries()]).includes('비밀일정XYZ'));
  const soon = await store.listEvents('u1', now, now + 86400000);
  assert.deepEqual(soon.map((e) => e.title), ['비밀일정XYZ']);
  const evDocs = [...db.data.entries()].filter(([k]) => k.includes('/events/')).map(([, v]) => v);
  assert.equal(evDocs.filter((d) => d.expireAt).length, 1); // 기본 등급만 만료일

  const ex = await store.exportAll('u1');
  assert.deepEqual(ex.events.map((e) => e.title), ['비밀일정XYZ', '먼일정']);
  assert.deepEqual(ex.todos.map((t) => t.text), ['할일A']);
  assert.equal((await store.stats('u1')).events, 2);

  assert.equal(await store.deleteTodo('u1', (await store.listTodos('u1'))[0].id), true);
  await store.deleteAll('u1');
  assert.deepEqual(await store.listEvents('u1', 0, Infinity), []);
});

// ---------- 성격 ----------
test('성격: 새 도구 사용 규칙이 시스템 프롬프트에 들어 있다', () => {
  const s = buildSystem({ tier: 'basic', now: NOW, webSearch: false });
  for (const w of ['add_event', 'get_air_quality', 'convert_units', 'date_calc', 'exchange_rate', 'export_data']) assert.ok(s.includes(w), w);
});
