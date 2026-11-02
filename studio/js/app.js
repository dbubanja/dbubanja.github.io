// Затезна камата ЦГ — интерфејс.
import { calculate, RULES, CASE_COSTS, ENGINE_VERSION } from './engine.js';
import { Q, ZERO } from './rational.js';
import { parseAmount, parseRate, fmtMoney, fmtRate } from './parse.js';
import { parseDMY, isoToDMY, todayIso, isoToDay } from './dates.js';
import { store, getSetting, setSetting, uid, requestPersistence } from './storage.js';
import { validateRatesFile, diffRates } from './rates.js';
import { toPlain, fromPlain } from './serialize.js';
import { t, setScript, getScript, toLatin } from './i18n.js';
import { snapshotHash, verifySnapshot } from './audit.js';
import { validateBackup } from './imports.js';
import { parsePrincipalLines } from './bulk.js';
import { getDownloadStats } from './stats.js';
import { initInstallCounter, getReportedInstallations, INSTALL_SITE } from './install-counter.js';

export const APP_VERSION = '2.0.0';
const DEFAULT_LEGAL_BASIS = 'Закон о облигационим односима, члан 320 — трошкови, затим камата, затим главница. Текст члана провјерен у издању на gov.me (47/08, 4/11, 22/17), 02.11.2026. Примјењивост на конкретан период и однос утврђује вјештак.';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeHref = value => /^https:\/\//.test(String(value || '')) ? esc(value) : '#';
const money = (q) => fmtMoney((q || ZERO).toFixed(2));
const amtDisplay = (v) => (v ? String(v).replace('.', ',') : '');
// Назив ставке у архиви: дужник (старији записи: тужени / број предмета)
const nameOf = (info) => (info && (info.debtor || info.defendant || info.number)) || '';
const nameOrEmpty = (info) => nameOf(info) || t('(без имена дужника)');

const S = { cases: [], cur: null, official: null, officialId: null, result: null, tab: 'data', swReg: null };

// ───────────────────────── Покретање
async function init() {
  setScript(await getSetting('script', 'cyr'));
  await loadOfficialRates();
  S.cases = await store.all('cases');
  S.persistent = await requestPersistence();
  document.documentElement.dataset.theme = await getSetting('theme', 'light');
  window.addEventListener('hashchange', route);
  document.body.addEventListener('change', e => { onFieldChange(e).catch(err => toast(t('Чување није успјело') + ': ' + err.message, 'err')); });
  document.body.addEventListener('click', e => { onClick(e).catch(err => toast(t('Радња није успјела') + ': ' + err.message, 'err')); });
  document.body.addEventListener('keydown', onEnterNext);
  route();
  registerSW();
  initInstallCounter().catch(()=>{});
}

async function loadOfficialRates() {
  const activeId = await getSetting('activeRates', null);
  let rec = activeId ? await store.get('rates', activeId) : null;
  if (!rec) {
    const res = await fetch('rates.json');
    const j = await res.json();
    if (!validateRatesFile(j).ok) throw new Error('Неисправна уграђена табела стопа');
    rec = { id: 'official:' + j.version, version: j.version, importedAt: Date.now(), source: 'уграђено у апликацију', data: j };
    await store.put('rates', rec);
    await setSetting('activeRates', rec.id);
  }
  S.official = rec.data; S.officialId = rec.id;
}

