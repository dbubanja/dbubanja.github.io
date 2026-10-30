import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculate } from '../js/engine.js';
import { Q } from '../js/rational.js';
import { parseAmount, parseRate } from '../js/parse.js';
import { parseDMY } from '../js/dates.js';

const root = new URL('..', import.meta.url);
const official = JSON.parse(fs.readFileSync(new URL('rates.json', root))).rates;
const scenarios = JSON.parse(fs.readFileSync(new URL('tests/scenarios.json', root)));
const expected = JSON.parse(fs.readFileSync(new URL('tests/expected.json', root)));

const run = (inp) => calculate({ officialRates: official, ...inp });

// 1) Поређење са независним прорачуном дан-по-дан (tests/reference.py, Python Fraction)
for (const s of scenarios) {
  test('Референтни прорачун: ' + s.name, () => {
    const r = run(s.input);
    const e = expected[s.name];
    assert.ok(e, 'нема очекиваног резултата — покрените python3 tests/reference.py');
    assert.equal(r.ok, e.ok, JSON.stringify(r.errors));
    if (!e.ok) return;
    for (const [k, v] of Object.entries(e.totals)) {
      assert.equal(r.totals[k].toRatString(), v, `${k}: апликација ${r.totals[k].toRatString()} ≠ референца ${v}`);
    }
  });
}

