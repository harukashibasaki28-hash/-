// 同期エンジン：未送信キューを GAS に送り、他の端末の変更を受け取る
// 送るタイミング：変更の 2 秒後・アプリを開いたとき・オンラインに戻ったとき・開いている間は 5 分ごと

const CHUNK = 300;

export class SyncEngine {
  constructor(store, opts) {
    this.store = store;
    this.fetchImpl = (opts && opts.fetch) || ((...a) => fetch(...a));
    this.running = null;
    this.timer = null;
    this.status = { state: 'idle', error: null };
  }

  get connection() { return this.store.meta.connection || null; }
  get configured() { const c = this.connection; return !!(c && c.url && c.key); }

  schedule(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync(), ms == null ? 2000 : ms);
  }

  async call(body) {
    const c = this.connection;
    const res = await this.fetchImpl(c.url, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ key: c.key, device: this.store.meta.deviceId }, body)),
    });
    if (!res.ok) throw new Error('通信エラー（' + res.status + '）');
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch (e) { throw new Error('GAS の応答を読めません。URL が「ウェブアプリ」の URL か確認してください'); }
    if (!json.ok) throw new Error(json.error === 'unauthorized' ? 'キーが違います（設定を確認してください）' : json.error || '不明なエラー');
    return json;
  }

  // opts: { prepare: 'YYYY-MM-DD' }
  sync(opts) {
    if (!this.configured) return Promise.resolve({ skipped: true });
    if (this.running) { this.again = Object.assign(this.again || {}, opts || {}); return this.running; }
    this.running = this._sync(opts || {}).finally(() => {
      this.running = null;
      if (this.again) { const a = this.again; this.again = null; this.sync(a); }
    });
    return this.running;
  }

  async _sync(opts) {
    const st = this.store;
    this.setStatus('syncing', null);
    try {
      let first = true;
      while (true) {
        const sent = Array.from(st.outbox.values()).slice(0, CHUNK);
        const body = { action: 'sync', since: st.meta.rev || 0, changes: sent.map((r) => ({ kind: r.kind, id: r.id, data: r.data, updatedAt: r.updatedAt, deleted: r.deleted })) };
        if (first && opts.prepare) body.prepare = opts.prepare;
        const pu = st.meta.planUpdates || [];
        if (first && pu.length) body.planUpdates = pu;
        const res = await this.call(body);
        await st.ackOutbox(sent);
        await st.applyRemote(res.records || []);
        await st.setMeta('rev', res.rev);
        if (first && pu.length) {
          const left = (st.meta.planUpdates || []).filter((u) => pu.indexOf(u) < 0 && !pu.some((p) => p.title === u.title && p.progress === u.progress));
          await st.setMeta('planUpdates', left);
        }
        first = false;
        if (st.outbox.size === 0 || sent.length === 0) break;
      }
      await st.setMeta('lastSyncAt', new Date().toISOString());
      await st.setMeta('syncError', null);
      this.setStatus('ok', null);
      return { ok: true };
    } catch (e) {
      await st.setMeta('syncError', e.message);
      this.setStatus(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error', e.message);
      return { ok: false, error: e.message };
    }
  }

  setStatus(state, error) {
    this.status = { state, error };
    if (this.onStatus) this.onStatus(this.status);
  }

  async calendar(date, tasks, remove) {
    return this.call({ action: 'calendar', date, tasks, remove: remove || [] });
  }

  async ping() { return this.call({ action: 'ping' }); }
}
