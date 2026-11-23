// データ操作の窓口。画面はここだけを使う。
// 変更 → メモリ＋IndexedDB に保存 → 未送信キューに積む → 同期エンジンが GAS へ送る
import { recKey, buildView } from '../model/records.js';
import { toIso } from '../core/dates.js';
import { randomId } from '../core/tasks.js';

export function nowStamp(date) {
  const d = date || new Date();
  const iso = toIso(d);
  const ms = String(d.getTime() % 1000).padStart(3, '0');
  return iso.replace('+09:00', '.' + ms + '+09:00');
}

export class Store {
  constructor(db, defaults) {
    this.db = db;
    this.defaults = defaults;
    this.records = new Map();
    this.outbox = new Map();
    this.meta = {};
    this.listeners = new Set();
    this._view = null;
  }

  async load() {
    for (const r of await this.db.getAll('records')) this.records.set(r.key, r);
    for (const r of await this.db.getAll('outbox')) this.outbox.set(r.key, r);
    this.meta.deviceId = (await this.db.getMeta('deviceId')) || null;
    if (!this.meta.deviceId) { this.meta.deviceId = 'd-' + randomId(8); await this.db.setMeta('deviceId', this.meta.deviceId); }
    for (const k of ['rev', 'connection', 'lastSyncAt', 'lastDayStart', 'planUpdates', 'seeded', 'syncError', 'appliedActions']) {
      this.meta[k] = await this.db.getMeta(k);
    }
    this._view = null;
  }

  async setMeta(k, v) { this.meta[k] = v; await this.db.setMeta(k, v); this.emit(); }

  get view() {
    if (!this._view) this._view = buildView(Array.from(this.records.values()), this.defaults);
    return this._view;
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this._view = null; for (const fn of this.listeners) fn(); }

  get(kind, id) {
    const r = this.records.get(recKey(kind, id));
    return r && !r.deleted ? r : null;
  }

  // 変更（複数まとめて）。items: [{kind, id, data, deleted?, updatedAt?}]
  async putMany(items, opts) {
    const stamp = nowStamp();
    const recs = [];
    for (const it of items) {
      const rec = { key: recKey(it.kind, it.id), kind: it.kind, id: String(it.id), data: it.data || {}, deleted: !!it.deleted, updatedAt: it.updatedAt || stamp };
      this.records.set(rec.key, rec);
      recs.push(rec);
      if (!(opts && opts.localOnly)) this.outbox.set(rec.key, rec);
    }
    await this.db.putMany('records', recs);
    if (!(opts && opts.localOnly)) await this.db.putMany('outbox', recs);
    this.emit();
    if (this.onChange) this.onChange();
  }

  put(kind, id, data) { return this.putMany([{ kind, id, data }]); }
  remove(kind, id) { const r = this.records.get(recKey(kind, id)); return this.putMany([{ kind, id, data: r ? r.data : {}, deleted: true }]); }

  // タスクの一部を変更
  async patchTask(id, patch) {
    const r = this.get('task', id);
    if (!r) return;
    await this.put('task', id, Object.assign({}, r.data, patch));
  }

  async patchDay(dk, patch) {
    const r = this.get('day', dk);
    await this.put('day', dk, Object.assign({}, r ? r.data : {}, patch));
  }

  async setConfig(id, value) { await this.put('cfg', id, { value: value }); }

  // GAS から受け取ったレコードを反映（まだ送っていない、より新しい変更があれば手元を優先）
  async applyRemote(records) {
    const recs = [];
    for (const r of records) {
      const key = recKey(r.kind, r.id);
      const pending = this.outbox.get(key);
      if (pending && pending.updatedAt > (r.updatedAt || '')) continue;
      const rec = { key, kind: r.kind, id: String(r.id), data: r.data || {}, deleted: !!r.deleted, updatedAt: r.updatedAt || '' };
      this.records.set(key, rec);
      recs.push(rec);
    }
    await this.db.putMany('records', recs);
    if (recs.length) this.emit();
  }

  async ackOutbox(sent) {
    const done = [];
    for (const s of sent) {
      const cur = this.outbox.get(s.key);
      if (cur && cur.updatedAt === s.updatedAt) { this.outbox.delete(s.key); done.push(s.key); }
    }
    await this.db.deleteMany('outbox', done);
  }

  async queuePlanUpdates(list) {
    if (!list.length) return;
    const cur = this.meta.planUpdates || [];
    const merged = cur.filter((u) => !list.some((n) => n.title === u.title && (n.start || '') === (u.start || ''))).concat(list);
    await this.setMeta('planUpdates', merged);
  }

  async resetAll() {
    await this.db.clear();
    this.records.clear(); this.outbox.clear(); this.meta = {};
    await this.load();
    this.emit();
  }
}
