#!/usr/bin/env python3
"""Провјера Excel формула: LibreOffice поново израчунава сваку формулу у извезеном .xlsx,
па се упоређује збирни преглед (колона „Excel (формула)“) са вриједношћу апликације на цент.
Покретање: node tests/xlsx-build.mjs && python3 tests/xlsx_verify.py
"""
import json, subprocess, sys, shutil, tempfile
from pathlib import Path
from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'tests/out'
manifest = json.loads((OUT / 'manifest.json').read_text(encoding='utf-8'))
tmp = Path(tempfile.mkdtemp())
calc = tmp / 'calc'
calc.mkdir()
files = [str(OUT / m['file']) for m in manifest]
# Конверзија у ODS па назад у XLSX приморава LibreOffice да израчуна све формуле.
subprocess.run(['soffice', '--headless', '--calc', '--convert-to', 'ods', '--outdir', str(tmp)] + files, check=True, capture_output=True)
odss = [str(tmp / (Path(f).stem + '.ods')) for f in files]
subprocess.run(['soffice', '--headless', '--calc', '--convert-to', 'xlsx', '--outdir', str(calc)] + odss, check=True, capture_output=True)

fails = 0
for m in manifest:
    wb = load_workbook(calc / m['file'], data_only=True)
    ws = wb.worksheets[0]
    # пронађи ред „Збирни преглед“ / „Zbirni pregled“
    start = None
    for r in range(1, ws.max_row + 1):
        v = ws.cell(r, 2).value
        if v in ('Збирни преглед', 'Zbirni pregled'):
            start = r + 1
            break
    assert start, m['file']
    diffs = []
    r = start
    while ws.cell(r, 2).value:
        excel, app, diff = ws.cell(r, 9).value, ws.cell(r, 10).value, ws.cell(r, 11).value
        if excel is None or diff is None:
            diffs.append(f"ред {r}: формула није израчуната")
        elif abs(round(excel + 1e-9 if excel >= 0 else excel - 1e-9, 2) - app) > 0.0049 or abs(diff) > 0.0049:
            diffs.append(f"ред {r} „{ws.cell(r, 2).value}“: Excel {excel} ≠ апликација {app}")
        r += 1
    # провјера да нема Excel грешака (#VALUE! итд.) у табели
    for row in ws.iter_rows(min_row=1, max_row=ws.max_row):
        for c in row:
            if isinstance(c.value, str) and c.value.startswith('#') and c.value.endswith(('!', '?', 'A')):
                diffs.append(f"{c.coordinate}: {c.value}")
    status = 'OK' if not diffs else 'ГРЕШКА'
    if diffs:
        fails += 1
    print(f"{status:7} {m['file']:16} {m['name']}" + ('' if not diffs else '\n   ' + '\n   '.join(diffs)))
shutil.rmtree(tmp)
print(f"\nУкупно {len(manifest)} фајлова, {fails} са разликом.")
sys.exit(1 if fails else 0)
