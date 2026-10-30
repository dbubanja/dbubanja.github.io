// Календарски датуми као цијели бројеви дана — без временске зоне и љетњег рачунања времена.

export function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
export function daysInMonth(y, m) { return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; }

// Број дана од 1970-01-01 (алгоритам days_from_civil, H. Hinnant).
export function toDay(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromDay(z) {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  let y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  if (m <= 2) y += 1;
  return { y, m, d };
}

export function validYMD(y, m, d) {
  return Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d) &&
    y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

// ISO "YYYY-MM-DD" → дан; null ако није исправан.
export function isoToDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  return validYMD(y, mo, d) ? toDay(y, mo, d) : null;
}

export function dayToIso(z) {
  const { y, m, d } = fromDay(z);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function dayToDMY(z) {
  const { y, m, d } = fromDay(z);
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
}

// Строги унос dd.mm.yyyy (дозвољена и завршна тачка); одбија 31.02. итд.
export function parseDMY(s) {
  const t = String(s || '').trim().replace(/\.$/, '');
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (!m) return { ok: false, error: 'Датум мора бити у облику dd.mm.yyyy' };
  const d = +m[1], mo = +m[2], y = +m[3];
  if (!validYMD(y, mo, d)) return { ok: false, error: `Датум ${t} не постоји` };
  return { ok: true, day: toDay(y, mo, d), iso: dayToIso(toDay(y, mo, d)) };
}

export function isoToDMY(s) { const z = isoToDay(s); return z === null ? '' : dayToDMY(z); }

export function yearOf(z) { return fromDay(z).y; }
export function yearEnd(z) { return toDay(yearOf(z), 12, 31); }

// Данашњи локални календарски датум уређаја.
export function todayIso() {
  const t = new Date();
  return dayToIso(toDay(t.getFullYear(), t.getMonth() + 1, t.getDate()));
}
