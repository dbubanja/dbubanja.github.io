// Табеле законских стопа ЦБЦГ: провјера структуре, разлике између верзија.
import { isoToDay } from './dates.js';

export function validateRatesFile(j) {
  const errors = [];
  if (!j || typeof j !== 'object') return { ok: false, errors: ['Фајл није JSON објекат'] };
  if (j.schema_version !== 1) errors.push('Непозната верзија структуре (schema_version)');
  if (!j.version) errors.push('Недостаје ознака верзије табеле');
  if (!Array.isArray(j.rates) || !j.rates.length) errors.push('Недостаје списак стопа');
  const list = (j.rates || []).map((r, i) => {
    const a = isoToDay(r.датум_од), b = isoToDay(r.датум_до);
    if (a === null || b === null) errors.push(`Ред ${i + 1}: неисправан датум`);
    else if (a > b) errors.push(`Ред ${i + 1}: „од“ је послије „до“`);
    if (!/^\d+(\.\d+)?$/.test(String(r.стопа))) errors.push(`Ред ${i + 1}: неисправна стопа „${r.стопа}“`);
    if (!['потврђено', 'непотврђено'].includes(r.статус)) errors.push(`Ред ${i + 1}: статус мора бити „потврђено“ или „непотврђено“`);
    return { a, b, i };
  }).filter(x => x.a !== null && x.b !== null).sort((x, y) => x.a - y.a);
  for (let k = 1; k < list.length; k++) if (list[k].a <= list[k - 1].b) errors.push(`Преклапање периода у редовима ${list[k - 1].i + 1} и ${list[k].i + 1}`);
  return { ok: errors.length === 0, errors };
}

const FIELDS = ['датум_до', 'стопа', 'статус', 'број_одлуке', 'датум_одлуке', 'службени_лист', 'извор_одлуке'];
export function diffRates(oldJ, newJ) {
  const om = new Map((oldJ?.rates || []).map(r => [r.датум_од, r]));
  const nm = new Map((newJ?.rates || []).map(r => [r.датум_од, r]));
  const added = [], removed = [], changed = [];
  for (const [k, r] of nm) {
    if (!om.has(k)) added.push(r);
    else {
      const o = om.get(k);
      const f = FIELDS.filter(x => String(o[x] ?? '') !== String(r[x] ?? ''));
      if (f.length) changed.push({ old: o, new: r, fields: f });
    }
  }
  for (const [k, r] of om) if (!nm.has(k)) removed.push(r);
  return { added, removed, changed, same: !added.length && !removed.length && !changed.length };
}