// 2) Ручно израчунати контролни примјери (вриједности израчунате на папиру)
test('Ручно: 1000 € × 8% × 365 дана / 36500 = 80,00 € (ручна стопа 8%)', () => {
  const r = run({ calcDate: '2015-12-31', settings: { rateMode: 'single', singleRate: { стопа: '8', основ: 'тест' } }, principals: [{ id: 'a', amount: '1000', start: '2014-12-31' }] });
  assert.equal(r.totals.interestAccrued.toFixed(2), '80.00');
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].days, 365);
  assert.equal(r.rows[0].divisor, 36500);
});
test('Ручно: пријеступна 2012, 1000 € × 8% × 366 / 36600 = 80,00 €', () => {
  const r = run({ calcDate: '2012-12-31', settings: {}, principals: [{ id: 'a', amount: '1000', start: '2011-12-31' }] });
  // 2012: 182 дана по 8,00% (I полугође) + 184 дана по 8,00% (II полугође)
  assert.equal(r.totals.interestAccrued.toFixed(2), '80.00');
  assert.ok(r.rows.every(x => x.divisor === 36600));
  assert.equal(r.rows.reduce((s, x) => s + x.days, 0), 366);
});
test('Ручно: 2011 — 180 дана × 8% + 184 дана × 8,25% на 1000 € = 39,4521 + 41,5890', () => {
  const r = run({ calcDate: '2011-12-31', settings: {}, principals: [{ id: 'a', amount: '1000', start: '2011-01-01' }] });
  assert.equal(r.rows[0].interest.toRatString(), new Q(1000n * 800n * 180n, 100n * 36500n).toRatString());
  assert.equal(r.rows[1].interest.toRatString(), new Q(1000n * 825n * 184n, 100n * 36500n).toRatString());
  assert.equal(r.totals.interestAccrued.toFixed(2), '81.04');
});
test('Бројање дана: исти датум → 0 дана (правило 1) и 1 дан (правило 2)', () => {
  const a = run({ calcDate: '2020-05-05', settings: {}, principals: [{ id: 'a', amount: '500', start: '2020-05-05' }] });
  const b = run({ calcDate: '2020-05-05', settings: { dayRule: 'includeBoth' }, principals: [{ id: 'a', amount: '500', start: '2020-05-05' }] });
  assert.equal(a.rows.length, 0);
  assert.equal(b.rows[0].days, 1);
});
test('Крајњи датум прије почетног не даје негативну камату', () => {
  const r = run({ calcDate: '2020-01-01', settings: {}, principals: [{ id: 'a', amount: '100', start: '2020-02-01' }] });
  assert.ok(r.ok);
  assert.equal(r.totals.interestAccrued.sign(), 0);
  assert.ok(r.warnings.some(w => w.code === 'zeroDays'));
});
test('Подподпериоди се не губе: збир дана једнак је укупном броју дана', () => {
  const r = run({ calcDate: '2026-12-31', settings: {}, principals: [{ id: 'a', amount: '25000', start: '2010-01-01' }] });
  const days = r.rows.reduce((s, x) => s + x.days, 0);
  // 01.01.2010. се не рачуна → 02.01.2010–31.12.2026.
  assert.equal(days, (Date.UTC(2026, 11, 31) - Date.UTC(2010, 0, 2)) / 864e5 + 1);
});
test('Празнина у стопама блокира обрачун и наводи тачне датуме', () => {
  const r = run({ calcDate: '2010-03-31', settings: {}, principals: [{ id: 'a', amount: '1000', start: '2009-11-15' }] });
  assert.equal(r.ok, false);
  assert.equal(r.missing[0].fromIso, '2009-11-16');
  assert.equal(r.missing[0].toIso, '2009-12-31');
});
test('Преклапање стопа блокира обрачун', () => {
  const s = scenarios.find(x => x.name.startsWith('18'));
  const r = run(s.input);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.code === 'rateOverlap'));
});
test('Уплата без намјене без изабраног правила блокира обрачун', () => {
  const r = run({ calcDate: '2024-12-31', settings: {}, principals: [{ id: 'a', amount: '100', start: '2024-01-01' }], payments: [{ id: 'u', date: '2024-05-01', amount: '10' }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.code === 'unassigned'));
});
test('Уплата прије настанка обавезе на коју је распоређена — блокира', () => {
  const r = run({ calcDate: '2024-12-31', settings: {}, principals: [{ id: 'a', amount: '100', start: '2024-06-01' }], payments: [{ id: 'u', date: '2024-05-01', amount: '10', splits: [{ target: 'a', amount: '10' }] }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.code === 'payBeforeStart'));
});
test('Само на главницу захтијева основ', () => {
  const r = run({ calcDate: '2024-12-31', settings: { allocation: 'principalOnly' }, principals: [{ id: 'a', amount: '100', start: '2024-01-01' }] });
  assert.equal(r.ok, false);
});
test('Главница никад није негативна; преплата одвојено', () => {
  const s = scenarios.find(x => x.name.startsWith('07'));
  const r = run(s.input);
  assert.equal(r.totals.remainingPrincipal.sign(), 0);
  assert.ok(r.totals.overpay.sign() > 0);
  assert.ok(r.rows.every(x => x.after.P.sign() >= 0));
});
test('Трошак не настаје прије свог датума (уплата прије трошка га не намирује)', () => {
  const r = run({ calcDate: '2024-12-31', settings: {}, principals: [{ id: 'a', amount: '100', start: '2024-01-01' }],
    costs: [{ id: 'c', date: '2024-06-01', amount: '50', target: 'a' }],
    payments: [{ id: 'u', date: '2024-05-01', amount: '10', splits: [{ target: 'a', amount: '10' }] }] });
  const pay = r.rows.find(x => x.type === 'payment');
  assert.equal(pay.toCosts.sign(), 0);
});
test('Незаокружени збир: збир појединачно заокружених може се разликовати од заокруженог збира', () => {
  const s = scenarios.find(x => x.name.startsWith('21'));
  const r = run(s.input);
  const rowsRounded = r.rows.reduce((acc, x) => acc.add(Q.parse(x.interest.toFixed(2))), new Q(0n));
  assert.equal(r.totals.interestAccrued.toFixed(2), Q.parse(expected[s.name].totals.interestAccrued).toFixed(2));
  assert.notEqual(rowsRounded.toRatString(), r.totals.interestAccrued.toRatString());
});

// 3) Унос
test('Унос износа: зарез, тачка и двосмисленост', () => {
  assert.deepEqual(parseAmount('1.234,56'), { ok: true, value: '1234.56' });
  assert.deepEqual(parseAmount('1,234.56'), { ok: true, value: '1234.56' });
  assert.deepEqual(parseAmount('1234,5'), { ok: true, value: '1234.5' });
  assert.deepEqual(parseAmount('1 234 567'), { ok: true, value: '1234567' });
  assert.deepEqual(parseAmount('1.234.567'), { ok: true, value: '1234567' });
  assert.equal(parseAmount('1.234').ok, false);
  assert.equal(parseAmount('1,234').ok, false);
  assert.equal(parseAmount('12,345').ok, false);
  assert.equal(parseAmount('1,2,3').ok, false);
  assert.equal(parseAmount('12.3456').ok, false);
  assert.equal(parseAmount('-5').ok, false);
  assert.equal(parseAmount('abc').ok, false);
  assert.deepEqual(parseRate('10,15'), { ok: true, value: '10.15' });
  assert.deepEqual(parseRate('8'), { ok: true, value: '8' });
});
test('Датуми: одбија 31.02. и 29.02. у непријеступној', () => {
  assert.equal(parseDMY('31.02.2024').ok, false);
  assert.equal(parseDMY('29.02.2023').ok, false);
  assert.equal(parseDMY('29.02.2024').ok, true);
  assert.equal(parseDMY('29.02.2000').ok, true);
  assert.equal(parseDMY('29.02.1900').ok, false);
  assert.equal(parseDMY('1.3.2024').iso, '2024-03-01');
  assert.equal(parseDMY('2024-03-01').ok, false);
});
test('Заокруживање половине од нуле', () => {
  assert.equal(Q.parse('0.005').toFixed(2), '0.01');
  assert.equal(Q.parse('0.0049999').toFixed(2), '0.00');
  assert.equal(Q.parse('2.675').toFixed(2), '2.68'); // Number би дао 2.67
});
