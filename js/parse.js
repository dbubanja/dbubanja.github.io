// Тумачење унесених износа и стопа: децимални зарез или тачка, недвосмислено.

// Враћа { ok, value: "1234.56" } или { ok:false, error }.
// Правила:
//  - размаци и апостроф као раздвајачи хиљада се уклањају;
//  - ако постоје и зарез и тачка: посљедњи је децимални знак, остали морају бити хиљаде (групе од 3 цифре);
//  - ако постоји само један знак једном: децимални ако иза њега има 1–2 цифре (за износ);
//    ако иза њега има тачно 3 цифре — ДВОСМИСЛЕНО (1.234 = хиљаду или 1,234?) и одбија се;
//  - исти знак више пута: раздвајач хиљада (групе од 3), цијели број.
export function parseDecimal(input, { maxDecimals = 2, allowNegative = false, label = 'Износ' } = {}) {
  let s = String(input ?? '').trim().replace(/[\s'  ]/g, '').replace(/€$/, '');
  if (!s) return { ok: false, error: `${label}: није унесен` };
  let neg = false;
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  if (!/^[\d.,]+$/.test(s)) return { ok: false, error: `${label}: дозвољене су само цифре, зарез и тачка` };
  const commas = (s.match(/,/g) || []).length, dots = (s.match(/\./g) || []).length;
  let intPart, frac = '';
  const groupsOk = (str, sep) => str.split(sep).every((g, i) => (i === 0 ? /^\d{1,3}$/.test(g) : /^\d{3}$/.test(g)));
  if (commas && dots) {
    const dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    const th = dec === ',' ? '.' : ',';
    const idx = s.lastIndexOf(dec);
    if ((s.match(new RegExp('\\' + dec, 'g')) || []).length !== 1) return { ok: false, error: `${label}: неисправан запис „${input}“` };
    intPart = s.slice(0, idx); frac = s.slice(idx + 1);
    if (!groupsOk(intPart, th)) return { ok: false, error: `${label}: раздвајачи хиљада нису исправни у „${input}“` };
    intPart = intPart.split(th).join('');
  } else if (commas + dots === 1) {
    const sep = commas ? ',' : '.';
    const [a, b] = s.split(sep);
    if (!a || !b) return { ok: false, error: `${label}: неисправан запис „${input}“` };
    if (b.length === 3 && maxDecimals < 3) {
      return { ok: false, error: `${label}: „${input}“ је двосмислено (хиљаде или децимале?). Упишите нпр. ${a}${b} или ${a},${b.slice(0, 2)}` };
    }
    intPart = a; frac = b;
  } else if (commas + dots > 1) {
    const sep = commas ? ',' : '.';
    if (!groupsOk(s, sep)) return { ok: false, error: `${label}: неисправан запис „${input}“` };
    intPart = s.split(sep).join('');
  } else {
    intPart = s;
  }
  if (!/^\d+$/.test(intPart) || (frac && !/^\d+$/.test(frac))) return { ok: false, error: `${label}: неисправан запис „${input}“` };
  if (frac.length > maxDecimals) return { ok: false, error: `${label}: највише ${maxDecimals} децимале („${input}“)` };
  if (neg && !allowNegative) return { ok: false, error: `${label}: не може бити негативан` };
  intPart = intPart.replace(/^0+(?=\d)/, '');
  const value = (neg ? '-' : '') + intPart + (frac ? '.' + frac : '');
  return { ok: true, value };
}

export function parseAmount(input, label = 'Износ') { return parseDecimal(input, { maxDecimals: 2, label }); }
export function parseRate(input, label = 'Стопа') { return parseDecimal(input, { maxDecimals: 4, label }); }

// Приказ износа: 1.234,56 (домаћи формат).
export function fmtMoney(fixedStr) {
  const neg = fixedStr.startsWith('-');
  const [i, f] = fixedStr.replace('-', '').split('.');
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-' : '') + grouped + (f !== undefined ? ',' + f : '');
}
export function fmtRate(str) {
  // "8.00" → "8,00"
  return String(str).replace('.', ',');
}
