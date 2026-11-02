import {parseAmount} from './parse.js';
import {parseDMY} from './dates.js';
export function parsePrincipalLines(text) {
  const rows = [], errors = [];
  String(text).split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const fields = line.split('\t');
    if (fields.length < 2 || fields.length > 3) {errors.push(`Ред ${i+1}: потребне су колоне износ, датум, опис (по жељи), одвојене табулатором.`); return;}
    const a = parseAmount(fields[0]), d = parseDMY(fields[1]);
    if (!a.ok || !d.ok || /^0(\.0+)?$/.test(a.value)) {errors.push(`Ред ${i+1}: ${!a.ok ? a.error : !d.ok ? d.error : 'Износ мора бити већи од нуле'}`); return;}
    rows.push({amount:a.value, start:d.iso, due:'', label:fields[2]?.trim() || ''});
  });
  if (!rows.length && !errors.length) errors.push('Налијепите бар један ред.');
  return {rows, errors};
}
