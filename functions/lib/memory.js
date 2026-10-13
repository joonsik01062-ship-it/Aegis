// 기억 검색: 키워드 + 글자 쌍 겹침으로 점수를 매긴다. (v0.1)
// 나중에 의미 검색(벡터 검색)으로 교체할 수 있도록 rank()만 바꾸면 되게 분리했다.
const clean = (s) => String(s).toLowerCase();

function tokens(s) {
  return clean(s)
    .split(/[^0-9a-z가-힣]+/)
    .filter((t) => t.length >= 2);
}

function bigrams(s) {
  const c = clean(s).replace(/\s+/g, '');
  const out = new Set();
  for (let i = 0; i < c.length - 1; i++) out.add(c.slice(i, i + 2));
  return out;
}

function score(query, text) {
  const t = clean(text);
  let sc = 0;
  for (const k of tokens(query)) {
    if (t.includes(k)) sc += 3;
    else if (k.length >= 3 && t.includes(k.slice(0, -1))) sc += 2; // "치과는" → "치과" (조사 대응)
  }
  const qb = bigrams(query);
  const tb = bigrams(text);
  if (qb.size) {
    let hit = 0;
    for (const b of qb) if (tb.has(b)) hit++;
    sc += (hit / qb.size) * 2;
  }
  return sc;
}

function rank(items, query, limit = 6, minScore = 1.2) {
  return items
    .map((it) => ({ it, s: score(query, it.text) }))
    .filter((x) => x.s >= minScore)
    .sort((a, b) => b.s - a.s || (b.it.ts || 0) - (a.it.ts || 0))
    .slice(0, limit)
    .map((x) => x.it);
}

module.exports = { score, rank };
