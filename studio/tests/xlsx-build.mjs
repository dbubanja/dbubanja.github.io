// Прави .xlsx за сваки сценарио (за провјеру формула у LibreOffice: tests/xlsx_verify.py)
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { calculate } from '../js/engine.js';
import { buildWorkbook } from '../js/xlsx-export.js';
const root = new URL('..', import.meta.url);
const rj = JSON.parse(fs.readFileSync(new URL('rates.json', root)));
const scenarios = JSON.parse(fs.readFileSync(new URL('tests/scenarios.json', root)));
const outDir = new URL('tests/out/', root);
fs.mkdirSync(outDir, { recursive: true });
const manifest = [];
for (const [i, s] of scenarios.entries()) {
  const r = calculate({ officialRates: rj.rates, ...s.input });
  if (!r.ok) continue;
  const snap = { caseInfo: { number: 'ТЕСТ ' + (i + 1), court: 'Тест', expert: 'Тест' }, calcDate: s.input.calcDate, settings: r.settings, result: r, ratesMeta: rj, appVersion: 'test', version: 1, createdAt: Date.now() };
  if (r.obligations.some(o=>o.initial.toNumber()>999999999999.99)) { console.log('Excel опсег: прескочен',s.name); continue; }
  for (const sc of ['cyr', 'lat']) {
    const wb = await buildWorkbook(ExcelJS, snap, sc);
    const f = `s${String(i + 1).padStart(2, '0')}-${sc}.xlsx`;
    await wb.xlsx.writeFile(new URL(f, outDir).pathname);
    manifest.push({ file: f, name: s.name, interest: r.totals.interestAccrued.toFixed(2), debt: r.totals.remainingDebt.toFixed(2) });
  }
}
fs.writeFileSync(new URL('manifest.json', outDir), JSON.stringify(manifest, null, 1));
console.log('направљено', manifest.length, 'фајлова');
