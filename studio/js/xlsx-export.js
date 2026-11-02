// Извоз сачуваног обрачуна у .xlsx (ExcelJS). Свака камата, расподјела уплате и стање дуга су Excel ФОРМУЛЕ.
// Ради и у прегледачу (глобални ExcelJS из lib/exceljs.min.js) и у Node-у (тестови).

import { RULES, CASE_COSTS } from './engine.js';
import { isoToDMY, isoToDay, fromDay } from './dates.js';
import { tWith } from './i18n.js';

const MONEY = '#,##0.00 "€";-#,##0.00 "€"';
const RATE = '0.00##';
const DATE = 'dd.mm.yyyy';

function xDate(iso) {
  const z = isoToDay(iso);
  if (z === null) return null;
  const { y, m, d } = fromDay(z);
  return new Date(Date.UTC(y, m - 1, d));
}
const nameOf = (info) => (info && (info.debtor || info.defendant || info.number)) || '';
const num = (q) => (q && typeof q.toNumber === 'function' ? q.toNumber() : 0);

// snap = { caseInfo, settings, result (Q-ови), ratesMeta, appVersion, createdAt, version }
export async function buildWorkbook(ExcelJS, snap, script = 'cyr') {
  const T = tWith(script);
  const r = snap.result;
  const ci = snap.caseInfo || {};
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Затезна камата ЦГ';
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  if (!r.ok) throw new Error('Обрачун је блокиран');
  if (r.obligations.some(o => o.initial.toNumber() > 999999999999.99)) throw new Error('Износ прелази сигурни опсег Excel приказа на цент. Користите тачни JSON извјештај.');
  if (r.rows.some(x => (x.from || x.date) < '1900-03-01')) throw new Error('Excel има посебно календарско правило за почетак 1900. Користите JSON за тај период.');

  const thin = { style: 'thin', color: { argb: 'FF8A9BA8' } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };
  const headFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF183E55' } };
  const subFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF2' } };

  // ───────── Лист „Обрачун“
  const ws = wb.addWorksheet(T('Обрачун'), {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    headerFooter: { oddFooter: '&C&P / &N' },
  });
  const cols = [
    ['Р. бр.', 6], ['Обавеза', 18], ['Ставка', 13], ['Од / датум', 12], ['До', 12], ['Дана', 7], ['Дјелилац', 9], ['Стопа %', 8],
    ['Основица', 14], ['Камата', 13], ['Нови трошак', 12], ['Уплата на обавезу', 14], ['→ трошкови', 12], ['→ камата', 12], ['→ главница', 13],
    ['Преплата', 11], ['Преостала главница', 15], ['Преостала камата', 14], ['Преостали трошкови', 14], ['Стопа: основ / опис', 46],
  ];
  ws.columns = cols.map(([, w]) => ({ width: w }));

  let row = 1;
  const title = ws.getCell(row, 1);
  title.value = T('ОБРАЧУН ЗАКОНСКЕ ЗАТЕЗНЕ КАМАТЕ') + (snap.result.working ? T(' — РАДНИ ОБРАЧУН (ручне или непотврђене стопе)') : '');
  title.font = { bold: true, size: 14 };
  row++;
  const info = [[T('Дужник'), nameOf(ci)], [T('Датум обрачуна'), isoToDMY(snap.calcDate)]];
  if (ci.note) info.push([T('Напомена'), ci.note]);
  for (const [k, v] of info) {
    ws.getCell(row, 1).value = k; ws.getCell(row, 1).font = { bold: true };
    ws.mergeCells(row, 1, row, 2);
    ws.getCell(row, 3).value = v; ws.mergeCells(row, 3, row, 9);
    row++;
  }
  row++;
  const headRow = row;
  cols.forEach(([h], i) => {
    const c = ws.getCell(row, i + 1);
    c.value = T(h); c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = headFill; c.border = box;
    c.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
  });
  ws.getRow(row).height = 32;
  ws.pageSetup.printTitlesRow = `${headRow}:${headRow}`;
  ws.views = [{ state: 'frozen', ySplit: headRow }];
  row++;

  const st = snap.settings || r.settings;
  const L = (c, rr) => `${c}${rr}`;
  const lastRowOf = {}; // oid → ред посљедњег стања
  const firstDataRow = row;
  let n = 0;
  const obligations = r.obligations.filter(o => o.kind === 'principal' || r.rows.some(x => x.oid === o.id));

  for (const o of obligations) {
    // Почетно стање обавезе
    const startR = row;
    ws.getCell(row, 1).value = ++n;
    ws.getCell(row, 2).value = o.label;
    ws.getCell(row, 3).value = T(o.kind === 'case' ? 'Почетак' : 'Почетно стање');
    if (o.kind === 'principal') {
      ws.getCell(row, 4).value = xDate(o.start);
      ws.getCell(row, 17).value = num(o.initial);
      ws.getCell(row, 20).value = T(`Почетни датум ${isoToDMY(o.start)}; први обрачунати дан ${isoToDMY(o.firstDay)}; посљедњи ${isoToDMY(o.lastDay)}`) + (o.due ? T('; доспијеће (за распоред уплата) ') + isoToDMY(o.due) : '');
    } else {
      ws.getCell(row, 17).value = 0;
    }
    ws.getCell(row, 18).value = 0; ws.getCell(row, 19).value = 0;
    styleRow(ws, row, subFill);
    let prev = row;
    row++;
    for (const x of r.rows.filter(z => z.oid === o.id)) {
      ws.getCell(row, 1).value = ++n;
      ws.getCell(row, 2).value = o.label;
      if (x.type === 'interest') {
        ws.getCell(row, 3).value = T('Камата');
        ws.getCell(row, 4).value = xDate(x.from);
        ws.getCell(row, 5).value = xDate(x.to);
        ws.getCell(row, 6).value = { formula: `${L('E', row)}-${L('D', row)}+1` };
        ws.getCell(row, 7).value = { formula: `IF(OR(MOD(YEAR(${L('D', row)}),400)=0,AND(MOD(YEAR(${L('D', row)}),4)=0,MOD(YEAR(${L('D', row)}),100)<>0)),36600,36500)` };
        ws.getCell(row, 8).value = Number(x.rateStr);
        ws.getCell(row, 9).value = { formula: L('Q', prev) };
        ws.getCell(row, 10).value = { formula: `${L('I', row)}*${L('H', row)}*${L('F', row)}/${L('G', row)}` };
        ws.getCell(row, 17).value = { formula: L('Q', prev) };
        ws.getCell(row, 18).value = { formula: `${L('R', prev)}+${L('J', row)}` };
        ws.getCell(row, 19).value = { formula: L('S', prev) };
        ws.getCell(row, 20).value = (x.rateKind === 'official' ? '' : T('[ручно унесена] ')) + (x.rateStatus && x.rateStatus !== 'потврђено' && x.rateKind === 'official' ? T('[НЕПОТВРЂЕНО] ') : '') + (x.rateBasis || '');
      } else if (x.type === 'cost') {
        ws.getCell(row, 3).value = T('Трошак');
        ws.getCell(row, 4).value = xDate(x.date);
        ws.getCell(row, 11).value = num(x.amount);
        ws.getCell(row, 17).value = { formula: L('Q', prev) };
        ws.getCell(row, 18).value = { formula: L('R', prev) };
        ws.getCell(row, 19).value = { formula: `${L('S', prev)}+${L('K', row)}` };
        ws.getCell(row, 20).value = x.desc || '';
      } else if (x.type === 'payment') {
        ws.getCell(row, 3).value = T('Уплата');
        ws.getCell(row, 4).value = xDate(x.date);
        ws.getCell(row, 12).value = num(x.amount);
        const Lr = L('L', row);
        if (o.kind === 'case') {
          ws.getCell(row, 13).value = { formula: `MIN(${Lr},${L('S', prev)})` };
          ws.getCell(row, 14).value = 0; ws.getCell(row, 15).value = 0;
        } else if (st.allocation === 'costsInterestPrincipal') {
          ws.getCell(row, 13).value = { formula: `MIN(${Lr},${L('S', prev)})` };
          ws.getCell(row, 14).value = { formula: `MIN(${Lr}-${L('M', row)},${L('R', prev)})` };
          ws.getCell(row, 15).value = { formula: `MIN(${Lr}-${L('M', row)}-${L('N', row)},${L('Q', prev)})` };
        } else {
          ws.getCell(row, 13).value = 0; ws.getCell(row, 14).value = 0;
          ws.getCell(row, 15).value = { formula: `MIN(${Lr},${L('Q', prev)})` };
        }
        ws.getCell(row, 16).value = { formula: `${Lr}-${L('M', row)}-${L('N', row)}-${L('O', row)}` };
        ws.getCell(row, 17).value = { formula: `${L('Q', prev)}-${L('O', row)}` };
        ws.getCell(row, 18).value = { formula: `${L('R', prev)}-${L('N', row)}` };
        ws.getCell(row, 19).value = { formula: `${L('S', prev)}-${L('M', row)}` };
        const tot = num(x.paymentTotal);
        ws.getCell(row, 20).value = (x.desc || T('Уплата')) + (Math.abs(tot - num(x.amount)) > 1e-9 ? T(` (дио уплате од ${tot.toFixed(2).replace('.', ',')} €; ${x.note})`) : (x.note ? T(` (${x.note})`) : ''));
      }
      styleRow(ws, row);
      prev = row;
      row++;
    }
    lastRowOf[o.id] = prev;
    // ред за празан размак између обавеза
    if (startR === prev) lastRowOf[o.id] = startR;
  }
  const lastDataRow = row - 1;

  // Формати
  for (let rr = firstDataRow; rr <= lastDataRow; rr++) {
    [4, 5].forEach(c => (ws.getCell(rr, c).numFmt = DATE));
    ws.getCell(rr, 8).numFmt = RATE;
    [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].forEach(c => (ws.getCell(rr, c).numFmt = MONEY));
  }

  // ───────── Збирни преглед: формула + вриједност из апликације + разлика
  row += 1;
  const sumHead = row;
  ['Збирни преглед', 'Excel (формула)', 'Апликација', 'Разлика (заокр.)'].forEach((h, i) => {
    const c = ws.getCell(row, [2, 9, 10, 11][i]);
    c.value = T(h); c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = headFill; c.border = box;
  });
  ws.mergeCells(row, 2, row, 8);
  row++;
  const rng = (c) => `${c}${firstDataRow}:${c}${lastDataRow}`;
  const lastCells = (c) => Object.values(lastRowOf).map(rr => `${c}${rr}`).join(',') || '0';
  const tt = r.totals;
  const lines = [
    ['Почетна главница (укупно)', null, tt.initialPrincipal],
    ['Обрачуната камата (укупно)', `SUM(${rng('J')})`, tt.interestAccrued],
    ['Трошкови (укупно)', `SUM(${rng('K')})`, tt.costsTotal],
    ['Уплате (укупно)', `SUM(${rng('L')})`, tt.paymentsTotal],
    ['  урачунато на трошкове', `SUM(${rng('M')})`, tt.paidCosts],
    ['  урачунато на камату', `SUM(${rng('N')})`, tt.paidInterest],
    ['  урачунато на главницу', `SUM(${rng('O')})`, tt.paidPrincipal],
    ['Преплата (не преноси се)', `SUM(${rng('P')})`, tt.overpay],
    ['Преостала главница', `SUM(${lastCells('Q')})`, tt.remainingPrincipal],
    ['Преостала неплаћена камата', `SUM(${lastCells('R')})`, tt.remainingInterest],
    ['Преостали трошкови', `SUM(${lastCells('S')})`, tt.remainingCosts],
    ['ПРЕОСТАЛИ ДУГ (главница + камата + трошкови)', null, tt.remainingDebt],
  ];
  const startRows = [];
  for (let rr = firstDataRow; rr <= lastDataRow; rr++) {
    const v = ws.getCell(rr, 3).value;
    if (v === T('Почетно стање')) startRows.push(rr);
  }
  lines[0][1] = startRows.length ? `SUM(${startRows.map(rr => 'Q' + rr).join(',')})` : '0';
  const firstSumRow = row;
  lines.forEach(([label, f, appVal], i) => {
    ws.getCell(row, 2).value = T(label); ws.mergeCells(row, 2, row, 8);
    ws.getCell(row, 9).value = { formula: f || `I${firstSumRow + 8}+I${firstSumRow + 9}+I${firstSumRow + 10}` };
    ws.getCell(row, 10).value = Number(appVal.toFixed(2));
    ws.getCell(row, 11).value = { formula: `ROUND(I${row},2)-J${row}` };
    [9, 10, 11].forEach(c => { ws.getCell(row, c).numFmt = MONEY; ws.getCell(row, c).border = box; });
    ws.getCell(row, 2).border = box;
    if (i === lines.length - 1) [2, 9, 10].forEach(c => (ws.getCell(row, c).font = { bold: true }));
    row++;
  });
  row++;
  const notes = [
    `${T('Формула')}: ${T(RULES.formula)}`,
    `${T('Бројање дана')}: ${T(RULES.dayRule[st.dayRule])}`,
    `${T('Дан уплате')}: ${T(RULES.paymentDayRule[st.paymentDayRule])}`,
    `${T('Урачунавање уплата')}: ${T(RULES.allocation[st.allocation])}${st.allocation === 'principalOnly' ? ' — ' + T('основ') + ': ' + (st.allocationBasis || '') : (st.allocationBasisLegal ? ' — ' + st.allocationBasisLegal : '')}`,
    `${T('Уплате без намјене')}: ${T(RULES.unassignedRule[st.unassignedRule])}`,
    `${T('Редосљед истог дана')}: ${T(RULES.sameDayOrder)}`,
    `${T('Заокруживање')}: ${T(RULES.rounding)} ${T('Колоне „Excel (формула)“ рачуна Excel; „Апликација“ је резултат апликације заокружен на 2 децимале.')}`,
    `${T('Камата се не капитализује; на камату и трошкове се не обрачунава камата.')}`,
    `${T('Извори стопа')}: ${T('лист „Стопе“')}.`,
  ];
  for (const t of notes) {
    ws.getCell(row, 1).value = t; ws.mergeCells(row, 1, row, 20);
    ws.getCell(row, 1).alignment = { wrapText: true, vertical: 'top' };
    ws.getRow(row).height = t.length > 170 ? 30 : 16;
    row++;
  }
  ws.pageSetup.printArea = `A1:T${row}`;

  // ───────── Лист „Стопе“
  const wr = wb.addWorksheet(T('Стопе'), { pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const rh = ['Од', 'До', 'Стопа %', 'Врста', 'Статус', 'Основ (одлука / Сл. лист)', 'Извор', 'Провјерено дана'];
  wr.columns = [12, 12, 9, 14, 16, 60, 60, 14].map(w => ({ width: w }));
  wr.getCell(1, 1).value = T('Стопе коришћене у обрачуну') + (r.working ? T(' — САДРЖИ НЕПОТВРЂЕНЕ СТОПЕ') : '');
  wr.getCell(1, 1).font = { bold: true, size: 13 };
  wr.getCell(2, 1).value = T('Табела: ') + (snap.ratesMeta ? `${snap.ratesMeta.назив || ''} (${T('верзија')} ${snap.ratesMeta.version || ''})` : T('ручно унесене стопе'));
  rh.forEach((h, i) => { const c = wr.getCell(4, i + 1); c.value = T(h); c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = headFill; c.border = box; });
  wr.pageSetup.printTitlesRow = '4:4';
  let rr2 = 5;
  for (const u of r.usedRates) {
    wr.getCell(rr2, 1).value = u.from ? xDate(u.from) : T('без ограничења');
    wr.getCell(rr2, 2).value = u.to ? xDate(u.to) : T('без ограничења');
    wr.getCell(rr2, 3).value = Number(u.rateStr);
    wr.getCell(rr2, 4).value = T(u.kind === 'official' ? 'законска ЦБЦГ' : 'ручно унесена');
    wr.getCell(rr2, 5).value = T(u.status || '');
    wr.getCell(rr2, 6).value = u.basis || '';
    wr.getCell(rr2, 7).value = u.src ? (u.src.извор_одлуке || '') : '';
    wr.getCell(rr2, 8).value = u.src && u.src.провјерено_дана ? xDate(u.src.провјерено_дана) : '';
    [1, 2, 8].forEach(c => (wr.getCell(rr2, c).numFmt = DATE));
    wr.getCell(rr2, 3).numFmt = RATE;
    for (let c = 1; c <= 8; c++) wr.getCell(rr2, c).border = box;
    rr2++;
  }
  wr.getCell(rr2 + 1, 1).value = T('Ознака „потврђено“ значи да је стопа провјерена према наведеном извору; не представља потврду исправности цијелог обрачуна.');

  // ───────── Лист „Подаци о предмету“
  const wi = wb.addWorksheet(T('Подаци о обрачуну'), { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  wi.columns = [{ width: 34 }, { width: 90 }];
  const prow = (k, v) => { const x = wi.addRow([T(k), v]); x.getCell(1).font = { bold: true }; x.getCell(2).alignment = { wrapText: true }; };
  wi.addRow([T('Подаци о обрачуну')]).getCell(1).font = { bold: true, size: 13 };
  prow('Дужник', nameOf(ci));
  prow('Напомена', ci.note || '');
  prow('Датум обрачуна', isoToDMY(snap.calcDate));
  prow('Статус обрачуна', T(r.working ? 'РАДНИ ОБРАЧУН — ручне или непотврђене стопе' : (r.manual ? 'Садржи ручно унесене стопе (видјети лист „Стопе“)' : 'Коришћене су стопе означене као потврђене')));
  prow('Начин одређивања стопе', T({ official: 'Законске стопе ЦБЦГ', single: 'Једна сопствена стопа', custom: 'Више сопствених стопа по периодима', combined: 'ЦБЦГ + ручни периоди' }[st.rateMode] || ''));
  prow('Бројање дана', T(RULES.dayRule[st.dayRule]));
  prow('Третман дана уплате', T(RULES.paymentDayRule[st.paymentDayRule]));
  prow('Урачунавање уплата', T(RULES.allocation[st.allocation]) + (st.allocation === 'principalOnly' ? ' — ' + T('основ') + ': ' + (st.allocationBasis || '') : (st.allocationBasisLegal ? ' — ' + st.allocationBasisLegal : '')));
  prow('Уплате без намјене', T(RULES.unassignedRule[st.unassignedRule]));
  prow('Редосљед истог дана', T(RULES.sameDayOrder));
  prow('Заокруживање', T(RULES.rounding));
  prow('Формула', T(RULES.formula));
  prow('Обавезе', '');
  for (const o of r.obligations.filter(z => z.kind === 'principal')) {
    prow('  ' + o.label, `${T('износ')} ${num(o.initial).toFixed(2).replace('.', ',')} €; ${T('почетни датум')} ${isoToDMY(o.start)}; ${T('први обрачунати дан')} ${isoToDMY(o.firstDay)}; ${T('посљедњи')} ${isoToDMY(o.lastDay)}${o.due ? '; ' + T('доспијеће (за распоред уплата)') + ' ' + isoToDMY(o.due) : ''}${o.noInterestDays ? ' — ' + T('нема дана за обрачун') : ''}`);
  }
  if (r.warnings && r.warnings.length) {
    prow('Упозорења', r.warnings.map(w => T(w.msg)).join('\n'));
  }
  prow('Верзија апликације / механизма', `${snap.appVersion || ''} / ${r.meta.engineVersion}`);
  prow('Сачуван обрачун', `${T('верзија')} ${snap.version || 1}, ${snap.createdAt ? new Date(snap.createdAt).toLocaleString('sr-Latn-ME') : ''}`);

  if (snap.checksum) prow('Контролни отисак SHA-256', snap.checksum);
  const exact = wb.addWorksheet(T('Тачни износи'));
  exact.columns = [{width:10},{width:22},{width:60},{width:60},{width:60}];
  exact.addRow([T('Р. бр.'),T('Врста'),T('Основица / уплата (тачан разломак)'),T('Камата (тачан разломак)'),T('Извор стопе SHA-256')]);
  for (const x of r.rows) {
    const u=r.usedRates.find(u=>u.from <= (x.from||'') && u.to >= (x.to||'') && u.kind===x.rateKind);
    exact.addRow([x.seq,T(x.type === 'interest' ? 'Камата' : x.type === 'payment' ? 'Уплата' : 'Трошак'),(x.base||x.amount).toRatString(),x.interest?.toRatString()||'',u?.src?.sha256_извора||'']);
  }
  exact.addRow([T('Напомена'),T('Разломци су текстуални тачни износи, без губитка прецизности. Excel формуле користе Excel бројеве; поређење је у листу Обрачун.')]);
  return wb;
}

function styleRow(ws, row, fill) {
  for (let c = 1; c <= 20; c++) {
    const cell = ws.getCell(row, c);
    cell.border = { top: { style: 'thin', color: { argb: 'FFC4D0D8' } }, left: { style: 'thin', color: { argb: 'FFC4D0D8' } }, bottom: { style: 'thin', color: { argb: 'FFC4D0D8' } }, right: { style: 'thin', color: { argb: 'FFC4D0D8' } } };
    if (fill) cell.fill = fill;
    if (c === 20) cell.alignment = { wrapText: true, vertical: 'top' };
  }
}

export { CASE_COSTS };
