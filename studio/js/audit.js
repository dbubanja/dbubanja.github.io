// A checksum detects changed content; it is not a digital signature or proof of authorship.
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}
export async function snapshotHash(snapshot) {
  const { checksum, ...payload } = snapshot;
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(payload)));
  return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
}
export async function verifySnapshot(snapshot) {
  return !snapshot.checksum ? 'legacy' : (await snapshotHash(snapshot)) === snapshot.checksum ? 'valid' : 'invalid';
}
