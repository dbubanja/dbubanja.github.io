import { isoToDay } from './dates.js';
import { validateRatesFile } from './rates.js';
import { verifySnapshot } from './audit.js';
const idOK = x => typeof x === 'string' && /^[A-Za-z0-9_:-]{1,160}$/.test(x);
const decimal = x => typeof x === 'string' && /^\d{1,30}(\.\d{1,2})?$/.test(x);
// Validate the entire file before the first storage write.
export async function validateBackup(j) {
  const errors = [];
  if (!j || j.format !== 'zatezna-kamata-cg' || j.schema_version !== 1 || !Array.isArray(j.cases)) return ['Непозната структура резервне копије.'];
  const ids = new Set();
  for (const c of j.cases) {
    if (!c || !idOK(c.id) || ids.has(c.id) || !c.info || !c.settings || !Array.isArray(c.principals) || !Array.isArray(c.payments) || !Array.isArray(c.costs) || isoToDay(c.calcDate) === null) { errors.push('Неисправан обрачун или поновљен ID.'); continue; }
    ids.add(c.id);
    if (!['official','single','custom','combined'].includes(c.settings.rateMode)) errors.push('Непознат начин одређивања стопе.');
    const principalIds = new Set();
    for (const p of c.principals) {
      if (!p || !idOK(p.id) || principalIds.has(p.id) || (p.amount !== '' && !decimal(p.amount)) || (p.start !== '' && isoToDay(p.start) === null)) errors.push('Неисправна главница.');
      if (p) principalIds.add(p.id);
    }
    for (const list of [c.payments, c.costs]) {
      const seen = new Set();
      for (const x of list) {
        if (!x || !idOK(x.id) || seen.has(x.id) || (x.amount !== '' && !decimal(x.amount)) || (x.date !== '' && isoToDay(x.date) === null)) errors.push('Неисправна уплата или трошак.');
        if (x) seen.add(x.id);
      }
    }
    if (!Array.isArray(c.settings.customRates) || !c.settings.singleRate) errors.push('Недостају подешавања ручних стопа.');
  }
  for (const field of ['snapshots','rates','settings']) if (j[field] !== undefined && !Array.isArray(j[field])) errors.push(`Неисправан списак: ${field}`);
  if (errors.length) return [...new Set(errors)];
  const snapIds = new Set();
  for (const s of j.snapshots || []) {
    if (!s || !idOK(s.id) || snapIds.has(s.id) || !ids.has(s.caseId) || !s.result?.ok || !Array.isArray(s.result.rows) || !Array.isArray(s.result.obligations) || !Array.isArray(s.result.usedRates) || !s.settings || !s.caseInfo || !Number.isInteger(s.version) || s.version < 1) { errors.push('Неисправна сачувана верзија или веза са обрачуном.'); continue; }
    snapIds.add(s.id);
    if (await verifySnapshot(s) === 'invalid') errors.push(`Сачувана верзија ${s.id}: контролни отисак се не подудара.`);
    try {
      const walk = v => { if (!v || typeof v !== 'object') return; if ('$q' in v && (typeof v.$q !== 'string' || !/^-?\d{1,2000}(\/\d{1,2000})?$/.test(v.$q) || /\/0+$/.test(v.$q))) throw 0; Object.values(v).forEach(walk); };
      walk(s.result);
      if (!s.result.totals?.remainingDebt?.$q) throw 0;
    } catch { errors.push('Неисправни тачни бројеви сачуваног обрачуна.'); }
  }
  for (const r of j.rates || []) if (!r || !idOK(r.id) || !validateRatesFile(r.data).ok) errors.push('Неисправна табела стопа.');
  return [...new Set(errors)];
}
