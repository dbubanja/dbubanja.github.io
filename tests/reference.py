#!/usr/bin/env python3
"""Независни референтни прорачун: дан по дан, Python Fraction.

Намјерно другачији поступак од апликације: апликација рачуна по подпериодима (сегментима),
а овај програм сабира камату за сваки календарски дан посебно, са сопственом табелом стопа,
сопственим датумима (datetime.date) и сопственом расподјелом уплата. Резултат: tests/expected.json.
"""
import json, sys
from fractions import Fraction as F
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def d(s): return date.fromisoformat(s)
def leap(y): return y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)

def rate_table(st, official):
    mode = st.get('rateMode', 'official')
    if mode == 'official':
        rows = [(d(r['датум_од']), d(r['датум_до']), F(r['стопа'])) for r in official]
    elif mode == 'single':
        rows = [(date(1900, 1, 1), date(2200, 12, 31), F(st['singleRate']['стопа']))]
    else:
        rows = [(d(r['датум_од']), d(r['датум_до']), F(r['стопа'])) for r in st['customRates']]
    rows.sort()
    for i in range(1, len(rows)):
        if rows[i][0] <= rows[i - 1][1]:
            return None, 'overlap'
    return rows, None

def rate_on(tab, day):
    for a, b, r in tab:
        if a <= day <= b:
            return r
    return None

def run(inp, official):
    st = {'dayRule': 'excludeFirst', 'paymentDayRule': 'interestBeforePayment', 'allocation': 'costsInterestPrincipal', 'unassignedRule': 'none'}
    st.update(inp.get('settings', {}))
    tab, problem = rate_table(st, official)
    if problem:
        return {'ok': False, 'reason': problem}
    end = d(inp['calcDate'])
    obs = []
    for i, p in enumerate(inp['principals']):
        s = d(p['start'])
        obs.append({'id': p['id'], 'order': i, 'start': s, 'first': s if st['dayRule'] == 'includeBoth' else s + timedelta(days=1),
                    'P': F(p['amount']), 'I': F(0), 'C': F(0), 'acc': F(0), 'pc': F(0), 'pi': F(0), 'pp': F(0), 'over': F(0), 'case': False})
    case = {'id': '__case', 'C': F(0), 'pc': F(0), 'over': F(0), 'case': True, 'P': F(0), 'I': F(0), 'start': date(1900, 1, 1), 'order': -1}
    byid = {o['id']: o for o in obs}; byid['__case'] = case
    evs = []
    for i, c in enumerate(inp.get('costs', [])):
        if d(c['date']) <= end:
            evs.append((d(c['date']), 0, 0, i, 'cost', c))
    for i, p in enumerate(inp.get('payments', [])):
        if d(p['date']) <= end:
            evs.append((d(p['date']), 1, p.get('seq', i), i, 'pay', p))
    evs.sort(key=lambda e: e[:4])
    alloc_mode = st['allocation']

    def apply(o, A):
        if o['case']:
            c = min(A, o['C']); i = F(0); g = F(0)
        elif alloc_mode == 'costsInterestPrincipal':
            c = min(A, o['C']); i = min(A - c, o['I']); g = min(A - c - i, o['P'])
        else:
            c = F(0); i = F(0); g = min(A, o['P'])
        o['C'] -= c; o['I'] -= i; o['P'] -= g; o['pc'] += c
        if not o['case']:
            o['pi'] += i; o['pp'] += g
        o['over'] += A - c - i - g

    def outstanding(o):
        if o['case']: return o['C']
        return o['C'] + o['I'] + o['P'] if alloc_mode == 'costsInterestPrincipal' else o['P']

    def process(ev):
        day, _, _, _, kind, e = ev
        amt = F(e['amount'])
        if kind == 'cost':
            byid[e.get('target', '__case')]['C'] += amt
            return
        if e.get('splits'):
            for s in e['splits']:
                apply(byid[s['target']], F(s['amount']))
            return
        avail = [case] + [o for o in obs if o['start'] <= day]
        if st['unassignedRule'] == 'oldestFirst':
            order = sorted(avail, key=lambda o: (0 if o['case'] else 1, o['start'], o['order']))
            A = amt; parts = []
            for o in order:
                if A <= 0: break
                t = min(A, outstanding(o))
                if t > 0: parts.append([o, t]); A -= t
            if A > 0:
                if parts: parts[-1][1] += A
                else: parts.append([order[-1], A])
            for o, a in parts: apply(o, a)
        elif st['unassignedRule'] == 'proportional':
            outs = [(o, outstanding(o)) for o in avail if outstanding(o) > 0]
            tot = sum((v for _, v in outs), F(0))
            pay = min(amt, tot); extra = amt - pay
            for k, (o, v) in enumerate(outs):
                a = pay * v / tot
                if k == len(outs) - 1: a += extra
                apply(o, a)

    starts = [o['first'] for o in obs] + [e[0] for e in evs]
    day = min(starts) if starts else end
    missing = []
    ei = 0
    before = st['paymentDayRule'] == 'paymentBeforeInterest'
    while day <= end or ei < len(evs):
        todays = []
        while ei < len(evs) and evs[ei][0] == day:
            todays.append(evs[ei]); ei += 1
        if before:
            for ev in todays: process(ev)
        if day <= end:
            diy = 366 if leap(day.year) else 365
            for o in obs:
                if day >= o['first'] and o['P'] > 0:
                    r = rate_on(tab, day)
                    if r is None:
                        missing.append(day.isoformat())
                    else:
                        x = o['P'] * r / (100 * diy)
                        o['I'] += x; o['acc'] += x
        if not before:
            for ev in todays: process(ev)
        day += timedelta(days=1)
        if day > end and ei >= len(evs):
            break
    if missing:
        return {'ok': False, 'reason': 'missing', 'firstMissing': missing[0], 'lastMissing': missing[-1], 'missingDays': len(set(missing))}
    allo = obs + [case]
    rs = lambda x: str(x.numerator) if x.denominator == 1 else f'{x.numerator}/{x.denominator}'
    return {'ok': True, 'totals': {
        'interestAccrued': rs(sum((o['acc'] for o in obs), F(0))),
        'paidCosts': rs(sum((o['pc'] for o in allo), F(0))),
        'paidInterest': rs(sum((o['pi'] for o in obs), F(0))),
        'paidPrincipal': rs(sum((o['pp'] for o in obs), F(0))),
        'remainingPrincipal': rs(sum((o['P'] for o in obs), F(0))),
        'remainingInterest': rs(sum((o['I'] for o in obs), F(0))),
        'remainingCosts': rs(sum((o['C'] for o in allo), F(0))),
        'overpay': rs(sum((o['over'] for o in allo), F(0))),
    }}

def main():
    official = json.loads((ROOT / 'rates.json').read_text(encoding='utf-8'))['rates']
    sc = json.loads((ROOT / 'tests/scenarios.json').read_text(encoding='utf-8'))
    out = {s['name']: run(s['input'], official) for s in sc}
    (ROOT / 'tests/expected.json').write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    for k, v in out.items():
        print(k, '→', 'OK' if v['ok'] else 'БЛОКИРАНО ' + v['reason'])

if __name__ == '__main__':
    main()