// Enter прелази на сљедеће поље (као Tab). У напомени Enter остаје нови ред; Shift+Enter иде назад.
function onEnterNext(e) {
  if (e.key !== 'Enter' || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
  const el = e.target;
  if (el.matches?.('tr[data-act="inspect-row"]')) { e.preventDefault(); inspectRow(+el.dataset.seq); return; }
  if (!el.matches || !el.matches('input, select') || el.type === 'file' || el.type === 'checkbox') return;
  e.preventDefault();
  const fields = $$('#main input:not([type=hidden]):not([type=file]):not([disabled]), #main select:not([disabled]), #main textarea:not([disabled])')
    .filter(x => x.offsetParent !== null);
  const i = fields.indexOf(el);
  if (i < 0) return;
  const bind = el.dataset.bind;
  el.dispatchEvent(new Event('change', { bubbles: true })); // сачувај вриједност; приказ се може освјежити
  setTimeout(() => {
    const now = $$('#main input:not([type=hidden]):not([type=file]):not([disabled]), #main select:not([disabled]), #main textarea:not([disabled])').filter(x => x.offsetParent !== null);
    let j = bind ? now.findIndex(x => x.dataset.bind === bind) : now.indexOf(el);
    if (j < 0) j = i;
    const next = now[j + (e.shiftKey ? -1 : 1)];
    if (next) { S.focusBind = next.dataset.bind || null; next.focus(); if (next.select && next.tagName === 'INPUT') next.select(); }
    else if (el.blur) el.blur();
  }, 60);
}

// ───────────────────────── Рутирање
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [view, id, sub] = h.split('/');
  if (view === 'case' && id) return openCase(id, sub);
  if (view === 'rates') return renderRates();
  if (view === 'backup') return renderBackup();
  if (view === 'snap' && id) return renderSnapshot(id);
  if (view === 'stats') return renderStats();
  if (view === 'about') return renderAbout();
  return renderHome();
}
function setMain(html) { $('#main').innerHTML = html; window.scrollTo(0, 0); $$('.menu a').forEach(a => a.classList.toggle('active', a.hash === location.hash || (a.hash === '#/' && /^#\/(case|snap)/.test(location.hash)))); }
function setTitle(s) { $('#crumb').textContent = s || ''; }
function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? 7000 : 3500);
}
function applyStaticTexts() {
  $$('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
  $('#scriptBtn').textContent = getScript() === 'cyr' ? 'Ћ → L' : 'L → Ћ';
  document.documentElement.lang = getScript() === 'cyr' ? 'sr-Cyrl' : 'sr-Latn';
}

// ───────────────────────── Почетна: архива обрачуна
function renderHome() {
  applyStaticTexts();
  setTitle('');
  const currentRate = S.official.rates.find(r => r.датум_од <= todayIso() && r.датум_до >= todayIso());
  setMain(`
  <section class="hero">
    <div><span class="eyebrow">${t('РАДНИ ПРОСТОР ВЈЕШТАКА')}</span>
    <h1>${t('Сваки дан.')}<br><em>${t('Сваки цент.')}</em></h1>
    <p>${t('Обрачун затезне камате у Црној Гори, са провјерљивим корацима и изворима стопа.')}</p>
    <div class="btns"><button class="btn primary" data-act="new-case">＋ ${t('Нови обрачун')}</button><button class="btn" data-act="demo">${t('Погледај примјер')} ↗</button></div></div>
    <div class="hero-seal" aria-hidden="true"><span>CG</span><b>%</b><i>365 / 366</i></div>
  </section>
  <div class="metrics">
    <div><span>${t('Обрачуна на уређају')}</span><strong>${S.cases.length.toString().padStart(2,'0')}</strong><small>${t('Сваки са својим сачуваним верзијама')}</small></div>
    <a href="#/rates"><span>${t('Стопа за данашњи датум')}</span><strong>${currentRate ? fmtRate(currentRate.стопа) + '<small>%</small>' : '—'}</strong><small>${currentRate ? isoToDMY(currentRate.датум_од)+' – '+isoToDMY(currentRate.датум_до) : t('Нема покривености — ажурирајте табелу')}</small></a>
    <a href="#/backup"><span>${t('Ваши подаци')}</span><strong class="word">${t('Само код вас')}</strong><small>${t('Локално чување · резервна копија у фајлу')}</small></a>
  </div>
  <section class="panel archive">
    <div class="row-between"><div><span class="eyebrow">${t('АРХИВА')}</span><h2>${t('Ваши обрачуни')}</h2></div><span class="tag">${t('На овом уређају')}</span></div>
    ${S.cases.length ? `<label class="fld search"><span class="sr-only">${t('Тражи по имену дужника')}</span><input id="searchBox" type="search" value="${esc(S.search || '')}" placeholder="${t('Претражи дужника или напомену…')}" autocomplete="off"></label>` : ''}
    <div id="caseList"></div>
  </section>
  <div class="home-notes"><section><span class="eyebrow">01 / ${t('ПРОВЈЕРЉИВО')}</span><h3>${t('Од броја до извора')}</h3><p>${t('Сваки подпериод има своју формулу, број дана и основу стопе. Excel задржава формуле.')}</p></section><section><span class="eyebrow">02 / ${t('САЧУВАНО')}</span><h3>${t('Извјештај који остаје исти')}</h3><p>${t('Сачувана верзија памти податке, стопе и правила. Нове стопе не мијењају стари извјештај.')}</p></section></div>`);
  renderCaseList();
  const sb = $('#searchBox');
  if (sb) sb.addEventListener('input', () => { S.search = sb.value; renderCaseList(); });
}
function renderCaseList() {
  const q = (S.search || '').trim();
  const qn = latin(q);
  const list = S.cases.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .filter(c => !qn || latin(nameOf(c.info) + ' ' + (c.info.note || '')).includes(qn));
  const el = $('#caseList');
  if (!el) return;
  el.innerHTML = !S.cases.length
    ? `<div class="empty welcome"><b>${t('Први обрачун почиње именом дужника.')}</b><p>${t('Додајте главнице, уплате по потреби и одмах прегледајте резултат.')}</p><button class="btn" data-act="new-case">＋ ${t('Почни обрачун')}</button></div>`
    : !list.length ? `<p class="empty">${t('Нема дужника који одговара претрази.')}</p>`
    : `<ul class="case-list">${list.map(c => `
      <li><a href="#/case/${c.id}/${c.principals.length ? 'calc' : 'data'}">
        <strong>${esc(nameOrEmpty(c.info))}</strong>
        ${c.info.note ? `<span class="muted note">${esc(c.info.note)}</span>` : ''}
        <span class="muted small">${t('обрачун на дан')} ${isoToDMY(c.calcDate)}, ${countText(c)}</span>
      </a></li>`).join('')}</ul>`;
}
function countText(c) {
  const n = c.principals.length, u = c.payments.length;
  const g = n === 1 ? t('1 главница') : `${n} ${t(n >= 2 && n <= 4 ? 'главнице' : 'главница')}`;
  return u ? `${g}, ${u} ${t(u === 1 ? 'уплата' : u <= 4 ? 'уплате' : 'уплата')}` : g;
}
// Претрага не зависи од писма ни великих слова: „Петровић“ = „petrovic“
function latin(x) {
  return toLatin(String(x || '')).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'dj');
}

function newCase() {
  return {
    id: uid('c'), createdAt: Date.now(), updatedAt: Date.now(),
    info: { debtor: '', note: '' },
    calcDate: todayIso(),
    settings: {
      dayRule: 'excludeFirst', paymentDayRule: 'interestBeforePayment', allocation: 'costsInterestPrincipal',
      allocationBasis: '', allocationBasisLegal: DEFAULT_LEGAL_BASIS, unassignedRule: 'none', rateMode: 'official',
      singleRate: { стопа: '', основ: '' }, customRates: [],
    },
    principals: [], costs: [], payments: [], invalid: {},
  };
}

async function saveCase() {
  S.cur.updatedAt = Date.now();
  await store.put('cases', S.cur);
  if ($('#saveStatus')) $('#saveStatus').textContent = t('Сачувано на уређају');
  const i = S.cases.findIndex(c => c.id === S.cur.id);
  if (i >= 0) S.cases[i] = S.cur; else S.cases.push(S.cur);
}

// ───────────────────────── Предмет
async function openCase(id, tab) {
  applyStaticTexts();
  const c = S.cases.find(x => x.id === id) || await store.get('cases', id);
  if (!c) { location.hash = '#/'; return; }
  S.cur = c; c.invalid = c.invalid || {};
  S.tab = tab || S.tab || 'data';
  if (!['data', 'principals', 'payments', 'calc'].includes(S.tab)) S.tab = 'data';
  setTitle(nameOrEmpty(c.info));
  const tabs = [['data', 'Дужник'], ['principals', 'Главнице'], ['payments', 'Уплате и трошкови'], ['calc', 'Обрачун']];
  setMain(`
    <div class="workspace-heading"><div><span class="eyebrow">${t('ОБРАЧУН')}</span><h1>${esc(nameOrEmpty(c.info))}</h1></div><span id="saveStatus" class="save-status">${t('Сачувано на уређају')}</span></div>
    <nav class="tabs" aria-label="${t('Кораци обрачуна')}">${tabs.map(([k, l], i) => `<a href="#/case/${c.id}/${k}" class="${S.tab === k ? 'on' : ''}" ${S.tab === k ? 'aria-current="step"' : ''}><span class="n">${i + 1}</span><span class="l">${t(l)}</span></a>`).join('')}</nav>
    <div id="tabBody"></div>`);
  renderTab();
}
function renderTab() {
  if (S.tab === 'data') {
    renderData();
    if (S.focusDebtor) { S.focusDebtor = false; const i = $('[data-bind="info.debtor"]'); if (i) i.focus(); }
    return;
  }
  if (S.tab === 'principals') return renderPrincipals();
  if (S.tab === 'payments') return renderPayments();
  return renderCalc();
}

function fld(label, bind, value, kind = 'text', extra = '') {
  const inv = S.cur.invalid[bind];
  let shown = value ?? '';
  if (kind === 'date') shown = isoToDMY(value);
  if (kind === 'amount' || kind === 'rate') shown = amtDisplay(value);
  if (inv !== undefined) shown = inv.raw;
  const ph = kind === 'date' ? 'dd.mm.yyyy' : kind === 'amount' ? '0,00' : kind === 'rate' ? '0,00' : '';
  const im = kind === 'amount' || kind === 'rate' ? 'decimal' : kind === 'date' ? 'numeric' : 'text';
  return `<label class="fld ${inv ? 'bad' : ''}">${t(label)}
    <input data-bind="${esc(bind)}" data-kind="${kind}" value="${esc(shown)}" placeholder="${ph}" inputmode="${im}" ${kind === 'date' ? 'autocomplete="off" pattern="[0-9.]*"' : ''} ${extra}>
    ${inv ? `<small class="err">${esc(inv.msg)}</small>` : ''}</label>`;
}
function sel(label, bind, value, options) {
  return `<label class="fld">${t(label)}<select data-bind="${esc(bind)}" data-kind="select">
    ${options.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(t(l))}</option>`).join('')}</select></label>`;
}
function area(label, bind, value) {
  return `<label class="fld wide">${t(label)}<textarea data-bind="${esc(bind)}" data-kind="text" rows="2">${esc(value || '')}</textarea></label>`;
}

function renderData() {
  const c = S.cur, s = c.settings;
  $('#tabBody').innerHTML = `
  <section class="panel">
    <h2>${t('Дужник')}</h2>
    <div class="grid2">
      ${fld('Име дужника (за претрагу у архиви)', 'info.debtor', nameOf(c.info))}
      ${fld('Датум обрачуна', 'calcDate', c.calcDate, 'date')}
      ${area('Напомена (по жељи)', 'info.note', c.info.note)}
    </div>
    <p class="next"><a class="btn primary" href="#/case/${c.id}/principals">${t('Даље: главнице')}</a></p>
  </section>
  <details class="panel settings" ${S.settingsOpen || nonDefault(s) ? 'open' : ''}>
    <summary><span><b>${t('Правила и стопе')}</b><small>${esc(settingsSummary(s))}</small></span></summary>
    <h3>${t('Правила обрачуна')}</h3>
    <p class="small muted">${t('Сва правила се исписују у извјештају и Excel-у.')}</p>
    <div class="grid2">
      ${sel('Бројање дана', 'settings.dayRule', s.dayRule, Object.entries(RULES.dayRule))}
      ${sel('Дан уплате', 'settings.paymentDayRule', s.paymentDayRule, Object.entries(RULES.paymentDayRule))}
      ${sel('Урачунавање уплата', 'settings.allocation', s.allocation, Object.entries(RULES.allocation))}
      ${sel('Уплате без означене намјене', 'settings.unassignedRule', s.unassignedRule, Object.entries(RULES.unassignedRule))}
    </div>
    ${s.allocation === 'principalOnly'
      ? area('Основ за урачунавање само на главницу (обавезно: налог суда, уговор…)', 'settings.allocationBasis', s.allocationBasis)
      : area('Правни основ редосљеда трошкови → камата → главница (исписује се у извјештају)', 'settings.allocationBasisLegal', s.allocationBasisLegal)}
    ${s.allocation !== 'principalOnly' && /није провјерен/.test(s.allocationBasisLegal || '') ? `<p class="warn">${t('Правни основ још садржи напомену да број члана није провјерен. Допуните га прије употребе у налазу.')}</p>` : ''}
    <p class="small muted">${t('Третман дана уплате и правило за уплате без намјене су избор корисника — апликација их не представља као законом утврђене.')}</p>
    <h3>${t('Стопе')}</h3>
    ${sel('Начин одређивања стопе', 'settings.rateMode', s.rateMode, [['official', 'Законске стопе ЦБЦГ'], ['single', 'Једна сопствена стопа за цијели обрачун'], ['custom', 'Више сопствених стопа по периодима'], ['combined', 'ЦБЦГ + ручна стопа за изабране периоде']])}
    ${s.rateMode === 'official' ? `<p class="small">${t('Активна табела')}: ${esc(S.official.version)} (${isoToDMY(S.official.покривено_од)} – ${isoToDMY(S.official.покривено_до)}). <a href="#/rates">${t('Преглед и ажурирање стопа')}</a></p>` : ''}
    ${s.rateMode === 'single' ? `<div class="grid2">${fld('Годишња стопа (%)', 'settings.singleRate.стопа', s.singleRate.стопа, 'rate')}${fld('Основ / напомена', 'settings.singleRate.основ', s.singleRate.основ)}</div><p class="small muted">${t('Ручно унесена стопа означава се у извјештају као ручно унесена.')}</p>` : ''}
    ${['custom','combined'].includes(s.rateMode) ? customRatesEditor() : ''}
    ${s.rateMode === 'combined' ? `<p class="warn">${t('Ручна стопа замјењује ЦБЦГ само у унесеном периоду. Изван њега важе стопе ЦБЦГ. Ручни периоди су увијек јасно означени; 6% прије 2010. није аутоматски потврђена законска стопа.')}</p>` : ''}
  </details>
  <div class="btns case-actions">
    <button class="btn sm" data-act="export-case">${t('Извези (JSON)')}</button>
    <button class="btn sm" data-act="copy-case">${t('Копирај обрачун')}</button>
    <button class="btn sm danger" data-act="delete-case">${t('Обриши обрачун')}</button>
  </div>`;
  const d = $('details.settings');
  if (d) d.addEventListener('toggle', () => { S.settingsOpen = d.open; });
}
function nonDefault(s) {
  return s.dayRule !== 'excludeFirst' || s.paymentDayRule !== 'interestBeforePayment' || s.allocation !== 'costsInterestPrincipal'
    || s.unassignedRule !== 'none' || s.rateMode !== 'official';
}
function settingsSummary(s) {
  const rate = { official: 'законске стопе ЦБЦГ', single: 'једна сопствена стопа', custom: 'сопствене стопе по периодима', combined: 'ЦБЦГ + ручни периоди' }[s.rateMode];
  return t(`${rate}; ${s.dayRule === 'excludeFirst' ? 'први дан се не рачуна' : 'рачунају се оба дана'}; ${s.allocation === 'costsInterestPrincipal' ? 'уплате: трошкови → камата → главница' : 'уплате само на главницу'}`);
}
function customRatesEditor() {
  const rs = S.cur.settings.customRates;
  return `<div class="items">${rs.map((r, i) => `
    <div class="item">
      <div class="item-head"><strong>${t('Ручна стопа')} ${i + 1}</strong><span class="tag manual">${t('ручно унесено')}</span>
        <button class="btn sm danger" data-act="del-item" data-list="settings.customRates" data-id="${r.id}">✕</button></div>
      <div class="grid4">
        ${fld('Од', `settings.customRates.${r.id}.датум_од`, r.датум_од, 'date')}
        ${fld('До', `settings.customRates.${r.id}.датум_до`, r.датум_до, 'date')}
        ${fld('Стопа (%)', `settings.customRates.${r.id}.стопа`, r.стопа, 'rate')}
        ${fld('Основ / напомена', `settings.customRates.${r.id}.основ`, r.основ)}
      </div></div>`).join('')}</div>
    <button class="btn" data-act="add-custom-rate">＋ ${t('Додај период')}</button>
    <p class="small muted">${t('Сопствене стопе не мијењају званичну табелу. Стопа 6% за период прије 2010. може се унијети ручно, али остаје означена као ручно унесена док се не провјере пропис и период примјене.')}</p>`;
}

function renderPrincipals() {
  const c = S.cur;
  $('#tabBody').innerHTML = `
  <section class="panel">
    <div class="row-between"><h2>${t('Главнице')}</h2><button class="btn primary" data-act="add-principal">＋ ${t('Додај главницу')}</button></div>
    <p class="small muted">${t('Почетни датум је датум од кога се обрачунава камата (уз изабрано правило бројања дана). Доспијеће је само информативно и не помјера обрачун.')}</p>
    <details class="bulk no-print"><summary>${t('Унос више главница из Excel-а')}</summary><p class="small muted">${t('Копирајте колоне: износ, почетни датум (dd.mm.yyyy), опис. Без заглавља. Редови се прво провјеравају.')}</p><label class="fld">${t('Налијепите редове')}<textarea id="bulkText" rows="4" placeholder="1000,00&#9;01.01.2024&#9;Рачун 1"></textarea></label><button class="btn sm" data-act="bulk-preview">${t('Провјери редове')}</button><div id="bulkPreview"></div></details>
    <div class="items">${c.principals.map((p, i) => `
      <div class="item">
        <div class="item-head"><strong>${i + 1}. ${esc(p.label || t('Главница'))}</strong>
          <span>
          <button class="btn sm" data-act="dup-item" data-list="principals" data-id="${p.id}" title="${t('Копирај')}">⧉</button>
          <button class="btn sm danger" data-act="del-item" data-list="principals" data-id="${p.id}">✕</button></span></div>
        <div class="grid4">
          ${fld('Опис / ознака', `principals.${p.id}.label`, p.label)}
          ${fld('Износ (€)', `principals.${p.id}.amount`, p.amount, 'amount')}
          ${fld('Почетни датум обрачуна', `principals.${p.id}.start`, p.start, 'date')}
          ${fld('Доспијеће (информативно)', `principals.${p.id}.due`, p.due, 'date')}
        </div>
      </div>`).join('') || `<p class="empty">${t('Нема унесених главница.')}</p>`}
    </div>
    ${c.principals.length ? `<p class="next"><a class="btn" href="#/case/${c.id}/payments">${t('Уплате и трошкови')}</a> <a class="btn primary" href="#/case/${c.id}/calc">${t('Погледај обрачун')}</a></p>` : ''}
  </section>`;
}

function targetOptions(includeCase = true) {
  return [...S.cur.principals.map((p, i) => [p.id, `${i + 1}. ${p.label || 'Главница'}`]), ...(includeCase ? [[CASE_COSTS, 'Остали трошкови']] : [])];
}
function renderPayments() {
  const c = S.cur;
  const tgt = targetOptions();
  $('#tabBody').innerHTML = `
  <section class="panel">
    <div class="row-between"><h2>${t('Уплате')} <span class="muted small">(${t('нису обавезне')})</span></h2><button class="btn primary" data-act="add-payment">＋ ${t('Уплата')}</button></div>
    <p class="small muted">${t('Урачунавање')}: ${esc(t(RULES.allocation[c.settings.allocation]))}. ${t('Уплате без намјене')}: ${esc(t(RULES.unassignedRule[c.settings.unassignedRule]))}. ${esc(t(RULES.sameDayOrder))}</p>
    <div class="items">${c.payments.map((p, i) => `
      <div class="item">
        <div class="item-head"><strong>${t('Уплата')} ${i + 1}</strong>
          <span><button class="btn sm" data-act="dup-item" data-list="payments" data-id="${p.id}">⧉</button>
          <button class="btn sm danger" data-act="del-item" data-list="payments" data-id="${p.id}">✕</button></span></div>
        <div class="grid4">
          ${fld('Датум', `payments.${p.id}.date`, p.date, 'date')}
          ${fld('Износ (€)', `payments.${p.id}.amount`, p.amount, 'amount')}
          ${fld('Р. бр. истог дана', `payments.${p.id}.seq`, p.seq, 'int')}
          ${fld('Опис', `payments.${p.id}.desc`, p.desc)}
        </div>
        <div class="grid2">
          ${sel('Намјена', `payments.${p.id}.mode`, p.mode, [['unassigned', 'Без означене намјене (правило обрачуна)'], ['target', 'Једна обавеза'], ['split', 'Подијели на више обавеза']])}
          ${p.mode === 'target' ? sel('Обавеза', `payments.${p.id}.target`, p.target, tgt) : ''}
        </div>
        ${p.mode === 'split' ? `<div class="splits">${(p.splits || []).map(s => `
          <div class="grid3">${sel('Обавеза', `payments.${p.id}.splits.${s.id}.target`, s.target, tgt)}${fld('Износ (€)', `payments.${p.id}.splits.${s.id}.amount`, s.amount, 'amount')}
          <button class="btn sm danger self-end" data-act="del-split" data-pid="${p.id}" data-id="${s.id}">✕</button></div>`).join('')}
          <button class="btn sm" data-act="add-split" data-pid="${p.id}">＋ ${t('Дио уплате')}</button>
          ${splitCheck(p)}</div>` : ''}
        ${p.mode === 'unassigned' && c.settings.unassignedRule === 'none' ? `<p class="warn small">${t('Намјена није одређена, а у правилима обрачуна није изабрано правило за уплате без намјене — обрачун ће бити блокиран.')}</p>` : ''}
      </div>`).join('') || `<p class="empty">${t('Нема уплата — обрачунава се камата на пуну главницу.')}</p>`}
    </div>
  </section>
  <section class="panel">
    <div class="row-between"><h2>${t('Трошкови')} <span class="muted small">(${t('нису обавезни')})</span></h2><button class="btn" data-act="add-cost">＋ ${t('Трошак')}</button></div>
    <div class="items">${c.costs.map((x, i) => `
      <div class="item">
        <div class="item-head"><strong>${t('Трошак')} ${i + 1}</strong><button class="btn sm danger" data-act="del-item" data-list="costs" data-id="${x.id}">✕</button></div>
        <div class="grid4">
          ${fld('Датум', `costs.${x.id}.date`, x.date, 'date')}
          ${fld('Износ (€)', `costs.${x.id}.amount`, x.amount, 'amount')}
          ${sel('Веза', `costs.${x.id}.target`, x.target, tgt)}
          ${fld('Опис', `costs.${x.id}.desc`, x.desc)}
        </div></div>`).join('') || `<p class="empty">${t('Нема трошкова.')}</p>`}
    </div>
    <p class="small muted">${t('На трошкове се у овом обрачуну не обрачунава камата.')}</p>
    <p class="next"><a class="btn primary" href="#/case/${c.id}/calc">${t('Погледај обрачун')}</a></p>
  </section>`;
}
function splitCheck(p) {
  try {
    const tot = (p.splits || []).reduce((s, x) => s.add(Q.parse(x.amount || '0')), ZERO);
    if (!p.amount) return '';
    const d = Q.parse(p.amount).sub(tot);
    if (d.isZero()) return `<p class="ok small">${t('Расподјела је потпуна.')}</p>`;
    return `<p class="warn small">${t('Нераспоређено')}: ${money(d)} €</p>`;
  } catch { return ''; }
}

// ───────────────────────── Обрачун
function engineInput(c) {
  return {
    calcDate: c.calcDate,
    settings: c.settings,
    officialRates: S.official.rates,
    principals: c.principals.map(p => ({ id: p.id, label: p.label, amount: p.amount, start: p.start, due: p.due })),
    costs: c.costs.map(x => ({ id: x.id, date: x.date, amount: x.amount, desc: x.desc, target: x.target || CASE_COSTS })),
    payments: c.payments.map(p => ({
      id: p.id, date: p.date, amount: p.amount, desc: p.desc, seq: p.seq === '' || p.seq == null ? undefined : +p.seq,
      splits: p.mode === 'target' ? [{ target: p.target, amount: p.amount }] : p.mode === 'split' ? (p.splits || []).map(s => ({ target: s.target, amount: s.amount })) : null,
    })),
  };
}
function runCalc() {
  const c = S.cur;
  const invalid = Object.entries(c.invalid || {});
  if (invalid.length) {
    return { ok: false, errors: invalid.map(([k, v]) => ({ code: 'input', msg: `${t('Неисправан унос')}: „${v.raw}“ — ${v.msg}` })), warnings: [] };
  }
  const missingReq = [];
  c.principals.forEach((p, i) => { if (!p.amount || !p.start) missingReq.push(`${t('Главница')} ${i + 1}: ${t('недостаје износ или почетни датум')}`); });
  c.payments.forEach((p, i) => { if (!p.amount || !p.date) missingReq.push(`${t('Уплата')} ${i + 1}: ${t('недостаје износ или датум')}`); if (p.mode === 'target' && !p.target) missingReq.push(`${t('Уплата')} ${i + 1}: ${t('није изабрана обавеза')}`); });
  c.costs.forEach((x, i) => { if (!x.amount || !x.date) missingReq.push(`${t('Трошак')} ${i + 1}: ${t('недостаје износ или датум')}`); });
  if (c.settings.rateMode === 'single' && !c.settings.singleRate.стопа) missingReq.push(t('Није унесена сопствена стопа'));
  (['combined','custom'].includes(c.settings.rateMode) ? c.settings.customRates : []).forEach((r, i) => { if (!r.датум_од || !r.датум_до || r.стопа === '' || r.стопа == null) missingReq.push(`${t('Ручна стопа')} ${i + 1}: ${t('недостаје период или стопа')}`); });
  if (missingReq.length) return { ok: false, errors: missingReq.map(m => ({ code: 'req', msg: m })), warnings: [] };
  return calculate(engineInput(c));
}

function renderCalc() {
  const c = S.cur;
  const r = runCalc();
  S.result = r;
  const actions = `<div class="btns save-bar no-print">
      <button class="btn primary" data-act="save-snapshot">${t('Сачувај обрачун')}</button>
      <span class="small muted">${t('Excel и штампа праве се из сачуваног обрачуна, па се извјештај касније не мијења.')}</span></div>`;
  const warn = (r.warnings || []).length ? `<div class="warnings"><ul>${r.warnings.map(w => `<li>${esc(t(w.msg))}</li>`).join('')}</ul></div>` : '';
  $('#tabBody').innerHTML = r.ok
    ? `${warn}${reportHtml({ result: r, caseInfo: c.info, calcDate: c.calcDate, settings: r.settings, live: true }, actions)}`
    : `<section class="panel"><div class="errors"><h3>${t('Обрачун није могућ')}</h3><ul>${r.errors.map(e => `<li>${esc(t(e.msg))}</li>`).join('')}</ul></div>${warn}</section>`;
  $('#tabBody').insertAdjacentHTML('beforeend', `
  ${snapshotsListHtml()}`);
  loadSnapshotsList();
}

function reportHtml(snap, actions = '') {
  const r = snap.result, st = snap.settings, ci = snap.caseInfo || {};
  const obs = r.obligations.filter(o => o.kind === 'principal' || r.rows.some(x => x.oid === o.id));
  const label = (oid) => (r.obligations.find(o => o.id === oid) || {}).label || '';
  const statusBadge = r.working ? `<div class="stamp">${t('РАДНИ ОБРАЧУН — ручне или непотврђене стопе')}</div>` : '';
  return `
  <section class="panel report" id="report">
    ${statusBadge}
    ${snap.live ? `<h2 class="no-print">${t('Обрачун на дан')} ${isoToDMY(snap.calcDate)}</h2>` : ''}
    <div class="print-only">
      <h1>${t('Обрачун законске затезне камате')}</h1>
      <p>${t('Дужник')}: <b>${esc(nameOf(ci))}</b><br>${t('Датум обрачуна')}: ${isoToDMY(snap.calcDate)}${ci.note ? '<br>' + t('Напомена') + ': ' + esc(ci.note) : ''}</p>
    </div>
    <div class="cards summary">
      <div class="total">
        <span>${t('Преостали дуг на дан')} ${isoToDMY(snap.calcDate)}</span>
        <b>${money(r.totals.remainingDebt)} €</b>
        <small>${t('главница, неплаћена камата и трошкови')}</small>
      </div>
      <dl class="lines">
        ${card('Почетна главница', r.totals.initialPrincipal)}
        ${card('Обрачуната камата', r.totals.interestAccrued, true)}
        ${r.totals.costsTotal.sign() ? card('Трошкови', r.totals.costsTotal) : ''}
        ${r.totals.paymentsTotal.sign() ? card('Уплате', r.totals.paymentsTotal) : ''}
        ${card('Преостала главница', r.totals.remainingPrincipal)}
        ${card('Преостала неплаћена камата', r.totals.remainingInterest)}
        ${r.totals.costsTotal.sign() ? card('Преостали трошкови', r.totals.remainingCosts) : ''}
        ${r.totals.overpay.sign() ? card('Преплата (не преноси се)', r.totals.overpay) : ''}
      </dl>
    </div>
    ${r.totals.paymentsTotal.sign() ? `<p class="small muted paid">${t('Уплате урачунате на')}: ${t('трошкове')} ${money(r.totals.paidCosts)} € · ${t('камату')} ${money(r.totals.paidInterest)} € · ${t('главницу')} ${money(r.totals.paidPrincipal)} €</p>` : ''}
    ${actions}
    <h3>${t('Обавезе')}</h3>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>${t('Обавеза')}</th><th>${t('Износ')}</th><th>${t('Почетни датум')}</th><th>${t('Први обрачунати дан')}</th><th>${t('Посљедњи дан')}</th><th>${t('Доспијеће')}</th><th>${t('Камата')}</th></tr></thead>
      <tbody>${r.obligations.filter(o => o.kind === 'principal').map(o => `<tr><td>${esc(o.label)}</td><td class="n">${money(o.initial)}</td><td>${isoToDMY(o.start)}</td><td>${o.noInterestDays ? '—' : isoToDMY(o.firstDay)}</td><td>${o.noInterestDays ? '—' : isoToDMY(o.lastDay)}</td><td>${isoToDMY(o.due)}</td><td class="n">${money(o.accrued)}</td></tr>`).join('')}</tbody>
    </table></div>
    ${annualHtml(r)}
    <div class="row-between"><h3>${t('Обрачун по подпериодима')}</h3><small class="muted no-print">${t('Клик на ред открива формулу и извор.')}</small></div>
    <div class="tbl-wrap"><table class="tbl calc">
      <thead><tr><th>${t('Р.бр.')}</th><th>${t('Обавеза')}</th><th>${t('Ставка')}</th><th>${t('Од / датум')}</th><th>${t('До')}</th><th>${t('Дана')}</th><th>${t('Дјелилац')}</th><th>${t('Стопа %')}</th><th>${t('Основица')}</th><th>${t('Камата')}</th><th>${t('Трошак')}</th><th>${t('Уплата')}</th><th>${t('→ трошк.')}</th><th>${t('→ камата')}</th><th>${t('→ главн.')}</th><th>${t('Преост. главница')}</th><th>${t('Преост. камата')}</th><th>${t('Преост. трошк.')}</th></tr></thead>
      <tbody>${(() => { let n = 0; return obs.map(o => r.rows.filter(x => x.oid === o.id).map(x => `<tr class="${x.type}" data-act="inspect-row" data-seq="${x.seq}" tabindex="0" role="button" aria-label="${t('Објашњење реда')} ${x.seq}">
        <td>${++n}</td><td>${esc(label(x.oid))}</td>
        <td>${x.type === 'interest' ? t('Камата') + (x.rateKind === 'manual' ? ' <span class="tag manual">' + t('ручна') + '</span>' : x.rateStatus !== 'потврђено' ? ' <span class="tag unconf">' + t('непотврђ.') + '</span>' : '') : x.type === 'cost' ? t('Трошак') : t('Уплата')}</td>
        <td>${isoToDMY(x.from || x.date)}</td><td>${x.to ? isoToDMY(x.to) : ''}</td>
        <td class="n">${x.days ?? ''}</td><td class="n">${x.divisor ?? ''}</td><td class="n">${x.rateStr ? fmtRate(x.rateStr) : ''}</td>
        <td class="n">${x.base ? money(x.base) : ''}</td><td class="n">${x.interest ? money(x.interest) : ''}</td>
        <td class="n">${x.type === 'cost' ? money(x.amount) : ''}</td><td class="n">${x.type === 'payment' ? money(x.amount) : ''}</td>
        <td class="n">${x.toCosts ? money(x.toCosts) : ''}</td><td class="n">${x.toInterest ? money(x.toInterest) : ''}</td><td class="n">${x.toPrincipal ? money(x.toPrincipal) : ''}</td>
        <td class="n">${money(x.after.P)}</td><td class="n">${money(x.after.I)}</td><td class="n">${money(x.after.C)}</td></tr>`).join('')).join(''); })()}</tbody>
    </table></div>
    <h3>${t('Стопе')}</h3>
    <ul class="rates-used">${r.usedRates.map(u => `<li>${u.from ? isoToDMY(u.from) : '…'} – ${u.to ? isoToDMY(u.to) : '…'}: <b>${fmtRate(u.rateStr)}%</b> — ${u.kind === 'official' ? t('законска ЦБЦГ') : t('ручно унесена')}, <span class="tag ${u.status === 'потврђено' ? 'conf' : u.kind === 'manual' ? 'manual' : 'unconf'}">${esc(t(u.status))}</span> ${esc(u.basis)} ${u.src && u.src.извор_одлуке ? `<a href="${safeHref(u.src.извор_одлуке)}" target="_blank" rel="noopener">${t('извор')}</a>` : ''}</li>`).join('')}</ul>
    <details class="report-rules" open><summary>${t('Примијењена правила')}</summary>
    <ul class="rules">
      <li>${t('Формула')}: ${esc(t(RULES.formula))}</li>
      <li>${t('Бројање дана')}: ${esc(t(RULES.dayRule[st.dayRule]))}</li>
      <li>${t('Дан уплате')}: ${esc(t(RULES.paymentDayRule[st.paymentDayRule]))}</li>
      <li>${t('Урачунавање уплата')}: ${esc(t(RULES.allocation[st.allocation]))}${st.allocation === 'principalOnly' ? ' — ' + t('основ') + ': ' + esc(st.allocationBasis) : st.allocationBasisLegal ? ' — ' + esc(st.allocationBasisLegal) : ''}</li>
      <li>${t('Уплате без намјене')}: ${esc(t(RULES.unassignedRule[st.unassignedRule]))}</li>
      <li>${esc(t(RULES.sameDayOrder))}</li>
      <li>${t('Заокруживање')}: ${esc(t(RULES.rounding))}</li>
      <li>${t('Камата се не капитализује; на камату и трошкове се не обрачунава камата.')}</li>
      ${snap.live ? '' : `<li>${t('Сачуван обрачун, верзија')} ${snap.version}, ${new Date(snap.createdAt).toLocaleString('sr-Latn-ME')}; ${t('апликација')} ${esc(snap.appVersion)}, ${t('механизам')} ${esc(r.meta.engineVersion)}; ${t('табела стопа')} ${esc(snap.ratesMeta ? snap.ratesMeta.version : '—')}</li>`}
    </ul>
    </details>
    ${snap.checksum ? `<p class="fingerprint">SHA-256: ${esc(snap.checksum)}<br>${t('Контролни отисак садржаја; није електронски потпис.')}</p>` : ''}
    ${r.warnings && r.warnings.length ? `<h3>${t('Упозорења')}</h3><ul>${r.warnings.map(w => `<li>${esc(t(w.msg))}</li>`).join('')}</ul>` : ''}
  </section>`;
}
function card(label, q, strong) { return `<div class="line ${strong ? 'strong' : ''}"><dt>${t(label)}</dt><dd>${money(q)} €</dd></div>`; }

function snapshotsListHtml() { return `<section class="panel"><h2>${t('Сачувани обрачуни')}</h2><div id="snapList" class="muted small">…</div></section>`; }
async function loadSnapshotsList() {
  const list = (await store.byIndex('snapshots', 'caseId', S.cur.id)).sort((a, b) => b.version - a.version);
  const el = $('#snapList');
  if (!el) return;
  el.classList.remove('muted', 'small');
  el.innerHTML = list.length ? `<ul class="case-list">${list.map(s => `<li><a href="#/snap/${s.id}"><strong>${t('Верзија')} ${s.version}</strong>
    <span>${new Date(s.createdAt).toLocaleString('sr-Latn-ME')} · ${t('на дан')} ${isoToDMY(s.calcDate)}</span>
    <span class="muted small">${t('Камата')} ${money(Q.parse(s.result.totals.interestAccrued.$q))} € · ${t('преостали дуг')} ${money(Q.parse(s.result.totals.remainingDebt.$q))} €${s.result.working ? ' · ' + t('РАДНИ') : ''}</span></a></li>`).join('')}</ul>`
    : `<p class="empty">${t('Још нема сачуваних обрачуна.')}</p>`;
}

async function saveSnapshot() {
  const r = runCalc();
  if (!r.ok) { toast(t('Обрачун није могућ — погледајте грешке.'), 'err'); return; }
  const prev = await store.byIndex('snapshots', 'caseId', S.cur.id);
  const version = prev.reduce((m, s) => Math.max(m, s.version), 0) + 1;
  const snap = {
    id: uid('s'), caseId: S.cur.id, version, createdAt: Date.now(), appVersion: APP_VERSION,
    caseInfo: { ...S.cur.info }, calcDate: S.cur.calcDate, settings: JSON.parse(JSON.stringify(r.settings)),
    input: JSON.parse(JSON.stringify(S.cur)),
    ratesMeta: ['official','combined'].includes(S.cur.settings.rateMode) ? { назив: S.official.назив, version: S.official.version } : null,
    ratesTable: ['official','combined'].includes(S.cur.settings.rateMode) ? JSON.parse(JSON.stringify(S.official)) : null,
    result: toPlain(r),
  };
  snap.checksum = await snapshotHash(snap);
  await store.add('snapshots', snap);
  toast(t('Обрачун је сачуван као верзија') + ' ' + version);
  location.hash = '#/snap/' + snap.id;
}

async function renderSnapshot(id) {
  applyStaticTexts();
  const s = await store.get('snapshots', id);
  if (!s) { location.hash = '#/'; return; }
  if (await verifySnapshot(s) === 'invalid') { setMain(`<div class="errors">${t('Контролни отисак се не подудара. Извјештај је блокиран јер је садржај сачуване верзије промијењен.')}</div>`); return; }
  const snap = { ...s, result: fromPlain(s.result) };
  S.snap = snap;
  setTitle(nameOf(s.caseInfo) + ' · v' + s.version);
  setMain(`
  <section class="panel no-print">
    <div class="row-between"><h2>${t('Сачуван обрачун')} — ${t('верзија')} ${s.version}</h2>
      <a class="btn" href="#/case/${s.caseId}/calc">← ${t('Назад на обрачун')}</a></div>
    <p class="small muted">${t('Сачуван обрачун се не мијења ажурирањем стопа или апликације. За измјену промијените податке и сачувајте нову верзију — претходне остају.')}</p>
    <div class="btns">
      <button class="btn primary" data-act="xlsx">⬇ ${t('Excel (.xlsx)')}</button>
      <button class="btn" data-act="print">🖨 ${t('Штампа / PDF')}</button>
      <button class="btn danger" data-act="del-snap" data-id="${s.id}">${t('Обриши ову верзију')}</button>
    </div>
  </section>
  ${reportHtml(snap)}`);
}

async function exportXlsx() {
  const snap = S.snap;
  try {
    await loadScript('lib/exceljs.min.js');
    const { buildWorkbook } = await import('./xlsx-export.js');
    const wb = await buildWorkbook(window.ExcelJS, snap, getScript());
    const buf = await wb.xlsx.writeBuffer();
    const name = `Kamata_${(toLatin(nameOf(snap.caseInfo)) || 'obracun').replace(/[^\p{L}\p{N}]+/gu, '_')}_v${snap.version}.xlsx`;
    download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
  } catch (e) { console.error(e); toast(t('Извоз није успио') + ': ' + e.message, 'err'); }
}
function loadScript(src) {
  if (window.ExcelJS) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('lib')); document.head.appendChild(s); });
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

// ───────────────────────── Унос података
function resolveBind(bind) {
  // путања: info.number | calcDate | settings.x | settings.singleRate.стопа | principals.<id>.field | payments.<id>.splits.<sid>.field | settings.customRates.<id>.field
  const parts = bind.split('.');
  let obj = S.cur;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (Array.isArray(obj)) obj = obj.find(x => x.id === k);
    else obj = obj[k];
    if (!obj) return null;
  }
  return { obj, key: parts[parts.length - 1] };
}
async function onFieldChange(e) {
  const el = e.target;
  if (!el.dataset || !el.dataset.bind || !S.cur) return;
  const bind = el.dataset.bind, kind = el.dataset.kind;
  const ref = resolveBind(bind);
  if (!ref) return;
  const raw = el.value;
  let val = raw, bad = null;
  if (kind === 'amount') { if (raw.trim() === '') val = ''; else { const p = parseAmount(raw); p.ok ? (val = p.value) : (bad = p.error); } }
  else if (kind === 'rate') { if (raw.trim() === '') val = ''; else { const p = parseRate(raw); p.ok ? (val = p.value) : (bad = p.error); } }
  else if (kind === 'date') { if (raw.trim() === '') val = ''; else { const p = parseDMY(raw); p.ok ? (val = p.iso) : (bad = p.error); } }
  else if (kind === 'int') { if (raw.trim() === '') val = ''; else if (/^\d{1,4}$/.test(raw.trim())) val = String(+raw.trim()); else bad = 'Унесите цијели број'; }
  if (bad) { S.cur.invalid[bind] = { raw, msg: t(bad) }; }
  else { delete S.cur.invalid[bind]; ref.obj[ref.key] = val; }
  if (bind === 'calcDate' && val === '' && !bad) { S.cur.invalid[bind] = { raw, msg: t('Датум обрачуна је обавезан') }; }
  await saveCase();
  // освјежи приказ само кад се мијења структура (избори) или грешка
  if (bind === 'info.debtor') setTitle(nameOrEmpty(S.cur.info));
  const needs = kind === 'select' || bad || el.closest('.fld.bad') || bind.endsWith('.label');
  if (needs) {
    const y = window.scrollY; const keep = S.focusBind || (document.activeElement && document.activeElement.dataset && document.activeElement.dataset.bind);
    renderTab(); window.scrollTo(0, y);
    const f = keep && $(`[data-bind="${CSS.escape(keep)}"]`); if (f) f.focus();
  }
  S.focusBind = null;
}

async function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  const c = S.cur;
  const rerender = async () => { await saveCase(); const y = window.scrollY; renderTab(); window.scrollTo(0, y); };
  switch (act) {
    case 'theme': { const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = theme; await setSetting('theme', theme); break; }
    case 'demo': await createDemo(); break;
    case 'bulk-preview': bulkPreview(); break;
    case 'bulk-apply': await bulkApply(); break;
    case 'inspect-row': inspectRow(+b.dataset.seq); break;
    case 'close-dialog': $('#inspector').close(); break;
    case 'edit-rate': editRate(+b.dataset.index); break;
    case 'save-rate-edit': saveRateEdit(); break;
    case 'new-case': { const n = newCase(); S.cur = n; await saveCase(); S.tab = 'data'; S.focusDebtor = true; location.hash = '#/case/' + n.id + '/data'; break; }
    case 'add-principal': c.principals.push({ id: uid('p'), label: '', amount: '', start: '', due: '' }); await rerender(); focusLast(); break;
    case 'add-payment': c.payments.push({ id: uid('u'), date: '', amount: '', desc: '', seq: '', mode: c.principals.length === 1 ? 'target' : 'unassigned', target: c.principals[0]?.id || '', splits: [] }); await rerender(); focusLast(); break;
    case 'add-cost': c.costs.push({ id: uid('t'), date: '', amount: '', desc: '', target: CASE_COSTS }); await rerender(); break;
    case 'add-custom-rate': c.settings.customRates.push({ id: uid('r'), датум_од: '', датум_до: '', стопа: '', основ: '' }); await rerender(); break;
    case 'add-split': { const p = c.payments.find(x => x.id === b.dataset.pid); p.splits = p.splits || []; p.splits.push({ id: uid('d'), target: c.principals[0]?.id || CASE_COSTS, amount: '' }); await rerender(); break; }
    case 'del-split': { const p = c.payments.find(x => x.id === b.dataset.pid); p.splits = p.splits.filter(s => s.id !== b.dataset.id); clearInvalid(b.dataset.id); await rerender(); break; }
    case 'del-item': {
      const ref = resolveBind(b.dataset.list + '.x'); const arr = ref.obj;
      if (b.dataset.list === 'principals') {
        const used = c.payments.some(p => p.target === b.dataset.id || (p.splits || []).some(s => s.target === b.dataset.id)) || c.costs.some(x => x.target === b.dataset.id);
        if (used && !confirm(t('Ова главница се користи у уплатама или трошковима. Обрисати је? Те ставке ће морати бити поново распоређене.'))) return;
      }
      const i = arr.findIndex(x => x.id === b.dataset.id); if (i >= 0) arr.splice(i, 1);
      clearInvalid(b.dataset.id); await rerender(); break;
    }
    case 'dup-item': {
      const arr = resolveBind(b.dataset.list + '.x').obj;
      const i = arr.findIndex(x => x.id === b.dataset.id);
      const copy = JSON.parse(JSON.stringify(arr[i])); copy.id = uid(b.dataset.list[0]);
      if (copy.splits) copy.splits = copy.splits.map(s => ({ ...s, id: uid('d') }));
      if (copy.label) copy.label += ' ' + t('(копија)');
      arr.splice(i + 1, 0, copy); await rerender(); break;
    }
    case 'recalc': renderCalc(); break;
    case 'save-snapshot': await saveSnapshot(); break;
    case 'xlsx': await exportXlsx(); break;
    case 'print': window.print(); break;
    case 'del-snap': if (confirm(t('Трајно обрисати ову сачувану верзију обрачуна?'))) { const s = await store.get('snapshots', b.dataset.id); await autoBackup('прије брисања сачуване верзије'); await store.del('snapshots', b.dataset.id); location.hash = '#/case/' + s.caseId + '/calc'; } break;
    case 'export-case': await exportData({ caseIds: [c.id] }); break;
    case 'copy-case': {
      const n = JSON.parse(JSON.stringify(c)); n.id = uid('c'); n.createdAt = n.updatedAt = Date.now(); n.info.debtor = nameOf(n.info) + ' ' + t('(копија)');
      S.cur = n; await saveCase(); location.hash = '#/case/' + n.id + '/data'; toast(t('Обрачун је копиран (без сачуваних верзија).')); break;
    }
    case 'delete-case': {
      if (!confirm(t('Трајно обрисати обрачун за') + ` „${nameOrEmpty(c.info)}“ ` + t('и све његове сачуване верзије?'))) return;
      await autoBackup('прије брисања обрачуна');
      for (const s of await store.byIndex('snapshots', 'caseId', c.id)) await store.del('snapshots', s.id);
      await store.del('cases', c.id); S.cases = S.cases.filter(x => x.id !== c.id); S.cur = null; location.hash = '#/'; toast(t('Обрачун је обрисан.')); break;
    }
    case 'script': setScript(getScript() === 'cyr' ? 'lat' : 'cyr'); await setSetting('script', getScript()); route(); break;
    case 'toggle-install-counter': { const enabled = await getSetting('reportInstall',true); await setSetting('reportInstall',!enabled); if (enabled) await setSetting('installationPending',false); toast(t(!enabled ? 'Пријава инсталације је укључена.' : 'Пријава инсталације је искључена.')); await renderStats(); break; }
    case 'refresh-stats': await Promise.all([refreshStats(), refreshInstallStats()]); break;
    case 'check-rates': await checkRatesUpdate(); break;
    case 'apply-rates': await applyRatesUpdate(); break;
    case 'activate-rates': await activateRates(b.dataset.id); break;
    case 'try-cbcg': await tryCbcg(); break;
    case 'export-all': await exportData({}); break;
    case 'import-apply': await importApply(b.dataset.mode); break;
    case 'restore-backup': await restoreBackup(b.dataset.id); break;
    case 'sw-update': if (S.swReg && S.swReg.waiting) S.swReg.waiting.postMessage('skipWaiting'); break;
  }
}
function clearInvalid(id) { for (const k of Object.keys(S.cur.invalid)) if (k.includes('.' + id + '.')) delete S.cur.invalid[k]; }
function focusLast() { const items = $$('.item'); const last = items[items.length - 1]; if (last) { last.scrollIntoView({ behavior: 'smooth', block: 'center' }); const i = $('input', last); if (i) setTimeout(() => i.focus(), 300); } }

// ───────────────────────── Стопе
async function renderRates() {
  applyStaticTexts();
  setTitle(t('Стопе'));
  const versions = (await store.all('rates')).sort((a, b) => b.importedAt - a.importedAt);
  const j = S.official;
  setMain(`
  <section class="panel">
    <h1>${t('Законске стопе ЦБЦГ')}</h1>
    <p>${esc(t(j.назив || ''))} · ${t('верзија')} <b>${esc(j.version)}</b> · ${isoToDMY(j.покривено_од)} – ${isoToDMY(j.покривено_до)}</p>
    <p class="small muted">${t('Ознака „потврђено“ значи да је стопа провјерена према наведеном извору; не представља потврду исправности цијеле апликације. Стопа се не продужава аутоматски.')}</p>
    <div class="btns">
      <button class="btn primary" data-act="check-rates">↻ ${t('Провјери ажурирање стопа')}</button>
      <label class="btn">${t('Учитај rates.json из фајла')}<input type="file" accept=".json,application/json" id="ratesFile" hidden></label>
      <button class="btn" data-act="try-cbcg">${t('Пробај директан приступ ЦБЦГ')}</button>
    </div>
    <div id="ratesDiff"></div>
  </section>
  <section class="panel">
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>${t('Од')}</th><th>${t('До')}</th><th>${t('Стопа')}</th><th>${t('Статус')}</th><th>${t('Одлука')}</th><th>${t('Сл. лист')}</th><th>${t('Извор')}</th><th class="no-print">${t('Исправка')}</th></tr></thead>
      <tbody>${j.rates.map((r, index) => `<tr><td>${isoToDMY(r.датум_од)}</td><td>${isoToDMY(r.датум_до)}</td><td class="n"><b>${fmtRate(r.стопа)}%</b></td>
        <td><span class="tag ${r.статус === 'потврђено' ? 'conf' : 'unconf'}">${esc(t(r.статус))}</span></td><td>${esc(r.број_одлуке || '')} ${r.датум_одлуке ? t('од') + ' ' + isoToDMY(r.датум_одлуке) : ''}</td><td>${esc(r.службени_лист || '')}</td>
        <td>${r.извор_одлуке ? `<a href="${safeHref(r.извор_одлуке)}" target="_blank" rel="noopener">${t('одлука')}</a>` : ''}${r.напомена ? ` <span title="${esc(r.напомена)}">ⓘ</span>` : ''}</td><td class="no-print"><button class="btn sm" data-act="edit-rate" data-index="${index}">${t('Измијени')}</button></td></tr>`).join('')}</tbody>
    </table></div>
  </section>
  <section class="panel">
    <h2>${t('Сачуване верзије табеле')}</h2>
    <ul class="plain">${versions.map(v => `<li>${esc(v.version)} — ${esc(t(v.source))}, ${new Date(v.importedAt).toLocaleString('sr-Latn-ME')} ${v.id === S.officialId ? `<span class="tag conf">${t('активна')}</span>` : `<button class="btn sm" data-act="activate-rates" data-id="${esc(v.id)}">${t('Активирај')}</button>`}</li>`).join('')}</ul>
    <p class="small muted">${t('Претходне верзије се чувају. Сачувани обрачуни имају своју копију табеле и не мијењају се.')}</p>
  </section>`);
  $('#ratesFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const j2 = JSON.parse(await f.text()); showRatesDiff(j2, 'учитано из фајла ' + f.name); }
    catch (err) { toast(t('Фајл није исправан JSON'), 'err'); }
  });
}
async function checkRatesUpdate() {
  const box = $('#ratesDiff');
  box.innerHTML = `<p class="muted">${t('Провјеравам…')}</p>`;
  try {
    const res = await fetch('rates.json?check=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    showRatesDiff(await res.json(), 'ажурирање са адресе апликације');
  } catch (e) {
    box.innerHTML = `<p class="warn">${t('Провјера није успјела (нема интернета или адреса није доступна). Постојећа табела је непромијењена.')} <span class="small">${esc(e.message)}</span></p>`;
  }
}
function showRatesDiff(j, source) {
  const box = $('#ratesDiff');
  const v = validateRatesFile(j);
  if (!v.ok) { box.innerHTML = `<div class="errors"><h3>${t('Табела није прихваћена')}</h3><ul>${v.errors.map(e => `<li>${esc(t(e))}</li>`).join('')}</ul></div>`; return; }
  const d = diffRates(S.official, j);
  if (d.same && j.version === S.official.version) { box.innerHTML = `<p class="ok">${t('Табела је актуелна')} (${esc(j.version)}).</p>`; return; }
  const row = (r) => `${isoToDMY(r.датум_од)} – ${isoToDMY(r.датум_до)}: <b>${fmtRate(r.стопа)}%</b> <span class="tag ${r.статус === 'потврђено' ? 'conf' : 'unconf'}">${esc(t(r.статус))}</span> ${esc(r.број_одлуке || '')} ${r.извор_одлуке ? `<a href="${safeHref(r.извор_одлуке)}" target="_blank" rel="noopener">${t('изворна одлука')}</a>` : ''}`;
  S.pendingRates = { j, source };
  box.innerHTML = `<div class="diff">
    <h3>${t('Доступна верзија')} ${esc(j.version)} (${t('локална')} ${esc(S.official.version)})</h3>
    ${d.added.length ? `<h4>${t('Нови периоди')}</h4><ul>${d.added.map(r => `<li>${row(r)}</li>`).join('')}</ul>` : ''}
    ${d.changed.length ? `<h4>${t('Измијењено')}</h4><ul>${d.changed.map(x => `<li>${row(x.new)}<br><span class="small muted">${t('Раније')}: ${row(x.old)} — ${t('поља')}: ${x.fields.join(', ')}</span></li>`).join('')}</ul>` : ''}
    ${d.removed.length ? `<h4>${t('Уклоњено')}</h4><ul>${d.removed.map(r => `<li>${row(r)}</li>`).join('')}</ul>` : ''}
    ${j.rates.some(r => r.статус !== 'потврђено') ? `<p class="warn">${t('Табела садржи непотврђене стопе. Обрачуни са њима биће означени као радни.')}</p>` : ''}
    <p class="small muted">${t('Потврда преузимања није исто што и стручна провјера извора. Претходна верзија остаје сачувана.')}</p>
    <button class="btn primary" data-act="apply-rates">${t('Преузми и активирај ову верзију')}</button></div>`;
}
async function applyRatesUpdate() {
  if (!S.pendingRates) return;
  const { j, source } = S.pendingRates;
  if (!confirm(t('Преузети табелу верзије') + ' ' + j.version + '?')) return;
  const rec = { id: 'official:' + j.version + ':' + Date.now(), version: j.version, importedAt: Date.now(), source, data: j };
  await store.put('rates', rec); await setSetting('activeRates', rec.id);
  S.official = j; S.officialId = rec.id; S.pendingRates = null;
  toast(t('Табела стопа је ажурирана. Претходна верзија је сачувана.'));
  renderRates();
}
async function activateRates(id) {
  const rec = await store.get('rates', id); if (!rec) return;
  if (!confirm(t('Активирати верзију табеле') + ' ' + rec.version + '?')) return;
  await setSetting('activeRates', id); S.official = rec.data; S.officialId = id; renderRates();
}
async function tryCbcg() {
  const box = $('#ratesDiff');
  box.innerHTML = `<p class="muted">${t('Покушавам…')}</p>`;
  try {
    const res = await fetch('https://www.cbcg.me/me/kljucne-funkcije/finansijske-i-bankarske-operacije/stopa-zatezne-kamate', { mode: 'cors', cache: 'no-store' });
    const html = await res.text();
    box.innerHTML = `<p class="ok">${t('Директан приступ ЦБЦГ је успио')} (${html.length} B). ${t('Подаци се не преузимају аутоматски као потврђени — ажурирање иде преко провјерене табеле.')}</p>`;
  } catch (e) {
    box.innerHTML = `<p class="warn">${t('Прегледач не може директно да чита сајт ЦБЦГ (ограничење прегледача — CORS или нема интернета). Зато се нове стопе припремају у табели rates.json на адреси апликације (GitHub Actions + ручна провјера) и преузимају дугметом „Провјери ажурирање стопа“.')}</p>`;
  }
}

// ───────────────────────── Резервне копије
async function exportData({ caseIds }) {
  const cases = (await store.all('cases')).filter(c => !caseIds || caseIds.includes(c.id));
  const snaps = (await store.all('snapshots')).filter(s => !caseIds || caseIds.includes(s.caseId));
  const out = {
    format: 'zatezna-kamata-cg', schema_version: 1, appVersion: APP_VERSION, exportedAt: new Date().toISOString(),
    scope: caseIds ? 'обрачун' : 'све',
    cases, snapshots: snaps,
    rates: caseIds ? [] : await store.all('rates'),
    settings: caseIds ? [] : (await store.all('settings')),
  };
  const name = caseIds ? `obracun_${(toLatin(nameOf(cases[0]?.info)) || 'bez_imena').replace(/[^\p{L}\p{N}]+/gu, '_')}.json` : `zatezna_kamata_rezervna_kopija_${todayIso()}.json`;
  download(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }), name);
}
async function autoBackup(reason) {
  const data = { cases: await store.all('cases'), snapshots: await store.all('snapshots'), rates: await store.all('rates'), settings: await store.all('settings') };
  await store.put('backups', { id: uid('b'), createdAt: Date.now(), reason, data });
  const all = (await store.all('backups')).sort((a, b) => b.createdAt - a.createdAt);
  for (const old of all.slice(10)) await store.del('backups', old.id);
}
async function renderBackup() {
  applyStaticTexts();
  setTitle(t('Резервна копија'));
  const backups = (await store.all('backups')).sort((a, b) => b.createdAt - a.createdAt);
  setMain(`
  <section class="panel">
    <h1>${t('Резервна копија и пренос')}</h1>
    <p>${t('Телефон и рачунар имају одвојене податке. Пренос се ради извозом фајла на једном уређају и увозом на другом — нема аутоматске синхронизације.')}</p>
    <div class="btns"><button class="btn primary" data-act="export-all">⬇ ${t('Извези све (JSON)')}</button>
      <label class="btn">⬆ ${t('Увези фајл')}<input type="file" accept=".json,application/json" id="importFile" hidden></label></div>
    <div id="importBox"></div>
  </section>
  <section class="panel">
    <h2>${t('Аутоматске локалне копије')}</h2>
    <p class="small muted">${t('Праве се прије замјене података при увозу и прије брисања обрачуна (чува се 10 посљедњих).')}</p>
    <ul class="plain">${backups.map(b => `<li>${new Date(b.createdAt).toLocaleString('sr-Latn-ME')} — ${esc(t(b.reason))} (${b.data.cases.length} ${t('обрачуна')}) <button class="btn sm" data-act="restore-backup" data-id="${b.id}">${t('Врати')}</button></li>`).join('') || `<li class="muted">${t('Нема.')}</li>`}</ul>
  </section>`);
  $('#importFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    let j;
    try { j = JSON.parse(await f.text()); } catch { toast(t('Фајл није исправан JSON'), 'err'); return; }
    if (!j || j.format !== 'zatezna-kamata-cg' || j.schema_version !== 1 || !Array.isArray(j.cases)) { $('#importBox').innerHTML = `<p class="errors">${t('Фајл није резервна копија ове апликације или је непозната верзија.')}</p>`; return; }
    const validation = await validateBackup(j);
    for (const snap of validation.length ? [] : (j.snapshots || [])) { const existing = await store.get('snapshots', snap.id); if (existing && await snapshotHash(existing) !== await snapshotHash(snap)) validation.push('Исти ID сачуване верзије има различит садржај. Увоз је блокиран; оригинал је сачуван.'); }
    if (validation.length) { $('#importBox').innerHTML = `<div class="errors">${validation.map(x=>esc(t(x))).join('<br>')}</div>`; return; }
    const bad = j.cases.filter(c => !c.id || !c.info || !Array.isArray(c.principals) || !Array.isArray(c.payments) || !Array.isArray(c.costs) || !c.settings);
    if (bad.length) { $('#importBox').innerHTML = `<p class="errors">${t('Неисправна структура у')} ${bad.length} ${t('обрачуна — увоз је одбијен.')}</p>`; return; }
    const existing = await store.all('cases');
    const dupId = j.cases.filter(c => existing.some(x => x.id === c.id));
    const dupNum = j.cases.filter(c => !dupId.includes(c) && nameOf(c.info) && existing.some(x => latin(nameOf(x.info)) === latin(nameOf(c.info))));
    S.pendingImport = j;
    $('#importBox').innerHTML = `<div class="diff">
      <p>${t('Фајл')}: <b>${esc(f.name)}</b> · ${j.cases.length} ${t('обрачуна')}, ${(j.snapshots || []).length} ${t('сачуваних верзија')}, ${t('апликација')} ${esc(j.appVersion || '')}</p>
      ${dupId.length ? `<p class="warn">${t('Исти обрачуни већ постоје (исти ID)')}: ${dupId.map(c => esc(nameOf(c.info) || c.id)).join(', ')}</p>` : ''}
      ${dupNum.length ? `<p class="warn">${t('Постоје обрачуни за истог дужника, али са другим ID (увешће се као посебни)')}: ${dupNum.map(c => esc(nameOf(c.info))).join(', ')}</p>` : ''}
      <div class="btns">
        <button class="btn primary" data-act="import-apply" data-mode="merge">${t('Додај само нове (постојеће не дирај)')}</button>
        ${dupId.length ? `<button class="btn danger" data-act="import-apply" data-mode="replace">${t('Замијени постојеће истим ID')}</button>` : ''}
      </div>
      <p class="small muted">${t('Прије сваког увоза аутоматски се прави локална резервна копија.')}</p></div>`;
  });
}
async function importApply(mode) {
  const j = S.pendingImport; if (!j) return;
  if (mode === 'replace' && !confirm(t('Замијенити постојеће обрачуне подацима из фајла?'))) return;
  await autoBackup(mode === 'replace' ? 'прије замјене при увозу' : 'прије увоза');
  const existing = new Set((await store.all('cases')).map(c => c.id));
  let added = 0, replaced = 0, skipped = 0;
  const operations = [];
  for (const c of j.cases) {
    if (existing.has(c.id)) { if (mode === 'replace') { operations.push({store:'cases', value:c}); replaced++; } else skipped++; }
    else { operations.push({store:'cases', value:c}); added++; }
  }
  const exSnaps = new Set((await store.all('snapshots')).map(s => s.id));
  for (const s of j.snapshots || []) if (!exSnaps.has(s.id)) operations.push({store:'snapshots', action:'add', value:s}); // сачувани обрачуни се никад не преписују
  for (const r of j.rates || []) if (r && r.id && !(await store.get('rates', r.id))) operations.push({store:'rates', action:'add', value:r});
  for (const setting of j.settings || []) if (['script','theme','activeRates'].includes(setting.key) && !(await store.get('settings', setting.key))) operations.push({store:'settings',value:setting});
  if (operations.length) await store.batch(operations);
  S.cases = await store.all('cases'); S.pendingImport = null;
  toast(`${t('Увоз')}: ${added} ${t('нових')}, ${replaced} ${t('замијењених')}, ${skipped} ${t('прескочених')}`);
  renderBackup();
}
async function restoreBackup(id) {
  const b = await store.get('backups', id); if (!b) return;
  if (!confirm(t('Вратити стање из локалне копије? Тренутно стање се прво чува као нова копија.'))) return;
  await autoBackup('прије враћања копије');
  const operations = [];
  for (const st of ['cases', 'snapshots', 'rates', 'settings']) { operations.push({store:st, action:'clear'}); for (const x of b.data[st]) operations.push({store:st, value:x}); }
  await store.batch(operations);
  S.cases = await store.all('cases'); await loadOfficialRates(); toast(t('Стање је враћено.')); renderBackup();
}

// ───────────────────────── О апликацији
function renderAbout() {
  applyStaticTexts();
  setTitle(t('О апликацији'));
  setMain(`<section class="panel prose">
    <h1>${t('Затезна камата ЦГ')}</h1>
    <p>${t('Верзија апликације')} ${APP_VERSION}, ${t('обрачунски механизам')} ${ENGINE_VERSION}.</p>
    <p>${t('Обрачун законске затезне камате по простој (линеарној) методи, са законским стопама ЦБЦГ или ручно унесеним стопама, уплатама и трошковима.')}</p>
    <ul>
      <li>${t('Сви подаци остају на овом уређају (IndexedDB). Апликација нема налоге, аналитику посјета ни рекламе. Бројач преузимања чита јавну GitHub статистику. Пријава нове PWA инсталације шаље фиксни догађај GoatCounter-у; може се искључити у Преузимања.')}</li>
      <li>${t('Интернет је потребан само за инсталацију, ажурирања апликације и стопа и отварање изворних одлука.')}</li>
      <li>${t('Резултат је помоћно средство; вјештак је одговоран за провјеру улазних података, стопа и примијењених правила.')}</li>
    </ul>
    <h3>${t('Правни извори')}</h3><p><a href="https://wapi.gov.me/download-preview/aa9064ee-4c85-4ded-ab20-6b51d78c9514?version=1.0" target="_blank" rel="noopener">${t('ЗОО: чланови 319 и 320 — текст на gov.me')}</a>. ${t('Ово издање обухвата измјене до 22/17. Број и текст члана 320 су провјерени; примјењивост и касније измјене се провјеравају за конкретан однос.')}</p>
    <p>${t('Избори за дан уплате и расподјелу међу обавезама су изричита правила обрачуна. Код једнаких доспијећа, члан 319 захтијева и податке о обезбјеђењу, терету и настанку обавеза. За такав случај унесите намјену или ручну расподјелу.')}</p>
    <p><a href="Pregled_stopa_CBCG.html" target="_blank">${t('Преглед стопа ЦБЦГ (табела са изворима)')}</a></p>
  </section>`);
}

// ───────────────────────── Service worker / офлајн
function registerSW() {
  const chip = $('#offlineChip');
  if (!('serviceWorker' in navigator)) { chip.textContent = t('Офлајн рад није подржан у овом прегледачу'); chip.className = 'chip warn'; return; }
  navigator.serviceWorker.register('sw.js').then(reg => {
    S.swReg = reg;
    const showUpdate = () => { $('#updateBar').hidden = false; };
    if (reg.waiting && navigator.serviceWorker.controller) showUpdate();
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw && nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(); });
    });
    navigator.serviceWorker.ready.then(() => checkOfflineReady());
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch(() => { chip.textContent = t('Офлајн рад није укључен'); chip.className = 'chip warn'; });
  const hadController = !!navigator.serviceWorker.controller;
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { checkOfflineReady(); return; } // прва инсталација — без поновног учитавања
    if (refreshing) return; refreshing = true; location.reload();
  });
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'cached') checkOfflineReady(); });
  window.addEventListener('online', checkOfflineReady); window.addEventListener('offline', checkOfflineReady);
}
async function checkOfflineReady() {
  const chip = $('#offlineChip');
  try {
    const keys = await caches.keys();
    const ok = keys.some(k => k.startsWith('kamata-studio-')); 
    const ctrl = navigator.serviceWorker.controller?.scriptURL === new URL('sw.js', location.href).href;
    if (ok && ctrl) { chip.textContent = (navigator.onLine ? '' : t('Офлајн · ')) + t('Спремно за офлајн рад'); chip.className = 'chip ok'; }
    else { chip.textContent = t('Припрема за офлајн рад…'); chip.className = 'chip'; if (!ctrl) setTimeout(checkOfflineReady, 1500); }
  } catch { chip.textContent = ''; }
}

window.addEventListener('DOMContentLoaded', () => { init().catch(e => { console.error(e); document.body.insertAdjacentHTML('afterbegin', `<p class="errors">Грешка при покретању: ${esc(e.message)}</p>`); }); });

function dialog(html) {
  const el = $('#inspector');
  el.innerHTML = `<div class="dialog-head"><span class="eyebrow">${t('КАМАТА / СТУДИО')}</span><button class="btn sm" data-act="close-dialog" aria-label="${t('Затвори')}">✕</button></div>${html}`;
  el.showModal();
}
function inspectRow(seq) {
  const result = location.hash.startsWith('#/snap/') ? S.snap?.result : S.result;
  const row = result?.rows.find(x => x.seq === seq);
  if (!row) return;
  const label = result.obligations.find(o => o.id === row.oid)?.label || '';
  const exact = q => `<code>${esc(q.toRatString())}</code>`;
  const content = row.type === 'interest'
    ? `<span class="tag ${row.rateKind === 'manual' || row.rateStatus !== 'потврђено' ? 'unconf' : 'conf'}">${esc(t(row.rateStatus))}</span>
      <h2>${t('Како је добијена камата')}</h2><p>${esc(label)} · ${isoToDMY(row.from)} – ${isoToDMY(row.to)}</p>
      <div class="formula-box">${money(row.base)} × ${fmtRate(row.rateStr)} × ${row.days} / ${row.divisor}<strong>= ${money(row.interest)} €</strong></div>
      <dl class="audit-list"><dt>${t('Тачна основица (€)')}</dt><dd>${exact(row.base)}</dd><dt>${t('Тачна камата (€), прије заокруживања')}</dt><dd>${exact(row.interest)}</dd><dt>${t('Основ стопе')}</dt><dd>${esc(row.rateBasis || t('Није унесен'))}</dd></dl>
      <p class="small muted">${t('Разломак је тачна вриједност. Број у формули изнад је скраћен за приказ; обрачун користи цијели разломак.')}</p>`
    : `<h2>${t(row.type === 'payment' ? 'Распоред уплате' : 'Евидентирани трошак')}</h2><p>${esc(label)} · ${isoToDMY(row.date)} · ${esc(row.desc || '')}</p><div class="formula-box">${money(row.amount)} €</div>
      ${row.type === 'payment' ? `<dl class="lines">${card('На трошкове', row.toCosts)}${card('На камату', row.toInterest)}${card('На главницу', row.toPrincipal)}${card('Преплата', row.overpay)}</dl><p class="small">${esc(t(row.note))}</p>` : ''}`;
  const used = row.type === 'interest' ? result.usedRates.find(r => r.from <= row.from && r.to >= row.to && r.kind === row.rateKind) : null;
  dialog(`${content}${used?.src?.извор_одлуке ? `<a href="${safeHref(used.src.извор_одлуке)}" target="_blank" rel="noopener noreferrer">${t('Отвори изворну одлуку ЦБЦГ')} ↗</a>` : ''}<h3>${t('Стање послије овог реда')}</h3><dl class="lines">${card('Преостала главница', row.after.P)}${card('Преостала камата', row.after.I)}${card('Преостали трошкови', row.after.C)}</dl>`);
}
function annualHtml(r) {
  const years = new Map();
  for (const x of r.rows.filter(x => x.type === 'interest')) {
    const y = x.from.slice(0,4); years.set(y, (years.get(y) || ZERO).add(x.interest));
  }
  if (!years.size) return '';
  const maximum = [...years.values()].reduce((m,x)=>Q.max(m,x), ZERO);
  return `<details class="annual"><summary>${t('Камата по годинама')} <span class="muted small">${years.size}</span></summary><div class="year-rows">${[...years].sort().map(([y,q])=>`<div class="year-row"><b>${y}</b><span class="year-bar" aria-hidden="true"><i style="width:${maximum.sign() ? q.div(maximum).mul(100n).toFixed(2) : '0'}%"></i></span><strong>${money(q)} €</strong></div>`).join('')}</div><p class="small muted">${t('Збир је израчунат из незаокружених вриједности свих главница.')}</p></details>`;
}
function bulkPreview() {
  const p = parsePrincipalLines($('#bulkText').value);
  S.bulkRows = p.errors.length ? null : p.rows;
  $('#bulkPreview').innerHTML = p.errors.length ? `<div class="errors">${p.errors.map(x=>esc(t(x))).join('<br>')}</div>` : `<p class="ok">${p.rows.length} ${t('исправних редова')} · ${t('Укупна главница')}: ${money(p.rows.reduce((sum,x)=>sum.add(Q.parse(x.amount)),ZERO))} €</p><ul>${p.rows.map(x=>`<li>${money(Q.parse(x.amount))} € · ${isoToDMY(x.start)} · ${esc(x.label)}</li>`).join('')}</ul><button class="btn primary" data-act="bulk-apply">${t('Додај провјерене главнице')}</button>`;
}
async function bulkApply() {
  const fresh = parsePrincipalLines($('#bulkText').value);
  if (fresh.errors.length || JSON.stringify(fresh.rows) !== JSON.stringify(S.bulkRows)) {bulkPreview(); return;}
  S.cur.principals.push(...fresh.rows.map(p=>({...p,id:uid('p')})));
  S.bulkRows=null; await saveCase(); renderPrincipals(); toast(t('Главнице су додате.'));
}
async function createDemo() {
  const c = newCase(); c.info={debtor:t('Примјер · провјера обрачуна'),note:t('Илустративни примјер, није стварни предмет: 1.000 € за 2024, уплата 100 € на 30.06.2024. Стопе 12,50% и 12,25%.')};
  c.calcDate='2024-12-31';c.principals=[{id:uid('p'),label:t('Главница'),amount:'1000',start:'2023-12-31',due:'2023-12-31'}];
  c.payments=[{id:uid('u'),date:'2024-06-30',amount:'100',desc:t('Дјелимична уплата'),seq:'1',mode:'target',target:c.principals[0].id,splits:[]}];
  S.cur=c;await saveCase();location.hash='#/case/'+c.id+'/calc';
}
function editRate(index) {
  const r=S.official.rates[index]; S.editRateIndex=index;
  dialog(`<h2>${t('Исправка стопе')}</h2><p>${isoToDMY(r.датум_од)} – ${isoToDMY(r.датум_до)}</p><label class="fld">${t('Стопа (%)')}<input id="editRateValue" value="${esc(fmtRate(r.стопа))}" inputmode="decimal"></label><label class="fld">${t('Основ и разлог исправке')}<textarea id="editRateBasis">${esc(r.основ)}</textarea></label><p class="warn small">${t('Прави се нова локална верзија табеле. Исправљена ставка добија статус НЕПОТВРЂЕНО; сачувани обрачуни остају исти.')}</p><div id="rateEditError"></div><button class="btn primary" data-act="save-rate-edit">${t('Прикажи измјену')}</button>`);
}
function saveRateEdit() {
  const value = parseRate($('#editRateValue').value);const basis=$('#editRateBasis').value.trim();
  if (!value.ok || !basis) {$('#rateEditError').textContent=t(value.error || 'Унесите основ исправке.');return;}
  const data=structuredClone(S.official);const r=data.rates[S.editRateIndex];
  r.стопа=value.value;r.основ=basis;r.статус='непотврђено';r.провјерено_дана='';r.напомена='Локална ручна исправка; изворна одлука остаје доступна ради поређења.';
  data.version=`${todayIso()}.local.${Date.now()}`;$('#inspector').close();showRatesDiff(data,'ручна исправка у апликацији');$('#ratesDiff').scrollIntoView({block:'center'});
}

async function renderStats() {
  applyStaticTexts(); setTitle(t('Преузимања'));
  const reportInstall = await getSetting('reportInstall',true);
  setMain(`<section class="panel prose"><span class="eyebrow">${t('ДИСТРИБУЦИЈА АПЛИКАЦИЈЕ')}</span><h1>${t('Преузимања')}</h1><p>${t('Јавни подаци GitHub-а за APK издања Камата Студио. Провјера не шаље имена, обрачуне или податке о вашем уређају из апликације.')}</p><button class="btn primary" data-act="refresh-stats">↻ ${t('Освјежи бројач')}</button><div id="downloadStats"><p>${t('Провјеравам…')}</p></div></section><section class="panel prose"><h2>${t('Шта овај број значи')}</h2><p>${t('Бројач сабира преузимања APK датотека из GitHub Releases. Поновљено преузимање се рачуна поново. Датотеке подијељене преко Vibera, имејла или других сајтова нијесу обухваћене.')}</p><p><b>${t('PWA: само пријављене нове инсталације.')}</b> ${t('Инсталације из Chrome-а, Edge-а и Safari-ја нијесу APK преузимања. Не постоји потпуна историјска евиденција; број преузимања није број људи нити доказ инсталације.')}</p><div id="installStats" class="warn">${t('Провјера пријављених инсталација…')}</div><p class="small">${t('При инсталацији се постојећем GoatCounter сервису шаље само фиксни назив догађаја. Не шаљу се обрачуни, имена, износи, адреса извјештаја или величина екрана. Сервис обрађује мрежне податке захтјева (IP/прегледач). Неки прегледачи и блокатори не пријављују инсталацију; ово није потпун број корисника.')}</p><button class="btn sm" data-act="toggle-install-counter">${t(reportInstall ? 'Искључи пријаву инсталације на овом уређају' : 'Укључи пријаву инсталације на овом уређају')}</button><p><a href="${INSTALL_SITE}" target="_blank" rel="noopener noreferrer">${t('Отвори статистику власника')} ↗</a></p></section>`);
  await Promise.all([refreshStats(), refreshInstallStats()]);
}
async function refreshStats() {
  const box=$('#downloadStats'); if (!box) return;
  box.innerHTML=`<p class="muted">${t('Провјеравам…')}</p>`;
  try {
    const config=await (await fetch('counter-config.json')).json();
    const data=await getDownloadStats(config); await setSetting('lastDownloadStats',data); showStats(data,false);
  } catch(error) {
    const old=await getSetting('lastDownloadStats',null);
    if (old) showStats(old,true);
    else box.innerHTML=`<p class="warn">${t('Број тренутно није доступан.')} ${esc(error.message)}</p>`;
  }
}
function showStats(data, cached) {
  const box=$('#downloadStats'); if (!box) return;
  box.innerHTML=`<div class="metrics" style="margin-top:24px"><div><span>${t('APK преузимања са GitHub-а')}</span><strong>${data.total}</strong><small>${t('Укупно за објављене датотеке')}</small></div><div><span>${t('Објављених APK датотека')}</span><strong>${data.assets.length}</strong><small>${t('Камата Студио')}</small></div></div><p class="small ${cached?'warn':'muted'}">${t(cached?'Посљедњи сачувани подаци (нијесу ажурирани):':'Провјерено:')} ${esc(new Date(data.checkedAt).toLocaleString('sr-Latn-ME'))}</p>${data.assets.length?`<ul class="plain">${data.assets.map(a=>`<li>${esc(a.name)} · ${esc(a.tag)} — <b>${a.count}</b> ${t('преузимања')}</li>`).join('')}</ul>`:`<p class="small muted">${t('Још нема објављених APK датотека за ову верзију апликације.')}</p>`}`;
}

async function refreshInstallStats() {
  const box=$('#installStats');if(!box)return;
  try { const count=await getReportedInstallations();box.className='ok';box.textContent=t('Пријављене PWA инсталације од 02.11.2026: ')+count; }
  catch(error){box.className='warn';box.textContent=t(error.message);}
}
