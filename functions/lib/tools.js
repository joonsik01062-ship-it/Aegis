// 이지스가 직접 실행하는 도구들. AI는 이 목록 안에서만 행동할 수 있다.
// 도구를 추가하면 모든 사용자에게 배포 즉시 반영된다.
const { redact } = require('./redact');
const { rank } = require('./memory');
const { confirmsDeleteAll, confirmsRevoke } = require('./unlock');
const { calculate } = require('./calc');
const { convert } = require('./convert');
const { dateCalc, parseWhen, fmtKST: fmtFull, DAY } = require('./dates');
const nodeCrypto = require('crypto');
const C = require('./config');

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required });

const DEFINITIONS = [
  {
    name: 'get_weather',
    description: '도시의 현재 날씨와 오늘/내일 예보를 가져온다.',
    input_schema: obj({ city: { type: 'string', description: '도시 이름. 예: 서울, 부산, 도쿄' } }, ['city']),
  },
  {
    name: 'calculate',
    description: '수식을 정확하게 계산한다. 사칙연산, 나머지(%), 거듭제곱(^), 괄호, sqrt/abs/round/floor/ceil/ln/log/sin/cos/tan, pi, e 지원. 퍼센트는 곱셈으로 바꿔서 넣는다. 예: 12000*0.15',
    input_schema: obj({ expression: { type: 'string' } }, ['expression']),
  },
  {
    name: 'current_time',
    description: '지정한 시간대의 현재 날짜와 시각을 알려 준다. 기본은 한국 시간.',
    input_schema: obj({ timezone: { type: 'string', description: 'IANA 시간대. 예: Asia/Tokyo, America/New_York' } }),
  },
  {
    name: 'set_timer',
    description: '타이머를 건다. 앱이 열려 있는 동안 울린다.',
    input_schema: obj(
      {
        seconds: { type: 'integer', description: '1 ~ 86400초' },
        label: { type: 'string', description: '무슨 타이머인지. 예: 라면' },
      },
      ['seconds']
    ),
  },
  {
    name: 'add_todo',
    description: '할 일을 추가한다.',
    input_schema: obj(
      {
        text: { type: 'string', description: '할 일 내용' },
        due: { type: 'string', description: '기한이 있으면 자연어 또는 날짜. 예: 내일 오후 3시' },
      },
      ['text']
    ),
  },
  { name: 'list_todos', description: '아직 끝내지 않은 할 일 목록을 가져온다.', input_schema: obj() },
  {
    name: 'complete_todo',
    description: '할 일을 완료 처리한다. id는 list_todos 결과에서 가져온다.',
    input_schema: obj({ id: { type: 'string' } }, ['id']),
  },
  {
    name: 'set_pref',
    description: '사용자의 고정 정보를 저장한다. 예: key=home_city value=서울. value를 비우면 삭제한다.',
    input_schema: obj(
      {
        key: { type: 'string', description: '영문 소문자와 밑줄. 예: home_city, wake_time' },
        value: { type: 'string' },
      },
      ['key', 'value']
    ),
  },
  { name: 'get_prefs', description: '저장된 사용자 고정 정보를 모두 가져온다.', input_schema: obj() },
  {
    name: 'save_routine',
    description: '프로토콜(루틴)을 저장한다. 사용자가 만들어 달라고 명시적으로 요청했을 때만 호출한다.',
    input_schema: obj(
      {
        name: { type: 'string', description: '루틴 이름. 예: 퇴근 프로토콜' },
        steps: { type: 'string', description: '이름을 불렀을 때 할 일을 순서대로 적은 글' },
      },
      ['name', 'steps']
    ),
  },
  { name: 'list_routines', description: '저장된 루틴 목록과 단계를 가져온다.', input_schema: obj() },
  {
    name: 'delete_routine',
    description: '루틴을 삭제한다.',
    input_schema: obj({ name: { type: 'string' } }, ['name']),
  },
  {
    name: 'delete_todo',
    description: '할 일을 완료하지 않고 아예 지운다. id는 list_todos 결과에서 가져온다.',
    input_schema: obj({ id: { type: 'string' } }, ['id']),
  },
  {
    name: 'add_event',
    description:
      '일정을 추가한다. 시각은 현재 시각을 기준으로 계산해서 한국 시간 YYYY-MM-DDTHH:mm 형식으로 넣는다. 앱이 열려 있으면 알림 시간에 소리로, 백그라운드면 알림으로 알려 준다.',
    input_schema: obj(
      {
        title: { type: 'string', description: '일정 내용. 예: 치과 예약' },
        start: { type: 'string', description: '한국 시간. 예: 2026-10-15T15:00' },
        remind_minutes: { type: 'integer', description: '몇 분 전에 알릴지. 기본 10, 0이면 정각에, 최대 10080(일주일)' },
      },
      ['title', 'start']
    ),
  },
  {
    name: 'list_events',
    description: '지금부터 며칠 안의 일정을 시간순으로 가져온다. 오늘 일정, 이번 주 일정, 브리핑에 쓴다.',
    input_schema: obj({ days: { type: 'integer', description: '1 ~ 90. 기본 7' } }),
  },
  {
    name: 'delete_event',
    description: '일정을 지운다. id는 list_events 결과에서 가져온다.',
    input_schema: obj({ id: { type: 'string' } }, ['id']),
  },
  {
    name: 'get_air_quality',
    description: '도시의 현재 미세먼지(PM10)와 초미세먼지(PM2.5) 농도와 한국 기준 등급을 가져온다.',
    input_schema: obj({ city: { type: 'string', description: '도시 이름. 예: 서울' } }, ['city']),
  },
  {
    name: 'exchange_rate',
    description: '환율을 가져와 금액을 바꿔 준다. 유럽중앙은행 기준 환율(영업일 하루 한 번 갱신)이라 은행 실거래가와 조금 다를 수 있다.',
    input_schema: obj(
      {
        from: { type: 'string', description: '통화 코드 세 글자. 예: USD, JPY, EUR, KRW' },
        to: { type: 'string', description: '통화 코드 세 글자' },
        amount: { type: 'number', description: '바꿀 금액. 기본 1' },
      },
      ['from', 'to']
    ),
  },
  {
    name: 'convert_units',
    description: '단위를 정확하게 바꾼다. 길이, 무게, 부피, 넓이(평 포함), 속도, 온도. 예: value=30 from=평 to=m2',
    input_schema: obj(
      { value: { type: 'number' }, from: { type: 'string' }, to: { type: 'string' } },
      ['value', 'from', 'to']
    ),
  },
  {
    name: 'date_calc',
    description:
      '날짜 계산. op=dday(date까지 남은 날, 디데이), diff(date부터 date2까지 일수), add(date에 days일 더한 날짜와 요일, date 없으면 오늘). 날짜는 YYYY-MM-DD.',
    input_schema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['dday', 'diff', 'add'] },
        date: { type: 'string' },
        date2: { type: 'string' },
        days: { type: 'integer' },
      },
      required: ['op'],
    },
  },
  {
    name: 'random',
    description: '공정한 무작위 뽑기. mode=coin(동전), dice(주사위, sides면), number(min~max 정수), pick(options 중 count개).',
    input_schema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['coin', 'dice', 'number', 'pick'] },
        sides: { type: 'integer' },
        min: { type: 'integer' },
        max: { type: 'integer' },
        options: { type: 'array', items: { type: 'string' } },
        count: { type: 'integer' },
      },
      required: ['mode'],
    },
  },
  {
    name: 'list_memories',
    description: '저장된 중요 기억을 최근 것부터 보여 준다. "내 기억 보여 줘"에 쓴다.',
    input_schema: obj({ limit: { type: 'integer', description: '1 ~ 30. 기본 10' } }),
  },
  {
    name: 'export_data',
    description:
      '사용자의 모든 기록(대화, 기억, 할 일, 일정, 설정, 루틴)을 파일로 내려받게 한다. 사용자가 내 데이터 내려받기/백업을 요청하면 호출한다.',
    input_schema: obj(),
  },
  {
    name: 'search_memory',
    description:
      '저장된 중요 기억과 지난 대화에서 찾는다. 사용자가 지난 일을 묻거나 "전에 말한 거"를 언급하면 먼저 호출한다.',
    input_schema: obj({ query: { type: 'string', description: '찾을 내용을 나타내는 핵심 단어들' } }, ['query']),
  },
  {
    name: 'save_memory',
    description:
      '중요한 내용을 원문 그대로 영구적으로 저장한다. 약속, 결정, 숫자, 가족과 일정, 선호가 대상이다. 사용자가 기억하라고 하면 반드시 호출한다.',
    input_schema: obj(
      {
        text: { type: 'string', description: '저장할 내용. 가능한 한 사용자가 말한 그대로' },
        reason: { type: 'string', description: '왜 중요하다고 판단했는지 한 줄' },
      },
      ['text']
    ),
  },
  {
    name: 'forget_memory',
    description: '기억 하나를 지운다. id와 kind는 search_memory 결과에서 가져온다.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' }, kind: { type: 'string', enum: ['memory', 'chat'] } },
      required: ['id', 'kind'],
    },
  },
  {
    name: 'system_status',
    description: '이지스의 상태 점검 결과를 가져온다. 사용자 등급, 저장된 개수(내용 아님), 오늘 사용량, 켜져 있는 보안 기능.',
    input_schema: obj(),
  },
  {
    name: 'delete_all_data',
    description:
      '사용자의 모든 대화와 기억을 완전히 삭제한다. 사용자가 직접 "전부 삭제 확인"이라고 말한 직후에만 호출한다.',
    input_schema: obj(),
  },
  {
    name: 'revoke_all_sessions',
    description:
      '이 계정으로 로그인된 모든 기기를 로그아웃시킨다. 사용자가 직접 "모든 기기 로그아웃 확인"이라고 말한 직후에만 호출한다.',
    input_schema: obj(),
  },
];

