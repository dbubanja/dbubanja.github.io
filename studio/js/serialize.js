// Чување резултата са тачним рационалним бројевима (Q → {"$q":"n/d"}).
import { Q } from './rational.js';

export function toPlain(value) {
  return JSON.parse(JSON.stringify(value, (k, v) => (v instanceof Q ? { $q: v.toRatString() } : v)));
}
export function fromPlain(value) {
  return JSON.parse(JSON.stringify(value), (k, v) => (v && typeof v === 'object' && typeof v.$q === 'string' && Object.keys(v).length === 1 ? Q.parse(v.$q) : v));
}
