#!/usr/bin/env python3
"""Провјера цијелог тока у правом прегледачу (Chromium, Playwright):
унос предмета, грешке уноса, обрачун, уплата, сачуван обрачун, Excel, офлајн рад, извоз/увоз.
Покретање: python3 tests/e2e.py   (сервира пројекат на http://localhost:8765)"""
import subprocess, sys, time, json, os, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / 'tests/out/screens'
SHOTS.mkdir(parents=True, exist_ok=True)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
URL = 'http://localhost:8765/'
results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))
    print(('OK   ' if cond else 'ГРЕШ ') + name + (f' — {detail}' if detail and not cond else ''))

def fill(page, bind, value):
    loc = page.locator(f'[data-bind="{bind}"]')
    loc.fill(value)
    loc.dispatch_event('change')
    page.wait_for_timeout(150)

try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={'width': 1280, 'height': 900}, accept_downloads=True)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.goto(URL)
        page.wait_for_selector('text=Обрачуни')
        # чекај service worker
        page.wait_for_function("navigator.serviceWorker && navigator.serviceWorker.controller !== null", timeout=15000)
        page.wait_for_selector('#offlineChip.ok', timeout=15000)
        check('Service worker активан и „Спремно за офлајн рад“', True)

        page.click('[data-act="new-case"]')
        page.wait_for_selector('[data-bind="info.debtor"]')
        check('Нови обрачун: курсор је у пољу за име дужника', page.evaluate("document.activeElement.dataset.bind") == 'info.debtor')
        page.keyboard.type('Петровић Марко')
        page.keyboard.press('Enter')
        page.wait_for_timeout(300)
        check('Enter прелази на сљедеће поље (датум обрачуна)', page.evaluate("document.activeElement.dataset.bind") == 'calcDate')
        page.keyboard.press('Shift+Enter')
        page.wait_for_timeout(300)
        check('Shift+Enter враћа на претходно поље', page.evaluate("document.activeElement.dataset.bind") == 'info.debtor')
        check('Нема поља суд/тужилац/тужени/вјештак', page.locator('[data-bind="info.court"], [data-bind="info.plaintiff"], [data-bind="info.defendant"], [data-bind="info.expert"]').count() == 0)
        page.keyboard.press('Enter')
        page.wait_for_timeout(300)
        page.keyboard.press('Enter')  # у напомену
        page.wait_for_timeout(300)
        check('Enter стиже до напомене (textarea)', page.evaluate("document.activeElement.dataset.bind") == 'info.note')
        fill(page, 'calcDate', '31.02.2024')
        check('Непостојећи датум 31.02.2024 је одбијен', page.locator('.fld.bad').count() == 1 and 'не постоји' in page.locator('.fld.bad .err').inner_text())
        fill(page, 'calcDate', '01.01.2012')
        check('Исправан датум уклања грешку', page.locator('.fld.bad').count() == 0)

        page.click('.tabs a:nth-child(2)')
        page.click('[data-act="add-principal"]')
        pid = page.locator('[data-bind^="principals."][data-bind$=".amount"]').first.get_attribute('data-bind').split('.')[1]
        page.locator(f'[data-bind="principals.{pid}.label"]').click()
        page.keyboard.type('Рачун 1'); page.keyboard.press('Enter'); page.wait_for_timeout(300)
        check('Enter: опис → износ', page.evaluate("document.activeElement.dataset.bind") == f'principals.{pid}.amount')
        page.keyboard.type('1000,00'); page.keyboard.press('Enter'); page.wait_for_timeout(300)
        check('Enter: износ → почетни датум (износ сачуван)', page.evaluate("document.activeElement.dataset.bind") == f'principals.{pid}.start')
        page.keyboard.type('01.01.2011'); page.keyboard.press('Enter'); page.wait_for_timeout(300)
        page.keyboard.press('Enter'); page.wait_for_timeout(300)
        fill(page, f'principals.{pid}.amount', '1.234')
        check('Двосмислен износ 1.234 је означен', page.locator('.fld.bad').count() == 1)
        fill(page, f'principals.{pid}.amount', '1000,00')
        fill(page, f'principals.{pid}.start', '01.01.2011')
        page.click('.tabs a:nth-child(4)')
        page.wait_for_selector('#report')
        txt = page.locator('#report .cards').inner_text()
        check('Обрачун 1000 € од 01.01.2011 до 01.01.2012 = 81,26 €', '81,26' in txt, txt)
        page.screenshot(path=str(SHOTS / 'desktop-obracun.png'), full_page=True)

        # уплата
        page.click('.tabs a:nth-child(3)')
        page.click('[data-act="add-payment"]')
        uid = page.locator('[data-bind^="payments."][data-bind$=".amount"]').first.get_attribute('data-bind').split('.')[1]
        fill(page, f'payments.{uid}.date', '30.06.2011')
        fill(page, f'payments.{uid}.amount', '500')
        page.click('.tabs a:nth-child(4)')
        page.wait_for_selector('#report')
        # независно: 1000×8×180/36500=39,4521; уплата 500 → 39,4521 камата + 460,5479 главница; остатак 539,4521
        # 01.07–31.12.2011: 539,4521×8,25×184/36500 = 22,4355..; 01.01.2012: 539,4521×8×1/36600 = 0,1179..
        exp_int = 1000*8*180/36500 + (1000-(500-1000*8*180/36500))*8.25*184/36500 + (1000-(500-1000*8*180/36500))*8/36600
        txt = page.locator('#report .cards').inner_text()
        check(f'Уплата 500 € на дан 30.06.2011: камата {exp_int:.2f} €', f'{exp_int:.2f}'.replace('.', ',') in txt, txt)

        page.click('[data-act="save-snapshot"]')
        page.wait_for_selector('[data-act="xlsx"]')
        with page.expect_download() as dl:
            page.click('[data-act="xlsx"]')
        d = dl.value
        xl = SHOTS / d.suggested_filename
        d.save_as(str(xl))
        from openpyxl import load_workbook
        wb = load_workbook(xl)
        check('Excel има листове Обрачун, Стопе, Подаци о обрачуну', wb.sheetnames == ['Обрачун', 'Стопе', 'Подаци о обрачуну'], str(wb.sheetnames))
        check('Excel заглавље: Дужник Петровић Марко', any(c.value == 'Петровић Марко' for row in wb['Обрачун'].iter_rows(max_row=6) for c in row))
        ws = wb['Обрачун']
        formulas = [c.value for row in ws.iter_rows() for c in row if isinstance(c.value, str) and c.value.startswith('=')]
        check('Excel садржи формуле за камату и расподјелу', any('*' in f and '/' in f for f in formulas) and any('MIN(' in f for f in formulas), str(len(formulas)))

        # латиница
        page.click('#scriptBtn')
        page.wait_for_timeout(300)
        check('Латиница: интерфејс пресловљен, име дужника није', 'Sačuvan obračun' in page.content() and 'Петровић Марко' in page.content())
        page.click('#scriptBtn')

        # офлајн
        ctx.set_offline(True)
        page.goto(URL + '#/')
        page.wait_for_selector('#caseList >> text=Петровић Марко', timeout=10000)
        page.click('#caseList >> text=Петровић Марко')
        page.click('.tabs a:nth-child(4)')
        page.wait_for_selector('#report')
        check('Офлајн: апликација се учитава и рачуна без интернета', f'{exp_int:.2f}'.replace('.', ',') in page.locator('#report .cards').inner_text())
        page.click('[data-act="save-snapshot"]')
        page.wait_for_selector('[data-act="xlsx"]')
        with page.expect_download() as dl2:
            page.click('[data-act="xlsx"]')
        check('Офлајн: Excel извоз ради (локална библиотека)', dl2.value.suggested_filename.endswith('.xlsx'))
        page.goto(URL + '#/rates')
        page.click('[data-act="check-rates"]')
        page.wait_for_selector('#ratesDiff .warn')
        check('Офлајн: провјера ажурирања стопа пријављује грешку и не мијења табелу', 'непромијењена' in page.locator('#ratesDiff').inner_text())
        ctx.set_offline(False)

        # ажурирање стопа: локални фајл са новим непотврђеним периодом
        rj = json.loads((ROOT / 'rates.json').read_text(encoding='utf-8'))
        rj['version'] = 'test-2027'
        rj['покривено_до'] = '2027-06-30'
        rj['rates'].append({**rj['rates'][-1], 'датум_од': '2027-01-01', 'датум_до': '2027-06-30', 'стопа': '9.99', 'статус': 'непотврђено', 'број_одлуке': 'ТЕСТ'})
        tmpf = Path(tempfile.mkdtemp()) / 'rates.json'
        tmpf.write_text(json.dumps(rj, ensure_ascii=False), encoding='utf-8')
        page.goto(URL + '#/rates')
        page.set_input_files('#ratesFile', str(tmpf))
        page.wait_for_selector('#ratesDiff .diff')
        check('Разлике у табели стопа се приказују (нови период, непотврђено)', 'Нови периоди' in page.locator('#ratesDiff').inner_text() and 'непотврђено' in page.locator('#ratesDiff').inner_text())
        page.once('dialog', lambda dg: dg.accept())
        page.click('[data-act="apply-rates"]')
        page.wait_for_timeout(500)
        check('Претходна верзија табеле остаје сачувана', page.locator('[data-act="activate-rates"]').count() >= 1)
        # сачуван обрачун се не мијења
        page.goto(URL + '#/')
        page.click('#caseList >> text=Петровић Марко')
        page.click('.tabs a:nth-child(4)')
        page.wait_for_selector('#snapList li')
        check('Сачувани обрачуни остају (2 верзије)', page.locator('#snapList li').count() == 2)
        page.locator('#snapList li a').last.click()
        page.wait_for_selector('#report .cards')
        check('Сачуван обрачун v1 непромијењен послије ажурирања стопа', f'{exp_int:.2f}'.replace('.', ',') in page.locator('#report .cards').inner_text())
        page.goto(URL + '#/')
        page.click('#caseList >> text=Петровић Марко')

        # обрачун до 2027 са непотврђеном стопом → радни обрачун
        page.click('.tabs a:nth-child(1)')
        fill(page, 'calcDate', '31.03.2027')
        page.click('.tabs a:nth-child(4)')
        page.wait_for_selector('#report')
        check('Обрачун са непотврђеном стопом означен као РАДНИ', 'РАДНИ ОБРАЧУН' in page.locator('#report').inner_text())
        page.click('.tabs a:nth-child(1)')
        fill(page, 'calcDate', '31.12.2027')
        page.click('.tabs a:nth-child(4)')
        page.wait_for_selector('.errors')
        check('Период изван табеле блокира обрачун са тачним датумима', '2027-07-01 – 2027-12-31' in page.locator('.errors').inner_text(), page.locator('.errors').inner_text())

        # извоз и увоз
        page.goto(URL + '#/backup')
        with page.expect_download() as dl3:
            page.click('[data-act="export-all"]')
        bk = SHOTS / 'backup.json'
        dl3.value.save_as(str(bk))
        data = json.loads(bk.read_text(encoding='utf-8'))
        check('Извоз садржи предмет и сачуване обрачуне', len(data['cases']) == 1 and len(data['snapshots']) == 2)
        ctx2 = browser.new_context(accept_downloads=True)
        p2 = ctx2.new_page()
        p2.goto(URL + '#/backup')
        p2.wait_for_selector('#importFile', state='attached')
        p2.set_input_files('#importFile', str(bk))
        p2.wait_for_selector('[data-act="import-apply"]')
        p2.click('[data-act="import-apply"][data-mode="merge"]')
        p2.wait_for_timeout(500)
        p2.goto(URL + '#/')
        check('Увоз на другом „уређају“: обрачун је пренесен', p2.locator('#caseList >> text=Петровић Марко').count() == 1)
        p2.fill('#searchBox', 'petrovic')
        p2.wait_for_timeout(200)
        check('Претрага латиницом без квачица налази „Петровић“', p2.locator('#caseList li').count() == 1)
        p2.fill('#searchBox', 'Јовановић')
        p2.wait_for_timeout(200)
        check('Претрага без поготка', p2.locator('#caseList li').count() == 0)
        p2.goto(URL + '#/backup')
        p2.wait_for_selector('#importFile', state='attached')
        p2.set_input_files('#importFile', str(bk))
        p2.wait_for_selector('#importBox .warn')
        check('Поновни увоз приказује дупликате', 'већ постоје' in p2.locator('#importBox').inner_text())
        ctx2.close()

        # телефон
        m = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
        mp = m.new_page()
        mp.goto(URL)
        mp.wait_for_selector('text=Обрачуни')
        mp.click('[data-act="new-case"]')
        mp.wait_for_selector('[data-bind="info.debtor"]')
        mp.screenshot(path=str(SHOTS / 'mobile-podaci.png'))
        sw = mp.evaluate('document.documentElement.scrollWidth')
        check('Телефон (390 px): нема хоризонталног помјерања странице', sw <= 390, str(sw))
        m.close()
        check('Нема JavaScript грешака у конзоли', not [e for e in errors if 'favicon' not in e and 'ERR_INTERNET_DISCONNECTED' not in e], '; '.join(errors[:5]))
        browser.close()
finally:
    srv.terminate()

bad = [r for r in results if not r[1]]
print(f"\n{len(results) - len(bad)}/{len(results)} провјера прошло.")
sys.exit(1 if bad else 0)
