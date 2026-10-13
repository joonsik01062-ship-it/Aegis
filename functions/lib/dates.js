// 날짜 계산과 일정 시각 해석. 기준은 한국 시간.
const C = require('./config');

const DAY = 86400000;
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

// 한국 시간 기준 오늘 날짜 'YYYY-MM-DD'
const todayKST = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: C.TZ }).format(now);

// 'YYYY-MM-DD' → 그 날의 UTC 자정 ms (날짜끼리 빼기용)
function dayNum(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) throw new Error(`날짜는 YYYY-MM-DD 형식이어야 합니다: ${s}`);
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(ms);
  if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw new Error(`없는 날짜입니다: ${s}`);
  return ms;
}
const fmtDay = (ms) => {
  const d = new Date(ms);
  return { 날짜: d.toISOString().slice(0, 10), 요일: WEEK[d.getUTCDay()] + '요일' };
};

// op: diff(두 날짜 사이 일수) | add(날짜에 일수 더하기) | dday(오늘부터 목표일까지)
function dateCalc({ op, date, date2, days }, now = new Date()) {
  const today = dayNum(todayKST(now));
  if (op === 'diff') {
    const a = dayNum(date);
    const b = dayNum(date2);
    return { 일수: Math.round((b - a) / DAY), 시작: fmtDay(a), 끝: fmtDay(b) };
  }
  if (op === 'add') {
    const n = Math.trunc(Number(days));
    if (!Number.isFinite(n) || Math.abs(n) > 365 * 200) throw new Error('일수가 올바르지 않습니다.');
    return { 결과: fmtDay((date ? dayNum(date) : today) + n * DAY), 더한_일수: n };
  }
  if (op === 'dday') {
    const t = dayNum(date);
    const n = Math.round((t - today) / DAY);
    return { 목표: fmtDay(t), 남은_일수: n, 표기: n === 0 ? 'D-DAY' : n > 0 ? `D-${n}` : `D+${-n}` };
  }
  throw new Error('op는 diff, add, dday 중 하나여야 합니다.');
}

// 일정 시각 해석: 'YYYY-MM-DDTHH:mm' 또는 'YYYY-MM-DD HH:mm'은 한국 시간으로 본다. 시간대가 붙어 있으면 그대로 쓴다.
function parseWhen(s) {
  const str = String(s || '').trim();
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?(Z|[+-]\d{2}:?\d{2})?$/.exec(str);
  if (!m) throw new Error('시각은 YYYY-MM-DDTHH:mm 형식(한국 시간)이어야 합니다.');
  dayNum(m[1]);
  if (+m[2] > 23 || +m[3] > 59) throw new Error('없는 시각입니다.');
  const ms = Date.parse(`${m[1]}T${m[2]}:${m[3]}:00${m[4] || '+09:00'}`);
  if (!Number.isFinite(ms)) throw new Error('시각을 해석하지 못했습니다.');
  return ms;
}

const fmtKST = (ms) =>
  new Intl.DateTimeFormat('ko-KR', { timeZone: C.TZ, dateStyle: 'full', timeStyle: 'short' }).format(new Date(ms));

module.exports = { dateCalc, parseWhen, todayKST, fmtKST, DAY };
