// Ћирилица ↔ латиница само за текстове интерфејса и извјештаја.
// Унесена имена, описи и бројеви предмета се НЕ пресловљавају.
const MAP = {
  'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Ђ': 'Đ', 'Е': 'E', 'Ж': 'Ž', 'З': 'Z', 'И': 'I', 'Ј': 'J', 'К': 'K', 'Л': 'L',
  'Љ': 'Lj', 'М': 'M', 'Н': 'N', 'Њ': 'Nj', 'О': 'O', 'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'Ћ': 'Ć', 'У': 'U', 'Ф': 'F',
  'Х': 'H', 'Ц': 'C', 'Ч': 'Č', 'Џ': 'Dž', 'Ш': 'Š',
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'ђ': 'đ', 'е': 'e', 'ж': 'ž', 'з': 'z', 'и': 'i', 'ј': 'j', 'к': 'k', 'л': 'l',
  'љ': 'lj', 'м': 'm', 'н': 'n', 'њ': 'nj', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'ћ': 'ć', 'у': 'u', 'ф': 'f',
  'х': 'h', 'ц': 'c', 'ч': 'č', 'џ': 'dž', 'ш': 'š',
};
export function toLatin(s) {
  const str = String(s);
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    let m = MAP[ch];
    if (m === undefined) { out += ch; continue; }
    // Љ/Њ/Џ у ријечи писаној великим словима → LJ/NJ/DŽ
    if (m.length === 2 && ch === ch.toUpperCase()) {
      const next = str[i + 1] || '';
      if (next && next === next.toUpperCase() && next !== next.toLowerCase()) m = m.toUpperCase();
    }
    out += m;
  }
  return out;
}
let script = 'cyr';
export function setScript(s) { script = s === 'lat' ? 'lat' : 'cyr'; }
export function getScript() { return script; }
export function t(s) { return script === 'lat' ? toLatin(s) : s; }
export function tWith(sc) { return sc === 'lat' ? toLatin : (x) => x; }
