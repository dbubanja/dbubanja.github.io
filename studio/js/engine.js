// Обрачунски механизам законске затезне камате — проста (линеарна) камата.
// Чиста функција: исти улаз увијек даје исти излаз. Нема приступа мрежи ни складишту.

import { Q, ZERO } from './rational.js';
import { isoToDay, dayToIso, isLeap, yearOf, yearEnd } from './dates.js';

export const ENGINE_VERSION = '2.0.0';
export const CASE_COSTS = '__case'; // ознака за трошкове предмета који нијесу везани за главницу

export const RULES = {
  dayRule: {
    excludeFirst: 'Први дан се не рачуна, посљедњи се рачуна',
    includeBoth: 'Рачунају се оба гранична дана',
  },
  paymentDayRule: {
    interestBeforePayment: 'Камата за дан уплате обрачунава се прије умањења (на основицу прије уплате)',
    paymentBeforeInterest: 'Уплата умањује основицу прије обрачуна камате за дан уплате',
  },
  allocation: {
    costsInterestPrincipal: 'Трошкови → доспјела камата → главница',
    principalOnly: 'Само на главницу (избор корисника)',
  },
  unassignedRule: {
    none: 'Није изабрано — уплата без означене намјене блокира обрачун',
    oldestFirst: 'По доспијећу (ако није унесено: по почетном датуму); једнаки датуми по реду уноса. Заједнички трошкови први, осим код „само на главницу“. Изабрани поступак, не потпуна примјена члана 319 ЗОО.',
    proportional: 'Сразмјерно преосталом дугу сваке обавезе (трошкови + камата + главница); заједнички трошкови су посебна обавеза. Код „само на главницу“ тежине су искључиво главнице. Избор корисника.',
  },
  sameDayOrder: 'Истог дана: прво настају трошкови, затим се урачунавају уплате по унесеном редосљеду (р. бр.).',
  rounding: 'Међурезултати се не заокружују (тачна рационална аритметика). Збирови се рачунају из незаокружених вриједности; само приказ се заокружује на 2 децимале (0,005 се заокружује на 0,01).',
  formula: 'Камата = основица × стопа (%) × дани / (100 × број дана у години) = основица × стопа × дани / 36500 (36600 у пријеступној години).',
};

function err(list, code, msg, ref) { list.push({ code, msg, ref }); }

// Претвара табелу стопа у сортиран низ интервала; провјерава преклапања.
export function buildRateTable(mode, settings, officialRates) {
  const errors = [];
  let entries = [];
  if (mode === 'official' || mode === 'combined') {
    entries = (officialRates || []).map((r, i) => ({
      from: isoToDay(r.датум_од), to: isoToDay(r.датум_до), rateStr: r.стопа,
      kind: 'official', status: r.статус || 'непотврђено', basis: r.основ || '', src: r, idx: i,
    }));
    if (mode === 'combined') {
      // Explicit manual intervals replace the official intervals only on those dates.
      // First validate the manual table independently; overlapping overrides are forbidden.
      const manual = buildRateTable('custom', settings, []);
      errors.push(...manual.errors);
      for (const m of manual.entries) {
        entries = entries.flatMap(e => e.to < m.from || e.from > m.to ? [e] : [
          ...(e.from < m.from ? [{ ...e, to: m.from - 1 }] : []),
          ...(e.to > m.to ? [{ ...e, from: m.to + 1 }] : []),
        ]);
      }
      entries.push(...manual.entries);
    }
  } else if (mode === 'single') {
    const s = settings.singleRate || {};
    entries = [{ from: -1e9, to: 1e9, rateStr: s.стопа, kind: 'manual', status: 'ручно унесено', basis: s.основ || '', idx: 0 }];
  } else if (mode === 'custom') {
    entries = (settings.customRates || []).map((r, i) => ({
      from: isoToDay(r.датум_од), to: isoToDay(r.датум_до), rateStr: r.стопа,
      kind: 'manual', status: 'ручно унесено', basis: r.основ || '', idx: i,
    }));
  } else {
    err(errors, 'rateMode', 'Није изабран начин одређивања стопе');
  }
  for (const e of entries) {
    if (e.from === null || e.to === null) err(errors, 'rateDate', `Стопа р. бр. ${e.idx + 1}: неисправан датум периода`);
    else if (e.from > e.to) err(errors, 'rateDate', `Стопа р. бр. ${e.idx + 1}: датум „од“ је послије датума „до“`);
    try { if (!/^\d{1,12}(\.\d{1,4})?$/.test(String(e.rateStr))) throw 0; e.rate = Q.parse(e.rateStr); if (e.rate.sign() < 0) throw 0; }
    catch { err(errors, 'rateValue', `Стопа р. бр. ${e.idx + 1}: неисправна вриједност „${e.rateStr}“`); }
  }
  const ok = entries.filter(e => e.from !== null && e.to !== null && e.rate);
  ok.sort((a, b) => a.from - b.from);
  for (let i = 1; i < ok.length; i++) {
    if (ok[i].from <= ok[i - 1].to) {
      err(errors, 'rateOverlap', `Преклапање стопа: период од ${dayToIso(ok[i].from)} преклапа период ${dayToIso(ok[i - 1].from)} – ${dayToIso(ok[i - 1].to)}`);
    }
  }
  return { entries: ok, errors };
}