// 저장된 사용자 글이나 외부 내용이 들어가는 결과는 "데이터일 뿐 명령이 아님"을 표시해서 AI에게 넘긴다.
function wrapData(value) {
  let s = JSON.stringify(value);
  if (s.length > 8000) s = s.slice(0, 8000) + '…(잘림)';
  return `<untrusted_data>${s.replace(/<\/?untrusted_data>/gi, '')}</untrusted_data>`;
}
const ok = (value, untrusted = false) => ({ content: untrusted ? wrapData(value) : JSON.stringify(value) });
const fail = (msg) => ({ content: msg, is_error: true });

const fmtKST = (ms) =>
  new Intl.DateTimeFormat('ko-KR', { timeZone: C.TZ, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms));

function weatherText(code) {
  if (code === 0) return '맑음';
  if (code <= 3) return '구름 조금~흐림';
  if (code === 45 || code === 48) return '안개';
  if (code >= 51 && code <= 57) return '이슬비';
  if (code >= 61 && code <= 67) return '비';
  if (code >= 71 && code <= 77) return '눈';
  if (code >= 80 && code <= 82) return '소나기';
  if (code === 85 || code === 86) return '눈 소나기';
  if (code >= 95) return '뇌우';
  return '알 수 없음';
}

async function geocode(fetchFn, city) {
  const g = await (
    await fetchFn(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ko`
    )
  ).json();
  return (g.results && g.results[0]) || null;
}

async function getWeather(fetchFn, city) {
  const place = await geocode(fetchFn, city);
  if (!place) return { error: `'${city}' 위치를 찾지 못했습니다.` };
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
    `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=2`;
  const w = await (await fetchFn(url)).json();
  const c = w.current || {};
  const d = w.daily || {};
  return {
    장소: `${place.name}${place.country ? ', ' + place.country : ''}`,
    현재: {
      날씨: weatherText(c.weather_code),
      기온: c.temperature_2m,
      체감: c.apparent_temperature,
      바람_mps: c.wind_speed_10m,
      강수_mm: c.precipitation,
    },
    오늘: { 최고: d.temperature_2m_max?.[0], 최저: d.temperature_2m_min?.[0], 강수확률: d.precipitation_probability_max?.[0] },
    내일: { 최고: d.temperature_2m_max?.[1], 최저: d.temperature_2m_min?.[1], 강수확률: d.precipitation_probability_max?.[1] },
  };
}

// 환경부 대기질 등급 (PM10, PM2.5 µg/m³)
function airGrade(v, cuts) {
  if (typeof v !== 'number') return '알 수 없음';
  if (v <= cuts[0]) return '좋음';
  if (v <= cuts[1]) return '보통';
  if (v <= cuts[2]) return '나쁨';
  return '매우 나쁨';
}

async function getAirQuality(fetchFn, city) {
  const place = await geocode(fetchFn, city);
  if (!place) return { error: `'${city}' 위치를 찾지 못했습니다.` };
  const a = await (
    await fetchFn(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${place.latitude}&longitude=${place.longitude}` +
        `&current=pm10,pm2_5&timezone=auto`
    )
  ).json();
  const c = a.current || {};
  return {
    장소: `${place.name}${place.country ? ', ' + place.country : ''}`,
    미세먼지_PM10: { 농도: c.pm10, 등급: airGrade(c.pm10, [30, 80, 150]) },
    초미세먼지_PM2_5: { 농도: c.pm2_5, 등급: airGrade(c.pm2_5, [15, 35, 75]) },
    단위: 'µg/m³',
    출처: '모델 추정치(Open-Meteo). 측정소 실측과 다를 수 있다.',
  };
}

