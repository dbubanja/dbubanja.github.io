#!/usr/bin/env python3
"""Провјера нових одлука ЦБЦГ о стопи затезне камате (покреће GitHub Actions).

Шта ради:
  1. преузме страницу ЦБЦГ са табелом стопа;
  2. пронађе везе ка одлукама које још нису у rates.json;
  3. преузме сваку нову одлуку, извуче текст (pdftotext) и покуша да прочита стопу,
     период и број одлуке ИЗ САДРЖАЈА (не само из назива фајла);
  4. упише приједлог у rates.json са статусом „непотврђено“ и направи извјештај
     tools/out/izvjestaj.md за pull request.

Шта НЕ ради:
  - не мијења постојеће ставке и не означава ништа као „потврђено“;
  - не објављује ништа без људске провјере (промјена иде кроз pull request).

Напомена: поступак није испробан на живом сајту ЦБЦГ у току израде (мрежа је била недоступна).
Промјена изгледа сајта не може покварити постојећу табелу — у најгорем случају скрипта пријави грешку.
"""
import hashlib, json, re, subprocess, sys, urllib.request, urllib.parse
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = 'https://www.cbcg.me/me/kljucne-funkcije/finansijske-i-bankarske-operacije/stopa-zatezne-kamate'
OUT = ROOT / 'tools/out'
OUT.mkdir(parents=True, exist_ok=True)
UA = {'User-Agent': 'zatezna-kamata-cg rates check (GitHub Actions)'}
MONTHS = {'januar': 1, 'februar': 2, 'mart': 3, 'april': 4, 'maj': 5, 'jun': 6, 'jul': 7, 'avgust': 8, 'septemb': 9, 'oktob': 10, 'novemb': 11, 'decemb': 12}
CYR = str.maketrans({'а':'a','б':'b','в':'v','г':'g','д':'d','ђ':'đ','е':'e','ж':'ž','з':'z','и':'i','ј':'j','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','ћ':'ć','у':'u','ф':'f','х':'h','ц':'c','ч':'č','ш':'š'})

def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()

def norm(text):
    t = text.lower().translate(CYR)
    t = t.replace('ľ', 'lj')
    return re.sub(r'\s+', ' ', t)

def parse_decision(text):
    """Враћа {стопа, датум_од, датум_до, број_одлуке, проблеми[]} прочитано из текста одлуке."""
    t = norm(text)
    problems = []
    rates = set(m.replace(',', '.') for m in re.findall(r'(\d{1,2}[,.]\d{1,2})\s*%', t))
    rate = None
    if len(rates) == 1:
        rate = f"{float(rates.pop()):.2f}"
    else:
        problems.append(f'стопа није једнозначно прочитана: {sorted(rates) or "нема"}')
    # периоди тип „od 1. jula 2026. do 31. decembra 2026.“
    rx = r'(\d{1,2})\.\s*(januar|februar|mart|april|maj|jun|jul|avgust|septemb|oktob|novemb|decemb)[a-z]*\s*(\d{4})'
    ds = []
    for d, mo, y in re.findall(rx, t):
        try:
            ds.append(date(int(y), MONTHS[mo], int(d)))
        except ValueError:
            pass
    period = None
    for a in ds:
        for b in ds:
            if b > a and ((a.month, a.day, b.month, b.day) in ((1, 1, 6, 30), (7, 1, 12, 31))) and a.year == b.year:
                period = (a, b)
    if not period:
        problems.append('период важења није пронађен у тексту')
    # број одлуке: у заглављу „Broj: ...“; број из преамбуле (овлашћење потписника) се занемарује
    # прво бројеви са двотачком („Broj: …“ у заглављу), па тек онда остали
    head = [n.strip().replace(' ', '') for n in re.findall(r'broj:\s*([0-9][0-9\-/]{3,30})', t)]
    nums = [n.strip().replace(' ', '') for n in re.findall(r'broj[:\s]+([0-9][0-9\-/]{3,30})', t)]
    if period:
        same_year = [n for n in head + nums if n.endswith(str(period[0].year))]
        num = (same_year or head or nums or [None])[0]
    else:
        num = (head or nums or [None])[0]
    if not num:
        problems.append('број одлуке није пронађен')
    if len(set(nums)) > 1:
        problems.append(f'више бројева у тексту ({", ".join(sorted(set(nums)))}); изабран {num} — провјерити да је то број одлуке о стопи, а не овлашћења потписника')
    return {'стопа': rate, 'период': period, 'број_одлуке': num, 'проблеми': problems}

