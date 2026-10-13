// 이지스 서버 설정. 숫자나 모델을 바꾸고 싶으면 여기만 고치면 된다.
module.exports = {
  REGION: 'asia-northeast3', // 서울
  TZ: 'Asia/Seoul',
  ADDRESS: '주인님',

  // 기본 = 일반 성능, 마스터 = 상위 모델. 환경변수로 덮어쓸 수 있다.
  // 마스터를 가장 높은 등급으로 올리려면 AEGIS_MODEL_MASTER=claude-fable-5-1 로 설정.
  MODELS: {
    basic: process.env.AEGIS_MODEL_BASIC || 'claude-sonnet-5-5',
    master: process.env.AEGIS_MODEL_MASTER || 'claude-opus-5-5',
  },
  MAX_TOKENS: { basic: 700, master: 1200 },

  // 사용량 한도 (비용 폭주와 자동화 공격 방어). 한국 시간 기준.
  BURST_PER_MINUTE: 8, // 한 사용자가 1분에 보낼 수 있는 횟수
  DAILY_LIMIT: { basic: 40, master: 300 }, // 한 사용자의 하루 대화 횟수
  GLOBAL_DAILY_LIMIT: 3000, // 서비스 전체 하루 대화 횟수 (이걸 넘으면 모두에게 잠시 중단)

  // 기본 사용자는 30일 보관. 다시 언급(검색에 걸림)되면 그때부터 다시 30일.
  // 마스터는 영구 보관.
  BASIC_RETENTION_DAYS: 30,

  HISTORY_TURNS: 20, // 대화 이어가기용으로 불러오는 최근 메시지 수
  SEARCH_POOL: 300, // 기억 검색 때 훑는 최근 기록 수
  MAX_INPUT_CHARS: 1500,
  MAX_BODY_BYTES: 8192, // 요청 본문 크기 상한
  MAX_TOOL_ROUNDS: 6,
  MAX_TIMER_SECONDS: 86400,
  MAX_PREFS: 30,
  MAX_ROUTINES: 30,
  RECENT_LOGIN_SECONDS: 600, // 삭제, 전체 로그아웃은 로그인한 지 10분 이내만 허용

  // 마스터 전용 웹 검색 (Anthropic 서버 도구). AEGIS_WEB_SEARCH=false 로 끌 수 있다.
  WEB_SEARCH_ENABLED: process.env.AEGIS_WEB_SEARCH !== 'false',
  WEB_SEARCH_TOOL: 'web_search_20250305',
  WEB_SEARCH_MAX_USES: 3,
};
