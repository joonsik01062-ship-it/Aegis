// 저장하기 전에 민감한 번호를 지운다. (주민등록번호, 카드번호, "비밀번호는 ~")
// AI가 중요하다고 판단해도 이런 정보는 저장하지 않는다.
function luhn(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function redact(text) {
  let out = String(text);
  out = out.replace(/\b\d{6}[-\s]?[1-4]\d{6}\b/g, '[주민등록번호 삭제됨]');
  out = out.replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => {
    const d = m.replace(/[ -]/g, '');
    return d.length >= 13 && d.length <= 19 && luhn(d) ? '[카드번호 삭제됨]' : m;
  });
  out = out.replace(
    /(비밀번호|패스워드|password|passwd)\s*(?:은|는|이|가|:|=|is)\s*([^\s,]+)/gi,
    (m, k) => `${k} [삭제됨]`
  );
  return out;
}

module.exports = { redact };
