// 대화 한 번을 처리하는 핵심 로직. Firestore/Anthropic은 deps로 주입받아서 가짜로 테스트할 수 있다.
const C = require('./config');
const { redact } = require('./redact');
const { checkPhrase, masterAllowed } = require('./unlock');
const { cleanInput, isRecentLogin } = require('./security');
const { buildSystem } = require('./persona');
const tools = require('./tools');

const R = {
  masterOn: `어서 오십시오, ${C.ADDRESS}. 모든 기능이 활성화되었습니다.`,
  masterAlready: `이미 마스터 모드로 모시고 있습니다, ${C.ADDRESS}.`,
  masterOff: `마스터 모드를 종료했습니다, ${C.ADDRESS}. 기본 모드로 돌아갑니다.`,
  masterDenied: `죄송합니다, ${C.ADDRESS}. 이 계정은 마스터 모드가 허용되지 않았습니다.`,
  limit: `오늘 사용 한도에 도달했습니다, ${C.ADDRESS}. 내일 다시 말씀해 주세요.`,
  burst: `너무 빠르게 말씀하셨습니다, ${C.ADDRESS}. 잠시 후 다시 말씀해 주세요.`,
  busy: `지금 이지스가 많이 바쁩니다, ${C.ADDRESS}. 잠시 후 다시 불러 주세요.`,
  brain: `지금 두뇌 연결에 문제가 있습니다, ${C.ADDRESS}. 잠시 후 다시 말씀해 주세요.`,
  empty: `말씀을 듣지 못했습니다, ${C.ADDRESS}.`,
  tooLong: `말씀이 너무 깁니다, ${C.ADDRESS}. 조금 나눠서 말씀해 주세요.`,
  done: `처리했습니다, ${C.ADDRESS}.`,
};

async function callClaude({ fetchFn, apiKey, model, max_tokens, system, tools: toolDefs, messages }) {
  const body = { model, max_tokens, system, messages };
  if (toolDefs && toolDefs.length) body.tools = toolDefs;
  const res = await fetchFn('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) {
    const err = new Error(`Anthropic API ${res.status}`);
    err.status = res.status;
    err.detail = (await res.text()).slice(0, 300);
    throw err;
  }
  return res.json();
}

// 저장된 대화를 API 형식(user/assistant 번갈아)으로 만든다.
function toApiMessages(history, current) {
  const out = [];
  const push = (role, text) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += '\n' + text;
    else out.push({ role, content: text });
  };
  let started = false;
  for (const m of history) {
    if (!started) {
      if (m.role !== 'user') continue;
      started = true;
    }
    push(m.role, m.text);
  }
  push('user', current);
  return out;
}

async function getMe(deps, uid) {
  const u = await deps.store.getUser(uid);
  return { tier: u.tier, master: u.tier === 'master' };
}

