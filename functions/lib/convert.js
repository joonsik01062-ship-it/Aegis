// 단위 변환. 순수 함수라 외부 연결 없이 정확하게 계산한다.
// 각 단위는 기준 단위(길이 m, 무게 kg, 부피 L, 넓이 m², 속도 m/s)로 몇 배인지 적는다. 온도는 따로 처리한다.
const UNITS = {
  length: {
    mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344, nmi: 1852,
  },
  mass: { mg: 1e-6, g: 0.001, kg: 1, t: 1000, oz: 0.028349523125, lb: 0.45359237, don: 0.00375 },
  volume: { ml: 0.001, l: 1, m3: 1000, cup: 0.2365882365, floz: 0.0295735295625, gal: 3.785411784 },
  area: { m2: 1, km2: 1e6, cm2: 1e-4, ha: 1e4, a: 100, pyeong: 400 / 121, ft2: 0.09290304, acre: 4046.8564224 },
  speed: { 'm/s': 1, 'km/h': 1000 / 3600, mph: 0.44704, knot: 1852 / 3600 },
};

// 사람이 말하는 이름 → 단위 기호
const ALIASES = {
  밀리미터: 'mm', 센티미터: 'cm', 센치: 'cm', 미터: 'm', 킬로미터: 'km', 인치: 'in', inch: 'in',
  피트: 'ft', feet: 'ft', foot: 'ft', 야드: 'yd', 마일: 'mi', mile: 'mi', 해리: 'nmi',
  밀리그램: 'mg', 그램: 'g', 킬로그램: 'kg', 킬로: 'kg', 톤: 't', 온스: 'oz', 파운드: 'lb', lbs: 'lb', 돈: 'don',
  밀리리터: 'ml', 리터: 'l', 컵: 'cup', 갤런: 'gal', 'fl oz': 'floz',
  제곱미터: 'm2', '㎡': 'm2', 'm²': 'm2', 제곱킬로미터: 'km2', 'km²': 'km2', 제곱센티미터: 'cm2', 헥타르: 'ha', 아르: 'a',
  평: 'pyeong', 에이커: 'acre', 제곱피트: 'ft2', 'ft²': 'ft2', 세제곱미터: 'm3', 'm³': 'm3',
  kph: 'km/h', 시속: 'km/h', 초속: 'm/s', 노트: 'knot', kn: 'knot', kt: 'knot',
  섭씨: 'c', '°c': 'c', '℃': 'c', 화씨: 'f', '°f': 'f', '℉': 'f', 켈빈: 'k',
};

function norm(u) {
  const s = String(u || '').trim().toLowerCase();
  return ALIASES[s] || s;
}

const TEMP = {
  c: { toK: (v) => v + 273.15, fromK: (k) => k - 273.15 },
  f: { toK: (v) => ((v - 32) * 5) / 9 + 273.15, fromK: (k) => ((k - 273.15) * 9) / 5 + 32 },
  k: { toK: (v) => v, fromK: (k) => k },
};

const round = (x) => Number(x.toPrecision(10));

function convert(value, from, to) {
  const v = Number(value);
  if (!Number.isFinite(v)) throw new Error('숫자가 아닙니다.');
  const a = norm(from);
  const b = norm(to);
  if (TEMP[a] && TEMP[b]) return round(TEMP[b].fromK(TEMP[a].toK(v)));
  for (const table of Object.values(UNITS)) {
    if (a in table && b in table) return round((v * table[a]) / table[b]);
  }
  throw new Error(`'${from}'에서 '${to}'로는 바꿀 수 없습니다. 같은 종류(길이, 무게, 부피, 넓이, 속도, 온도)끼리만 됩니다.`);
}

module.exports = { convert };
