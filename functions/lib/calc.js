// 안전한 계산기. eval을 쓰지 않고 직접 만든 파서로 계산한다.
// 지원: + - * / % ^ 괄호, 상수 pi e, 함수 sqrt abs round floor ceil ln log sin cos tan
const FUNCS = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  ln: Math.log,
  log: Math.log10,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
};
const CONSTS = { pi: Math.PI, e: Math.E };

function calculate(expression) {
  const src = String(expression).replace(/×/g, '*').replace(/÷/g, '/').replace(/,/g, '');
  if (src.length > 200) throw new Error('식이 너무 깁니다.');
  let i = 0;
  let depth = 0;
  const peek = () => {
    while (src[i] === ' ') i++;
    return src[i];
  };
  const fail = () => {
    throw new Error('계산할 수 없는 식입니다.');
  };

  function parseExpr() {
    let v = parseTerm();
    for (;;) {
      const c = peek();
      if (c === '+') { i++; v += parseTerm(); }
      else if (c === '-') { i++; v -= parseTerm(); }
      else return v;
    }
  }
  function parseTerm() {
    let v = parseFactor();
    for (;;) {
      const c = peek();
      if (c === '*') { i++; v *= parseFactor(); }
      else if (c === '/') {
        i++;
        const d = parseFactor();
        if (d === 0) throw new Error('0으로 나눌 수 없습니다.');
        v /= d;
      } else if (c === '%') {
        i++;
        const d = parseFactor();
        if (d === 0) throw new Error('0으로 나눌 수 없습니다.');
        v %= d;
      } else return v;
    }
  }
  function parseFactor() {
    const base = parseUnary();
    if (peek() === '^') {
      i++;
      return Math.pow(base, parseFactor()); // 오른쪽 결합
    }
    return base;
  }
  function parseUnary() {
    const c = peek();
    if (c === '-') { i++; return -parseUnary(); }
    if (c === '+') { i++; return parseUnary(); }
    return parsePrimary();
  }
  function parsePrimary() {
    if (++depth > 40) throw new Error('식이 너무 복잡합니다.');
    const c = peek();
    let v;
    if (c === '(') {
      i++;
      v = parseExpr();
      if (peek() !== ')') fail();
      i++;
    } else if (/[0-9.]/.test(c || '')) {
      const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
      if (!m) fail();
      i += m[0].length;
      v = parseFloat(m[0]);
    } else if (/[a-z]/i.test(c || '')) {
      const m = /^[a-z]+/i.exec(src.slice(i));
      const name = m[0].toLowerCase();
      i += m[0].length;
      if (peek() === '(') {
        if (!FUNCS[name]) fail();
        i++;
        const arg = parseExpr();
        if (peek() !== ')') fail();
        i++;
        v = FUNCS[name](arg);
      } else if (name in CONSTS) v = CONSTS[name];
      else fail();
    } else fail();
    depth--;
    return v;
  }

  const result = parseExpr();
  if (peek() !== undefined) fail();
  if (!Number.isFinite(result)) throw new Error('계산 결과가 올바르지 않습니다.');
  return Number(result.toPrecision(12));
}

module.exports = { calculate };
