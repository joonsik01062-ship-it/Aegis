// 테스트용 가짜 저장소와 가짜 Claude/날씨 서버. (실제 Firebase나 API 키 없이 로직만 검증)
function makeFakeStore() {
  const s = {
    tier: 'basic',
    usage: 0,
    messages: [],
    memories: [],
    todos: [],
    routines: [],
    prefs: {},
    touched: [],
    deleted: [],
    seq: 0,
  };
  const id = () => 'id' + ++s.seq;
  const api = {
    state: s,
    async getUser() { return { tier: s.tier }; },
    async setTier(_u, t) { s.tier = t; },
    async consumeBurst() { return s.burstBlocked ? false : true; },
    async consumeGlobal() { return s.globalBlocked ? false : true; },
    async consumeUsage(_u, limit) { if (s.usage >= limit) return false; s.usage++; return true; },
    async addMessage(_u, role, text, tier) { const m = { id: id(), role, text, ts: Date.now(), tier }; s.messages.push(m); return m.id; },
    async recentMessages(_u, n) { return s.messages.slice(-n); },
    async listMemories() { return s.memories.slice().reverse(); },
    async saveMemory(_u, text, reason, tier) { const m = { id: id(), text, reason, createdAt: Date.now(), tier }; s.memories.push(m); return m.id; },
    async touch(_u, col, i, tier) { s.touched.push({ col, id: i, tier }); },
    async deleteItem(_u, col, i) {
      const arr = col === 'memories' ? s.memories : s.messages;
      const k = arr.findIndex((x) => x.id === i);
      if (k < 0) return false;
      arr.splice(k, 1);
      return true;
    },
    async addTodo(_u, text, due) { const t = { id: id(), text, due, done: false }; s.todos.push(t); return t.id; },
    async listTodos() { return s.todos.filter((t) => !t.done); },
    async completeTodo(_u, i) { const t = s.todos.find((x) => x.id === i); if (!t) return false; t.done = true; return true; },
    async getPrefs() { return { ...s.prefs }; },
    async setPref(_u, key, value) {
      if (!value) { delete s.prefs[key]; return 'ok'; }
      if (!(key in s.prefs) && Object.keys(s.prefs).length >= 30) return 'full';
      s.prefs[key] = value;
      return 'ok';
    },
    async listRoutines() { return s.routines.slice(); },
    async saveRoutine(_u, name, steps) {
      const r = s.routines.find((x) => x.name === name);
      if (r) { r.steps = steps; return 'ok'; }
      if (s.routines.length >= 30) return 'full';
      s.routines.push({ id: id(), name, steps });
      return 'ok';
    },
    async deleteRoutine(_u, name) {
      const k = s.routines.findIndex((x) => x.name === name);
      if (k < 0) return false;
      s.routines.splice(k, 1);
      return true;
    },
    async stats() {
      return { messages: s.messages.length, memories: s.memories.length, todos: s.todos.length, routines: s.routines.length, usageToday: s.usage };
    },
    async deleteAll() { s.messages = []; s.memories = []; s.todos = []; s.routines = []; s.prefs = {}; s.deleted.push('all'); },
  };
  return api;
}

// scripts: Claude가 순서대로 돌려줄 응답들. calls: 보낸 요청 기록.
function makeFakeFetch(scripts) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    if (String(url).includes('api.anthropic.com')) {
      const body = JSON.parse(opts.body);
      calls.push({ url, headers: opts.headers, body });
      const next = scripts.shift();
      if (!next) throw new Error('예상보다 많은 Claude 호출');
      return { ok: true, status: 200, json: async () => next, text: async () => '' };
    }
    if (String(url).includes('geocoding-api.open-meteo.com')) {
      return { ok: true, json: async () => ({ results: [{ name: '서울', country: '대한민국', latitude: 37.5, longitude: 127 }] }) };
    }
    if (String(url).includes('api.open-meteo.com')) {
      return {
        ok: true,
        json: async () => ({
          current: { weather_code: 0, temperature_2m: 21, apparent_temperature: 20, wind_speed_10m: 2, precipitation: 0 },
          daily: { temperature_2m_max: [24, 25], temperature_2m_min: [14, 15], precipitation_probability_max: [10, 20] },
        }),
      };
    }
    throw new Error('예상하지 못한 URL: ' + url);
  };
  fn.calls = calls;
  return fn;
}

const text = (t) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
const toolUse = (name, input, id = 'tu_1') => ({
  stop_reason: 'tool_use',
  content: [{ type: 'text', text: '잠시만요.' }, { type: 'tool_use', id, name, input }],
});

// 도구 결과에서 <untrusted_data> 표시를 벗기고 JSON으로 읽는다.
const readResult = (content) => JSON.parse(String(content).replace(/^<untrusted_data>/, '').replace(/<\/untrusted_data>$/, ''));

module.exports = { makeFakeStore, makeFakeFetch, text, toolUse, readResult };