async function getExchange(fetchFn, from, to, amount) {
  const res = await fetchFn(`https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`);
  if (!res.ok) return { error: '환율 정보를 가져오지 못했습니다. 지원하지 않는 통화일 수 있습니다.' };
  const r = await res.json();
  const rate = r.rates && r.rates[to];
  if (typeof rate !== 'number') return { error: '해당 통화의 환율이 없습니다.' };
  return {
    기준일: r.date,
    환율: `1 ${from} = ${rate} ${to}`,
    금액: amount,
    결과: Number((amount * rate).toFixed(to === 'KRW' || to === 'JPY' ? 0 : 2)),
    출처: '유럽중앙은행 기준 환율',
  };
}

function randomPick(input) {
  const ri = (lo, hi) => nodeCrypto.randomInt(lo, hi + 1);
  switch (input.mode) {
    case 'coin':
      return { 결과: ri(0, 1) ? '앞면' : '뒷면' };
    case 'dice': {
      const sides = Math.trunc(Number(input.sides) || 6);
      if (sides < 2 || sides > 1000) throw new Error('주사위 면 수는 2 ~ 1000이어야 합니다.');
      return { 결과: ri(1, sides), 면: sides };
    }
    case 'number': {
      const min = Math.trunc(Number(input.min));
      const max = Math.trunc(Number(input.max));
      if (!Number.isFinite(min) || !Number.isFinite(max) || min > max || max - min > 1e9) throw new Error('범위가 올바르지 않습니다.');
      return { 결과: ri(min, max), 범위: `${min} ~ ${max}` };
    }
    case 'pick': {
      const opts = (Array.isArray(input.options) ? input.options : []).map((o) => String(o).slice(0, 100)).slice(0, 100);
      if (opts.length < 1) throw new Error('고를 항목이 없습니다.');
      const count = Math.min(opts.length, Math.max(1, Math.trunc(Number(input.count) || 1)));
      const pool = opts.slice();
      const out = [];
      for (let i = 0; i < count; i++) out.push(pool.splice(ri(0, pool.length - 1), 1)[0]);
      return { 결과: out };
    }
    default:
      throw new Error('mode는 coin, dice, number, pick 중 하나여야 합니다.');
  }
}

