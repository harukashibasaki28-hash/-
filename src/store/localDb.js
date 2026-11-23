// IndexedDB（端末内の控え）。records = すべてのデータ、outbox = まだ送っていない変更、meta = 端末ごとの情報
const DB_NAME = 'techo';
const VERSION = 1;

function req(r) {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

export async function openLocalDb() {
  if (typeof indexedDB === 'undefined') return memoryDb();
  try {
    const open = indexedDB.open(DB_NAME, VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    const db = await req(open);
    return idbWrapper(db);
  } catch (e) {
    console.warn('IndexedDB が使えないため、メモリだけで動きます', e);
    return memoryDb();
  }
}

function idbWrapper(db) {
  const tx = (store, mode) => db.transaction(store, mode).objectStore(store);
  return {
    kind: 'indexeddb',
    getAll: (store) => req(tx(store, 'readonly').getAll()),
    async putMany(store, items) {
      if (!items.length) return;
      const t = db.transaction(store, 'readwrite');
      const os = t.objectStore(store);
      for (const it of items) os.put(it);
      await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
    },
    async deleteMany(store, keys) {
      if (!keys.length) return;
      const t = db.transaction(store, 'readwrite');
      const os = t.objectStore(store);
      for (const k of keys) os.delete(k);
      await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
    },
    getMeta: (k) => req(tx('meta', 'readonly').get(k)),
    setMeta: (k, v) => req(tx('meta', 'readwrite').put(v, k)),
    clear: async () => { for (const s of ['records', 'outbox', 'meta']) await req(tx(s, 'readwrite').clear()); },
  };
}

export function memoryDb() {
  const s = { records: new Map(), outbox: new Map(), meta: new Map() };
  return {
    kind: 'memory',
    getAll: async (store) => Array.from(s[store].values()),
    putMany: async (store, items) => { for (const it of items) s[store].set(it.key, it); },
    deleteMany: async (store, keys) => { for (const k of keys) s[store].delete(k); },
    getMeta: async (k) => s.meta.get(k),
    setMeta: async (k, v) => { s.meta.set(k, v); },
    clear: async () => { s.records.clear(); s.outbox.clear(); s.meta.clear(); },
  };
}
