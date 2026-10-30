// Локално складиште (IndexedDB). Ништа се не шаље на сервер.
const DB_NAME = 'zatezna-kamata-cg';
const DB_VER = 1;
export const STORES = ['cases', 'snapshots', 'rates', 'settings', 'backups'];

let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('cases')) d.createObjectStore('cases', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('snapshots')) { const s = d.createObjectStore('snapshots', { keyPath: 'id' }); s.createIndex('caseId', 'caseId'); }
      if (!d.objectStoreNames.contains('rates')) d.createObjectStore('rates', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('backups')) d.createObjectStore('backups', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
function tx(store, mode, fn) {
  return db().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then(v => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const store = {
  get: (st, key) => tx(st, 'readonly', s => reqP(s.get(key))),
  all: (st) => tx(st, 'readonly', s => reqP(s.getAll())),
  put: (st, val) => tx(st, 'readwrite', s => reqP(s.put(val))),
  del: (st, key) => tx(st, 'readwrite', s => reqP(s.delete(key))),
  clear: (st) => tx(st, 'readwrite', s => reqP(s.clear())),
  byIndex: (st, idx, key) => tx(st, 'readonly', s => reqP(s.index(idx).getAll(key))),
};

export async function getSetting(key, dflt) { const r = await store.get('settings', key); return r ? r.value : dflt; }
export async function setSetting(key, value) { return store.put('settings', { key, value }); }

export function uid(prefix = '') {
  const a = new Uint8Array(8); crypto.getRandomValues(a);
  return prefix + Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}

// Тражи трајно складиште да прегледач не обрише податке при мањку простора.
export async function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch { /* */ }
  return false;
}
