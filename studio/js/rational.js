// Тачна рационална аритметика (BigInt бројилац / BigInt именилац).
// Користи се за сваки новчани прорачун; JavaScript Number се не користи за износе.

function gcd(a, b) {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

export class Q {
  constructor(n, d = 1n) {
    if (typeof n !== 'bigint' || typeof d !== 'bigint') throw new TypeError('Q очекује BigInt');
    if (d === 0n) throw new RangeError('Дијељење нулом');
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n, d) || 1n;
    this.n = n / g;
    this.d = d / g;
    Object.freeze(this);
  }
  static of(x) {
    if (x instanceof Q) return x;
    if (typeof x === 'bigint') return new Q(x);
    if (typeof x === 'number') {
      if (!Number.isInteger(x)) throw new TypeError('Децимални Number није дозвољен; користити текст');
      return new Q(BigInt(x));
    }
    if (typeof x === 'string') return Q.parse(x);
    throw new TypeError('Неподржан тип: ' + typeof x);
  }
  // Парсира нормализовани децимални текст: "-1234.5678" (тачка као децимални знак).
  static parse(s) {
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(s).trim());
    if (!m) {
      const f = /^(-?\d+)\/(\d+)$/.exec(String(s).trim());
      if (f) return new Q(BigInt(f[1]), BigInt(f[2]));
      throw new RangeError('Неисправан децимални запис: ' + s);
    }
    const frac = m[3] || '';
    const n = BigInt(m[2] + frac) * (m[1] === '-' ? -1n : 1n);
    return new Q(n, 10n ** BigInt(frac.length));
  }
  add(o) { o = Q.of(o); return new Q(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { o = Q.of(o); return new Q(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { o = Q.of(o); return new Q(this.n * o.n, this.d * o.d); }
  div(o) { o = Q.of(o); return new Q(this.n * o.d, this.d * o.n); }
  cmp(o) { o = Q.of(o); const a = this.n * o.d, b = o.n * this.d; return a < b ? -1 : a > b ? 1 : 0; }
  isZero() { return this.n === 0n; }
  sign() { return this.n < 0n ? -1 : this.n > 0n ? 1 : 0; }
  static min(a, b) { return a.cmp(b) <= 0 ? a : b; }
  static max(a, b) { return a.cmp(b) >= 0 ? a : b; }
  // Заокруживање на `dec` децимала, половина се заокружује од нуле (0,005 → 0,01).
  toFixed(dec = 2) {
    const scale = 10n ** BigInt(dec);
    const neg = this.n < 0n;
    const absN = neg ? -this.n : this.n;
    const scaled = absN * scale;
    let q = scaled / this.d;
    const r = scaled % this.d;
    if (r * 2n >= this.d) q += 1n;
    let s = q.toString().padStart(dec + 1, '0');
    const out = dec ? s.slice(0, -dec) + '.' + s.slice(-dec) : s;
    return (neg && q !== 0n ? '-' : '') + out;
  }
  // Тачан запис за чување и поређење ("n/d").
  toRatString() { return this.d === 1n ? this.n.toString() : `${this.n}/${this.d}`; }
  // Само за приказ/Excel вриједности ћелија (не користи се у прорачуну).
  toNumber() { return Number(this.toFixed(16)); }
}

export const ZERO = new Q(0n);