async function handleChat(deps, uid, rawText) {
  const { store, fetchFn, apiKey, email, masterAllowlist = [], now = () => new Date(), log = () => {}, audit = () => {} } = deps;
  const flags = deps.flags || {};
  if (typeof rawText !== 'string' || !rawText.trim()) return { status: 400, body: { reply: R.empty } };
  if (rawText.length > C.MAX_INPUT_CHARS) return { status: 400, body: { reply: R.tooLong } };

  // 보이지 않는 글자를 먼저 걷어내고, 민감한 번호를 지운 뒤에야 저장하거나 AI에게 보낸다.
  const text = redact(cleanInput(rawText));
  if (!text) return { status: 400, body: { reply: R.empty } };
  const user = await store.getUser(uid);
  let tier = user.tier;

  // 마스터 모드 해금/해제 (AI를 거치지 않고 서버가 직접 처리)
  const phrase = checkPhrase(text);
  if (phrase) {
    let reply = null;
    if (phrase === 'on') {
      if (tier === 'master') reply = R.masterAlready;
      else if (!masterAllowed(email, masterAllowlist)) {
        audit('master_denied');
        reply = R.masterDenied;
      } else {
        await store.setTier(uid, 'master');
        tier = 'master';
        audit('master_on');
        reply = R.masterOn;
      }
    } else if (phrase === 'off' && tier === 'master') {
      await store.setTier(uid, 'basic');
      tier = 'basic';
      audit('master_off');
      reply = R.masterOff;
    }
    if (reply) {
      await store.addMessage(uid, 'user', text, tier);
      await store.addMessage(uid, 'assistant', reply, tier);
      return { status: 200, body: { reply, master: tier === 'master', unlocked: phrase === 'on' && tier === 'master' } };
    }
  }

  // 속도 제한: 1분당 → 하루 → 서비스 전체 순서로 확인
  if (!(await store.consumeBurst(uid, C.BURST_PER_MINUTE))) {
    audit('rate_burst');
    return { status: 429, body: { reply: R.burst, master: tier === 'master', limited: true } };
  }
  if (!(await store.consumeUsage(uid, C.DAILY_LIMIT[tier]))) {
    audit('rate_daily');
    return { status: 429, body: { reply: R.limit, master: tier === 'master', limited: true } };
  }
  if (!(await store.consumeGlobal(C.GLOBAL_DAILY_LIMIT))) {
    audit('rate_global');
    return { status: 503, body: { reply: R.busy, master: tier === 'master', limited: true } };
  }

  const history = await store.recentMessages(uid, C.HISTORY_TURNS);
  const currentMessageId = await store.addMessage(uid, 'user', text, tier);
  const messages = toApiMessages(history, text);
  const webSearch = tier === 'master' && C.WEB_SEARCH_ENABLED;
  const system = buildSystem({ tier, now: now(), webSearch });
  const toolDefs = tools.definitions({ webSearch });
  const actions = [];
  const ctx = {
    uid, tier, store, fetchFn, lastUserText: text, currentMessageId, actions,
    now,
    flags: { ...flags, webSearch },
    recentLogin: isRecentLogin(deps.authTime, now().getTime(), C.RECENT_LOGIN_SECONDS),
    revokeSessions: deps.revokeSessions || (async () => { throw new Error('revoke unavailable'); }),
  };

  let reply = '';
  try {
    for (let round = 0; round < C.MAX_TOOL_ROUNDS; round++) {
      const resp = await callClaude({
        fetchFn,
        apiKey,
        model: C.MODELS[tier],
        max_tokens: C.MAX_TOKENS[tier],
        system,
        tools: toolDefs,
        messages,
      });
      const blocks = resp.content || [];
      const toolUses = blocks.filter((b) => b.type === 'tool_use');
      if (resp.stop_reason === 'pause_turn') {
        // 서버 도구(웹 검색)가 길어져 잠시 멈춘 응답: 그대로 돌려보내 이어서 진행시킨다.
        messages.push({ role: 'assistant', content: blocks });
        continue;
      }
      if (resp.stop_reason === 'tool_use' && toolUses.length) {
        messages.push({ role: 'assistant', content: blocks });
        const results = [];
        for (const tu of toolUses) {
          let r;
          try {
            r = await tools.run(tu.name, tu.input || {}, ctx);
          } catch (e) {
            log('tool error', tu.name, e.message); // 내용은 로그에 남기지 않는다
            r = { content: '도구 실행 중 오류가 발생했습니다.', is_error: true };
          }
          if (!r.is_error && ['delete_all_data', 'revoke_all_sessions'].includes(tu.name)) audit(tu.name);
          results.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: r.content,
            ...(r.is_error ? { is_error: true } : {}),
          });
        }
        messages.push({ role: 'user', content: results });
        continue;
      }
      reply = blocks
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      break;
    }
  } catch (e) {
    log('claude error', e.status || '', e.detail || e.message);
    return { status: 502, body: { reply: R.brain, master: tier === 'master' } };
  }

  if (!reply) reply = R.done;
  await store.addMessage(uid, 'assistant', reply, tier);
  return { status: 200, body: { reply, master: tier === 'master', ...(actions.length ? { actions: actions.slice(0, 5) } : {}) } };
}

// 화면이 알림을 예약할 수 있도록 앞으로 하루 안의 일정만 돌려준다.
async function getUpcoming(deps, uid) {
  const nowMs = (deps.now ? deps.now() : new Date()).getTime();
  // 알림은 최대 일주일 전에 울릴 수 있으므로 그만큼 앞의 일정까지 본다.
  const list = await deps.store.listEvents(uid, nowMs - 3600000, nowMs + C.UPCOMING_HOURS * 3600000 + 7 * 86400000, 100);
  const horizon = nowMs + C.UPCOMING_HOURS * 3600000;
  return {
    events: list
      .map((e) => ({ id: e.id, title: e.title, at: e.at, remindAt: e.at - e.remindMin * 60000 }))
      .filter((e) => e.remindAt <= horizon && e.at >= nowMs - 3600000),
  };
}

// 내 데이터 내려받기. 로그인한 지 얼마 안 됐을 때만 허용한다 (잠깐 자리를 비운 기기에서 통째로 빼가는 것 방지).
async function exportData(deps, uid) {
  const now = deps.now ? deps.now() : new Date();
  if (!isRecentLogin(deps.authTime, now.getTime(), C.RECENT_LOGIN_SECONDS)) return { status: 403, body: { error: 'reauth' } };
  (deps.audit || (() => {}))('export');
  const data = await deps.store.exportAll(uid);
  return { status: 200, body: { app: 'AEGIS', exportedAt: now.toISOString(), ...data } };
}

module.exports = { handleChat, getMe, getUpcoming, exportData, toApiMessages, R };