function findRate(table, day) {
  // бинарна претрага
  let lo = 0, hi = table.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, e = table[mid];
    if (day < e.from) hi = mid - 1; else if (day > e.to) lo = mid + 1; else return e;
  }
  return null;
}
function nextRateStart(table, day) {
  for (const e of table) if (e.from > day) return e.from;
  return Infinity;
}

// Главна функција. Улаз: видјети README / docs (input shape). Излаз: { ok, errors, warnings, rows, obligations, totals, rules, meta }.
export function calculate(input) {
  const errors = [], warnings = [];
  const st = Object.assign({
    dayRule: 'excludeFirst', paymentDayRule: 'interestBeforePayment', allocation: 'costsInterestPrincipal',
    allocationBasis: '', unassignedRule: 'none', rateMode: 'official',
  }, input.settings || {});

  if (!RULES.dayRule[st.dayRule]) err(errors, 'dayRule', 'Непознато правило бројања дана');
  if (!RULES.paymentDayRule[st.paymentDayRule]) err(errors, 'paymentDayRule', 'Непознат третман дана уплате');
  if (!RULES.allocation[st.allocation]) err(errors, 'allocation', 'Непознат начин урачунавања');
  if (!RULES.unassignedRule[st.unassignedRule]) err(errors, 'unassigned', 'Непознато правило за уплате без намјене');
  if (st.allocation === 'principalOnly' && !String(st.allocationBasis || '').trim()) {
    err(errors, 'allocationBasis', 'За урачунавање „само на главницу“ мора се навести основ (налог суда, уговор или др.)');
  }

  const end = isoToDay(input.calcDate);
  if (end === null) err(errors, 'calcDate', 'Датум обрачуна није исправан');

  const rt = buildRateTable(st.rateMode, st, input.officialRates);
  errors.push(...rt.errors);
  const table = rt.entries;

  // Обавезе (главнице)
  const obligations = [];
  const byId = new Map();
  (input.principals || []).forEach((p, i) => {
    const ref = `Главница ${i + 1}${p.label ? ' (' + p.label + ')' : ''}`;
    let amount = null;
    try { if (!/^\d{1,30}(\.\d{1,2})?$/.test(String(p.amount))) throw 0; amount = Q.parse(p.amount); } catch { err(errors, 'principalAmount', `${ref}: неисправан износ`, p.id); }
    if (amount && amount.sign() <= 0) { err(errors, 'principalAmount', `${ref}: износ мора бити већи од нуле`, p.id); amount = null; }
    const start = isoToDay(p.start);
    if (start === null) err(errors, 'principalStart', `${ref}: неисправан почетни датум обрачуна`, p.id);
    if (start !== null && end !== null && start > end) err(errors, 'reversedPeriod', `${ref}: почетни датум је послије датума обрачуна`, p.id);
    if (p.due && isoToDay(p.due) === null) err(errors, 'dueDate', `${ref}: неисправно доспијеће`, p.id);
    if (!p.id || p.id === CASE_COSTS || byId.has(p.id)) err(errors, 'principalId', `${ref}: идентификатор недостаје или се понавља`, p.id);
    const o = {
      id: p.id, label: p.label || `Главница ${i + 1}`, order: i, kind: 'principal',
      initial: amount || ZERO, P: amount || ZERO, I: ZERO, C: ZERO, accrued: ZERO,
      start, firstDay: null, lastDay: end, nextDay: null, due: p.due || '',
      paidCosts: ZERO, paidInterest: ZERO, paidPrincipal: ZERO, costsTotal: ZERO, overpay: ZERO,
    };
    if (start !== null) {
      o.firstDay = st.dayRule === 'includeBoth' ? start : start + 1;
      o.nextDay = o.firstDay;
      if (end !== null && o.firstDay > end) warnings.push({ code: 'zeroDays', msg: `${o.label}: нема дана за обрачун камате (почетни датум ${dayToIso(start)}, датум обрачуна ${dayToIso(end)})` });
    }
    obligations.push(o); byId.set(o.id, o);
  });
  if (!obligations.length) err(errors, 'noPrincipal', 'Унесите бар једну главницу');

  const caseCosts = { id: CASE_COSTS, label: 'Трошкови предмета', kind: 'case', order: 1e6, C: ZERO, costsTotal: ZERO, paidCosts: ZERO, overpay: ZERO, P: ZERO, I: ZERO, start: -1e9 };

  // Догађаји
  const events = [];
  (input.costs || []).forEach((c, i) => {
    const ref = `Трошак ${i + 1}${c.desc ? ' (' + c.desc + ')' : ''}`;
    const day = isoToDay(c.date);
    let amount = null;
    try { if (!/^\d{1,30}(\.\d{1,2})?$/.test(String(c.amount))) throw 0; amount = Q.parse(c.amount); if (amount.sign() <= 0) throw 0; } catch { err(errors, 'costAmount', `${ref}: неисправан износ`); }
    if (day === null) err(errors, 'costDate', `${ref}: неисправан датум`);
    const target = c.target || CASE_COSTS;
    if (target !== CASE_COSTS && !byId.has(target)) err(errors, 'costTarget', `${ref}: веза са непостојећом главницом`);
    if (day !== null && end !== null && day > end) { warnings.push({ code: 'costAfterEnd', msg: `${ref}: датум послије датума обрачуна — није укључен` }); return; }
    if (amount && day !== null) events.push({ type: 'cost', typeOrder: 0, day, seq: 0, idx: i, amount, target, desc: c.desc || '', id: c.id });
  });
  (input.payments || []).forEach((p, i) => {
    const ref = `Уплата ${i + 1}${p.desc ? ' (' + p.desc + ')' : ''}`;
    const day = isoToDay(p.date);
    let amount = null;
    try { if (!/^\d{1,30}(\.\d{1,2})?$/.test(String(p.amount))) throw 0; amount = Q.parse(p.amount); if (amount.sign() <= 0) throw 0; } catch { err(errors, 'payAmount', `${ref}: неисправан износ`); }
    if (day === null) err(errors, 'payDate', `${ref}: неисправан датум`);
    let splits = null;
    if (Array.isArray(p.splits) && p.splits.length) {
      splits = [];
      let sum = ZERO;
      for (const s of p.splits) {
        let a = null;
        try { if (!/^\d{1,30}(\.\d{1,2})?$/.test(String(s.amount))) throw 0; a = Q.parse(s.amount); if (a.sign() <= 0) throw 0; } catch { err(errors, 'splitAmount', `${ref}: неисправан износ у расподјели`); continue; }
        if (s.target !== CASE_COSTS && !byId.has(s.target)) { err(errors, 'splitTarget', `${ref}: расподјела на непостојећу обавезу`); continue; }
        sum = sum.add(a); splits.push({ target: s.target, amount: a });
      }
      if (amount && sum.cmp(amount) !== 0) err(errors, 'splitSum', `${ref}: збир расподјеле (${sum.toFixed(2)}) није једнак износу уплате (${amount.toFixed(2)})`);
    } else if (st.unassignedRule === 'none') {
      err(errors, 'unassigned', `${ref}: није означено на коју се обавезу односи, а није изабрано правило за уплате без намјене`);
    }
    if (day !== null && end !== null && day > end) { err(errors, 'payAfterEnd', `${ref}: датум је послије датума обрачуна. Помјерите датум обрачуна или уклоните ову уплату.`); return; }
    if (day !== null && obligations.length && obligations.every(o => o.start !== null && day < o.start)) err(errors, 'payBeforeStart', `${ref}: уплата је прије почетка свих обавеза. Аванс није аутоматски пренесен у обрачун.`);
    if (amount && day !== null) events.push({ type: 'payment', typeOrder: 1, day, seq: Number.isFinite(+p.seq) ? +p.seq : i, idx: i, amount, splits, desc: p.desc || '', id: p.id });
  });
  events.sort((a, b) => a.day - b.day || a.typeOrder - b.typeOrder || a.seq - b.seq || a.idx - b.idx);

  const rows = [];
  const missing = [];
  let rowSeq = 0;

  // Ако већ постоје грешке које онемогућавају обрачун, стани.
  if (errors.length) return finish(false);

  function addMissing(from, to) {
    const last = missing[missing.length - 1];
    if (last && last.from <= to + 1 && from <= last.to + 1) { last.from = Math.min(last.from, from); last.to = Math.max(last.to, to); }
    else missing.push({ from, to });
  }

  function accrue(o, toDay) {
    if (o.kind !== 'principal' || o.nextDay === null) return;
    const to = Math.min(toDay, end);
    let cur = o.nextDay;
    while (cur <= to) {
      const yEnd = yearEnd(cur);
      const r = findRate(table, cur);
      let segEnd;
      if (!r) {
        segEnd = Math.min(to, yEnd, nextRateStart(table, cur) - 1);
        if (o.P.sign() > 0) addMissing(cur, segEnd);
      } else {
        segEnd = Math.min(to, yEnd, r.to);
        if (o.P.sign() > 0) {
          const days = segEnd - cur + 1;
          const divisor = isLeap(yearOf(cur)) ? 36600 : 36500;
          const interest = o.P.mul(r.rate).mul(BigInt(days)).div(BigInt(divisor));
          o.I = o.I.add(interest); o.accrued = o.accrued.add(interest);
          rows.push({
            seq: ++rowSeq, type: 'interest', oid: o.id, from: dayToIso(cur), to: dayToIso(segEnd), days, divisor,
            rate: r.rate, rateStr: r.rateStr, rateKind: r.kind, rateStatus: r.status, rateBasis: r.basis,
            base: o.P, interest, after: snap(o),
          });
        }
      }
      cur = segEnd + 1;
    }
    o.nextDay = Math.max(o.nextDay, to + 1);
  }
  function snap(o) { return { P: o.P, I: o.I, C: o.C }; }

  // Урачунавање износа A на једну обавезу; враћа распоред.
  function applyTo(o, A, ev, note) {
    let toC = ZERO, toI = ZERO, toP = ZERO;
    if (o.kind === 'case') {
      toC = st.allocation === 'principalOnly' ? ZERO : Q.min(A, o.C);
    } else if (st.allocation === 'costsInterestPrincipal') {
      toC = Q.min(A, o.C);
      toI = Q.min(A.sub(toC), o.I);
      toP = Q.min(A.sub(toC).sub(toI), o.P);
    } else {
      toP = Q.min(A, o.P);
    }
    const over = A.sub(toC).sub(toI).sub(toP);
    o.C = o.C.sub(toC); o.I = o.I.sub(toI); o.P = o.P.sub(toP);
    o.paidCosts = o.paidCosts.add(toC);
    if (o.kind === 'principal') { o.paidInterest = o.paidInterest.add(toI); o.paidPrincipal = o.paidPrincipal.add(toP); }
    o.overpay = o.overpay.add(over);
    rows.push({ seq: ++rowSeq, type: 'payment', oid: o.id, date: dayToIso(ev.day), paymentId: ev.id, paymentIdx: ev.idx, desc: ev.desc, note: note || '',
      paymentTotal: ev.amount, amount: A, toCosts: toC, toInterest: toI, toPrincipal: toP, overpay: over, after: snap(o) });
  }

  const existsAt = (o, day) => o.kind === 'case' || o.start <= day;

  for (const ev of events) {
    if (ev.type === 'cost') {
      const o = ev.target === CASE_COSTS ? caseCosts : byId.get(ev.target);
      if (o.kind === 'principal') {
        if (ev.day < o.start) warnings.push({ code: 'costBeforeStart', msg: `Трошак „${ev.desc}“ (${dayToIso(ev.day)}) је прије почетног датума обавезе ${o.label}` });
        accrue(o, st.paymentDayRule === 'interestBeforePayment' ? ev.day : ev.day - 1);
      }
      o.C = o.C.add(ev.amount); o.costsTotal = o.costsTotal.add(ev.amount);
      rows.push({ seq: ++rowSeq, type: 'cost', oid: o.id, date: dayToIso(ev.day), desc: ev.desc, amount: ev.amount, after: snap(o) });
      continue;
    }
    // Уплата
    const cutoff = st.paymentDayRule === 'interestBeforePayment' ? ev.day : ev.day - 1;
    if (ev.splits) {
      for (const s of ev.splits) {
        const o = s.target === CASE_COSTS ? caseCosts : byId.get(s.target);
        if (!existsAt(o, ev.day)) {
          err(errors, 'payBeforeStart', `Уплата ${ev.idx + 1} (${dayToIso(ev.day)}) је распоређена на обавезу „${o.label}“ која на тај дан још није настала (почетни датум ${dayToIso(o.start)})`);
          continue;
        }
        accrue(o, cutoff);
        applyTo(o, s.amount, ev, 'по означеној намјени');
      }
    } else {
      const avail = [caseCosts, ...obligations].filter(o => existsAt(o, ev.day));
      avail.forEach(o => accrue(o, cutoff));
      const outstanding = o => st.allocation === 'principalOnly' ? o.P : o.C.add(o.I).add(o.P);
      if (st.unassignedRule === 'oldestFirst') {
        const ordered = avail.slice().sort((a, b) => (a.kind === 'case' ? -1 : 0) - (b.kind === 'case' ? -1 : 0) || (a.due ? isoToDay(a.due) : a.start) - (b.due ? isoToDay(b.due) : b.start) || a.order - b.order);
        let A = ev.amount;
        const parts = [];
        for (const o of ordered) {
          if (A.sign() <= 0) break;
          const take = Q.min(A, outstanding(o));
          if (take.sign() > 0) { parts.push([o, take]); A = A.sub(take); }
        }
        if (A.sign() > 0) {
          // остатак (преплата) се евидентира на посљедњу обавезу у реду, без преношења
          const lastO = parts.length ? parts[parts.length - 1][0] : ordered[ordered.length - 1];
          const ex = parts.find(p => p[0] === lastO);
          if (ex) ex[1] = ex[1].add(A); else parts.push([lastO, A]);
        }
        parts.forEach(([o, a]) => applyTo(o, a, ev, 'без намјене — најстарија обавеза прво'));
      } else if (st.unassignedRule === 'proportional') {
        const outs = avail.map(o => [o, outstanding(o)]).filter(([, v]) => v.sign() > 0);
        const total = outs.reduce((s, [, v]) => s.add(v), ZERO);
        if (total.isZero()) {
          const o = avail.find(x => x.kind === 'principal') || caseCosts;
          applyTo(o, ev.amount, ev, 'без намјене — нема дуга, цијела уплата је преплата');
        } else {
          const payable = Q.min(ev.amount, total);
          const extra = ev.amount.sub(payable);
          outs.forEach(([o, v], k) => {
            let a = payable.mul(v).div(total);
            if (k === outs.length - 1 && extra.sign() > 0) a = a.add(extra);
            applyTo(o, a, ev, 'без намјене — сразмјерно');
          });
        }
      }
    }
  }
  // Обрачун до краја
  obligations.forEach(o => accrue(o, end));

  if (missing.length) {
    err(errors, 'missingRates', 'Изабрана табела стопа не покрива периоде: ' + missing.map(m => `${dayToIso(m.from)} – ${dayToIso(m.to)}`).join('; ') + '. Обрачун је блокиран.');
    missing.forEach(m => { m.fromIso = dayToIso(m.from); m.toIso = dayToIso(m.to); });
  }
  return finish(errors.length === 0);

  function finish(ok) {
    const all = [...obligations, caseCosts];
    const sum = f => all.reduce((s, o) => s.add(f(o) || ZERO), ZERO);
    const totals = {
      initialPrincipal: obligations.reduce((s, o) => s.add(o.initial), ZERO),
      interestAccrued: obligations.reduce((s, o) => s.add(o.accrued || ZERO), ZERO),
      costsTotal: sum(o => o.costsTotal),
      paymentsTotal: events.filter(e => e.type === 'payment').reduce((s, e) => s.add(e.amount), ZERO),
      paidCosts: sum(o => o.paidCosts),
      paidInterest: obligations.reduce((s, o) => s.add(o.paidInterest), ZERO),
      paidPrincipal: obligations.reduce((s, o) => s.add(o.paidPrincipal), ZERO),
      remainingPrincipal: obligations.reduce((s, o) => s.add(o.P), ZERO),
      remainingInterest: obligations.reduce((s, o) => s.add(o.I), ZERO),
      remainingCosts: sum(o => o.C),
      overpay: sum(o => o.overpay),
    };
    totals.remainingDebt = totals.remainingPrincipal.add(totals.remainingInterest).add(totals.remainingCosts);
    const usedEntries = ok ? table.filter(e => rows.some(r => r.type === 'interest' && dayFromIso(r.from) <= e.to && dayFromIso(r.to) >= e.from)) : [];
    const working = usedEntries.some(e => e.status !== 'потврђено');
    const manual = usedEntries.some(e => e.kind === 'manual');
    return {
      ok, errors, warnings, rows: ok ? rows : [], totals,
      obligations: [...obligations, caseCosts].map(o => ({
        id: o.id, label: o.label, kind: o.kind, initial: o.initial || ZERO, start: o.start != null && o.kind === 'principal' ? dayToIso(o.start) : '',
        firstDay: o.firstDay != null ? dayToIso(o.firstDay) : '', lastDay: end != null ? dayToIso(end) : '', due: o.due || '',
        accrued: o.accrued || ZERO, P: o.P, I: o.I, C: o.C, overpay: o.overpay, costsTotal: o.costsTotal, paidCosts: o.paidCosts,
        paidInterest: o.paidInterest || ZERO, paidPrincipal: o.paidPrincipal || ZERO,
        noInterestDays: o.kind === 'principal' && o.firstDay != null && end != null && o.firstDay > end,
      })),
      usedRates: usedEntries.map(e => ({
        kind: e.kind, from: e.from > -1e8 ? dayToIso(e.from) : '', to: e.to < 1e8 ? dayToIso(e.to) : '',
        rateStr: e.rateStr, status: e.status, basis: e.basis, src: e.src || null,
      })),
      missing,
      working, manual,
      settings: st,
      meta: { engineVersion: ENGINE_VERSION, calcDate: input.calcDate },
    };
  }
}

function dayFromIso(s) { return isoToDay(s); }

// Збир заокружених vs. незаокружених — помоћ за приказ: увијек сабирати Q, па заокружити.
export function fx(q) { return (q || ZERO).toFixed(2); }