def main():
    rj_path = ROOT / 'rates.json'
    rj = json.loads(rj_path.read_text(encoding='utf-8'))
    known = {r.get('извор_одлуке', '') for r in rj['rates']}
    known_files = {Path(urllib.parse.urlparse(u).path).name.lower() for u in known if u}
    report = ['# Провјера одлука ЦБЦГ о стопи затезне камате', '', f'Страница: {PAGE}', '']
    try:
        html = get(PAGE).decode('utf-8', 'replace')
    except Exception as e:
        report.append(f'**Страница ЦБЦГ није доступна:** {e}. Табела није мијењана.')
        (OUT / 'izvjestaj.md').write_text('\n'.join(report), encoding='utf-8')
        print('\n'.join(report)); return 0
    links = set(re.findall(r'href="([^"]*zatezne[^"]*\.(?:pdf|jpg|png))"', html, re.I))
    links = {urllib.parse.urljoin(PAGE, l) for l in links}
    new = sorted(l for l in links if Path(urllib.parse.urlparse(l).path).name.lower() not in known_files)
    if not new:
        report.append('Нема нових одлука у односу на rates.json.')
        (OUT / 'izvjestaj.md').write_text('\n'.join(report), encoding='utf-8')
        print('\n'.join(report)); return 0
    added = 0
    for url in new:
        report.append(f'## {url}')
        try:
            blob = get(url)
        except Exception as e:
            report.append(f'- преузимање није успјело: {e}'); continue
        name = Path(urllib.parse.urlparse(url).path).name
        (OUT / name).write_bytes(blob)
        sha = hashlib.sha256(blob).hexdigest()
        text = ''
        if name.lower().endswith('.pdf'):
            r = subprocess.run(['pdftotext', '-layout', str(OUT / name), '-'], capture_output=True, text=True)
            text = r.stdout
        if len(text.strip()) < 50:
            report.append('- текст се не може прочитати (вјероватно скениран документ) — потребна ручна провјера; ставка НИЈЕ додата.')
            continue
        info = parse_decision(text)
        for p in info['проблеми']:
            report.append(f'- ⚠ {p}')
        if not info['стопа'] or not info['период']:
            report.append('- ставка НИЈЕ додата — недостају подаци прочитани из садржаја.'); continue
        a, b = info['период']
        if any(r['датум_од'] == a.isoformat() for r in rj['rates']):
            report.append(f'- период {a} већ постоји у табели — ставка није додата (провјерити да ли је ЦБЦГ промијенио одлуку).'); continue
        entry = {
            'датум_од': a.isoformat(), 'датум_до': b.isoformat(), 'стопа': info['стопа'],
            'основ': f"Одлука ЦБЦГ бр. {info['број_одлуке'] or '?'} — АУТОМАТСКИ ИЗДВОЈЕНО, ПРОВЈЕРИТИ",
            'статус': 'непотврђено', 'број_одлуке': info['број_одлуке'] or '', 'датум_одлуке': '', 'службени_лист': '',
            'извор_одлуке': url, 'извор_службеног_листа': PAGE, 'језик_изворне_датотеке': 'me',
            'локални_извор': f'izvori/{a.isoformat()}{Path(name).suffix}', 'sha256_извора': sha,
            'провјерено_дана': '', 'напомена': 'Аутоматски издвојено из текста одлуке. Прије промјене статуса у „потврђено“ провјерити стопу, период, број и датум одлуке и број Службеног листа.',
        }
        rj['rates'].append(entry)
        report.append(f"- приједлог: {a} – {b}: **{info['стопа']}%**, одлука {info['број_одлуке']}, статус **непотврђено**")
        added += 1
    if added:
        rj['rates'].sort(key=lambda r: r['датум_од'])
        rj['version'] = date.today().isoformat() + '.auto'
        rj['покривено_до'] = max(r['датум_до'] for r in rj['rates'])
        rj_path.write_text(json.dumps(rj, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        report += ['', f'Додато {added} непотврђених ставки. **Прије спајања (merge)** провјерите сваку ставку према изворној одлуци и промијените статус у „потврђено“ и попуните датум одлуке, Службени лист и датум провјере.']
    (OUT / 'izvjestaj.md').write_text('\n'.join(report), encoding='utf-8')
    print('\n'.join(report))
    return 0

if __name__ == '__main__':
    sys.exit(main())