const CURRENCY = /^[A-Z]{3}$/;

const NEED_RECENT =
  '보안을 위해 로그인한 지 얼마 안 됐을 때만 가능하다. 사용자에게 한 번 로그아웃했다가 다시 로그인한 뒤에 다시 말해 달라고 안내해라.';

async function run(name, input, ctx) {
  const { uid, tier, store, fetchFn } = ctx;
  switch (name) {
    case 'get_weather': {
      const city = String(input.city || '').trim();
      if (!city) return fail('도시 이름이 비었습니다.');
      return ok(await getWeather(fetchFn, city));
    }
    case 'calculate': {
      try {
        return ok({ 결과: calculate(input.expression) });
      } catch (e) {
        return fail(e.message);
      }
    }
    case 'current_time': {
      const tz = String(input.timezone || C.TZ);
      try {
        const now = ctx.now ? ctx.now() : new Date();
        return ok({
          시간대: tz,
          지금: new Intl.DateTimeFormat('ko-KR', { timeZone: tz, dateStyle: 'full', timeStyle: 'medium' }).format(now),
        });
      } catch (_) {
        return fail('알 수 없는 시간대입니다. IANA 이름(예: Asia/Tokyo)을 써야 합니다.');
      }
    }
    case 'set_timer': {
      const seconds = Math.floor(Number(input.seconds));
      if (!Number.isFinite(seconds) || seconds < 1 || seconds > 86400) return fail('타이머는 1초에서 24시간 사이여야 합니다.');
      const label = redact(String(input.label || '').slice(0, 40));
      ctx.actions.push({ type: 'timer', seconds, label });
      return ok({ set: true, seconds, label });
    }
    case 'add_todo': {
      const text = redact(String(input.text || '').trim());
      if (!text) return fail('할 일 내용이 비었습니다.');
      const id = await store.addTodo(uid, text, input.due ? String(input.due).slice(0, 80) : null);
      return ok({ added: true, id });
    }
    case 'list_todos':
      return ok({ todos: await store.listTodos(uid) }, true);
    case 'complete_todo': {
      const done = await store.completeTodo(uid, String(input.id || ''));
      return done ? ok({ done: true }) : fail('해당 할 일을 찾지 못했습니다.');
    }
    case 'delete_todo': {
      const removed = await store.deleteTodo(uid, String(input.id || ''));
      return removed ? ok({ deleted: true }) : fail('해당 할 일을 찾지 못했습니다.');
    }
    case 'add_event': {
      const title = redact(String(input.title || '').trim().slice(0, 100));
      if (!title) return fail('일정 내용이 비었습니다.');
      let at;
      try {
        at = parseWhen(input.start);
      } catch (e) {
        return fail(e.message);
      }
      const nowMs = (ctx.now ? ctx.now() : new Date()).getTime();
      if (at < nowMs - DAY) return fail('이미 지난 시각입니다. 날짜를 다시 확인해라.');
      if (at > nowMs + C.MAX_EVENT_DAYS * DAY) return fail('너무 먼 미래의 일정입니다.');
      const rm = input.remind_minutes === undefined ? 10 : Math.trunc(Number(input.remind_minutes));
      if (!Number.isFinite(rm) || rm < 0 || rm > 10080) return fail('알림은 0분에서 10080분(일주일) 전 사이여야 합니다.');
      const id = await store.addEvent(uid, title, at, rm, tier);
      if (id === 'full') return fail(`일정은 ${C.MAX_EVENTS}개까지 저장할 수 있습니다. 지난 일정을 지워 달라고 안내해라.`);
      ctx.actions.push({ type: 'reminders' });
      return ok({ added: true, id, 시각: fmtFull(at), 알림: rm ? `${rm}분 전` : '정각' });
    }
    case 'list_events': {
      const days = Math.min(90, Math.max(1, Math.trunc(Number(input.days) || 7)));
      const nowMs = (ctx.now ? ctx.now() : new Date()).getTime();
      const list = await store.listEvents(uid, nowMs - 3600000, nowMs + days * DAY);
      return ok({ 범위_일: days, events: list.map((e) => ({ id: e.id, 내용: e.title, 시각: fmtFull(e.at), 알림_분전: e.remindMin })) }, true);
    }
    case 'delete_event': {
      const removed = await store.deleteEvent(uid, String(input.id || ''));
      if (removed) ctx.actions.push({ type: 'reminders' });
      return removed ? ok({ deleted: true }) : fail('해당 일정을 찾지 못했습니다.');
    }
    case 'get_air_quality': {
      const city = String(input.city || '').trim();
      if (!city) return fail('도시 이름이 비었습니다.');
      return ok(await getAirQuality(fetchFn, city));
    }
    case 'exchange_rate': {
      const from = String(input.from || '').trim().toUpperCase();
      const to = String(input.to || '').trim().toUpperCase();
      if (!CURRENCY.test(from) || !CURRENCY.test(to)) return fail('통화 코드는 USD, KRW 같은 영문 세 글자여야 합니다.');
      const amount = input.amount === undefined ? 1 : Number(input.amount);
      if (!Number.isFinite(amount) || amount < 0 || amount > 1e12) return fail('금액이 올바르지 않습니다.');
      if (from === to) return ok({ 결과: amount });
      return ok(await getExchange(fetchFn, from, to, amount));
    }
    case 'convert_units': {
      try {
        return ok({ 결과: convert(input.value, input.from, input.to), 단위: String(input.to) });
      } catch (e) {
        return fail(e.message);
      }
    }
    case 'date_calc': {
      try {
        return ok(dateCalc(input, ctx.now ? ctx.now() : new Date()));
      } catch (e) {
        return fail(e.message);
      }
    }
    case 'random': {
      try {
        return ok(randomPick(input));
      } catch (e) {
        return fail(e.message);
      }
    }
    case 'list_memories': {
      const limit = Math.min(30, Math.max(1, Math.trunc(Number(input.limit) || 10)));
      const mems = await store.listMemories(uid, limit);
      return ok(
        { memories: mems.map((m) => ({ id: m.id, kind: 'memory', 시각: fmtKST(m.createdAt), 내용: m.text, 저장_이유: m.reason || undefined })) },
        true
      );
    }
    case 'export_data': {
      if (!ctx.recentLogin) return fail(NEED_RECENT);
      ctx.actions.push({ type: 'export' });
      return ok({ started: true, note: '화면이 파일을 내려받는다. 파일에는 대화 내용이 그대로 들어 있으니 안전한 곳에 보관하라고 안내해라.' });
    }
    case 'set_pref': {
      const key = String(input.key || '');
      if (!/^[a-z_]{1,30}$/.test(key)) return fail('key는 영문 소문자와 밑줄만, 30자 이하여야 합니다.');
      const value = redact(String(input.value || '').slice(0, 200));
      const r = await store.setPref(uid, key, value);
      return r === 'full' ? fail(`저장할 수 있는 설정은 ${C.MAX_PREFS}개까지입니다.`) : ok({ saved: true });
    }
    case 'get_prefs':
      return ok({ prefs: await store.getPrefs(uid) }, true);
    case 'save_routine': {
      const rname = redact(String(input.name || '').trim().slice(0, 40));
      const steps = redact(String(input.steps || '').trim().slice(0, 1000));
      if (!rname || !steps) return fail('이름과 단계가 모두 필요합니다.');
      const r = await store.saveRoutine(uid, rname, steps);
      return r === 'full' ? fail(`루틴은 ${C.MAX_ROUTINES}개까지 저장할 수 있습니다.`) : ok({ saved: true });
    }
    case 'list_routines':
      return ok({ routines: await store.listRoutines(uid) }, true);
    case 'delete_routine': {
      const removed = await store.deleteRoutine(uid, String(input.name || '').trim());
      return removed ? ok({ deleted: true }) : fail('해당 루틴을 찾지 못했습니다.');
    }
    case 'search_memory': {
      const q = String(input.query || '').trim();
      if (!q) return fail('검색어가 비었습니다.');
      const mems = (await store.listMemories(uid, C.SEARCH_POOL)).map((m) => ({ ...m, kind: 'memory', ts: m.createdAt }));
      const chats = (await store.recentMessages(uid, C.SEARCH_POOL))
        .filter((m) => m.id !== ctx.currentMessageId) // 지금 한 말 자체는 제외
        .map((m) => ({ ...m, kind: 'chat' }));
      const hits = rank([...mems, ...chats], q, 6);
      for (const h of hits) await store.touch(uid, h.kind === 'memory' ? 'memories' : 'messages', h.id, tier);
      return ok(
        {
          results: hits.map((h) => ({
            id: h.id,
            kind: h.kind,
            종류: h.kind === 'memory' ? '중요 기억' : '지난 대화',
            시각: fmtKST(h.ts),
            화자: h.kind === 'chat' ? (h.role === 'assistant' ? '이지스' : '사용자') : undefined,
            내용: h.text,
            저장_이유: h.reason || undefined,
          })),
          note: hits.length ? undefined : '찾지 못했다.',
        },
        true
      );
    }
    case 'save_memory': {
      const raw = String(input.text || '').trim();
      if (!raw) return fail('저장할 내용이 비었습니다.');
      const text = redact(raw);
      const id = await store.saveMemory(uid, text, redact(String(input.reason || '')), tier);
      return ok({ saved: true, id, note: text !== raw ? '민감한 번호는 지우고 저장했다.' : undefined });
    }
    case 'forget_memory': {
      const col = input.kind === 'memory' ? 'memories' : 'messages';
      const removed = await store.deleteItem(uid, col, String(input.id || ''));
      return removed ? ok({ forgotten: true }) : fail('해당 기억을 찾지 못했습니다.');
    }
    case 'system_status': {
      const s = await store.stats(uid);
      return ok({
        등급: tier === 'master' ? '마스터' : '기본',
        모델: C.MODELS[tier],
        저장된_개수: { 대화: s.messages, 중요기억: s.memories, 할일: s.todos, 일정: s.events, 루틴: s.routines },
        오늘_사용: `${s.usageToday} / ${C.DAILY_LIMIT[tier]}`,
        보관: tier === 'master' ? '영구' : `${C.BASIC_RETENTION_DAYS}일 (다시 언급되면 갱신)`,
        보안: {
          저장_암호화: '사용자별 키 (AES-256-GCM)',
          앱_검증_App_Check: ctx.flags.appCheck ? '켜짐' : '꺼짐',
          허용_계정_제한: ctx.flags.allowlist ? '켜짐' : '꺼짐',
          웹_검색: ctx.flags.webSearch ? '켜짐' : '꺼짐',
        },
        note: '대화 내용은 이 점검에 포함되지 않는다.',
      });
    }
    case 'delete_all_data': {
      if (!ctx.recentLogin) return fail(NEED_RECENT);
      if (!confirmsDeleteAll(ctx.lastUserText)) {
        return fail('사용자가 직접 "전부 삭제 확인"이라고 말해야 삭제할 수 있다. 되돌릴 수 없다고 안내하고 확인을 요청해라.');
      }
      await store.deleteAll(uid);
      return ok({ deleted: true });
    }
    case 'revoke_all_sessions': {
      if (!ctx.recentLogin) return fail(NEED_RECENT);
      if (!confirmsRevoke(ctx.lastUserText)) {
        return fail('사용자가 직접 "모든 기기 로그아웃 확인"이라고 말해야 한다. 모든 기기에서 로그아웃된다고 안내하고 확인을 요청해라.');
      }
      await ctx.revokeSessions(uid);
      ctx.actions.push({ type: 'signout' });
      return ok({ revoked: true });
    }
    default:
      return fail(`알 수 없는 도구: ${name}`);
  }
}

// 마스터는 웹 검색(Anthropic 서버 도구)이 추가로 들어간다.
function definitions(opts = {}) {
  const list = DEFINITIONS.slice();
  if (opts.webSearch) {
    list.push({
      type: C.WEB_SEARCH_TOOL,
      name: 'web_search',
      max_uses: C.WEB_SEARCH_MAX_USES,
      user_location: { type: 'approximate', country: 'KR', timezone: C.TZ },
    });
  }
  return list;
}

module.exports = { definitions, run };
