// 起動と画面の切り替え
import { openLocalDb } from './store/localDb.js';
import { Store } from './store/store.js';
import { SyncEngine } from './store/sync.js';
import * as A from './actions.js';
import { formData, esc } from './ui/util.js';
import { notify } from './notify/notifier.js';
import { minOfDay, hmToMin, parseIso, atTime, formatMd } from './core/dates.js';
import { overdueTimers } from './core/timer.js';
import { minAchievement } from './core/stats.js';
import * as today from './ui/today.js';
import * as timeline from './ui/timeline.js';
import * as review from './ui/review.js';
import * as study from './ui/study.js';
import * as hourensou from './ui/hourensou.js';
import * as log from './ui/log.js';
import * as settings from './ui/settings.js';

const TABS = [
  { id: 'today', label: '今日', icon: '☀️', view: today },
  { id: 'timeline', label: '予定', icon: '🗓', view: timeline },
  { id: 'review', label: '振り返り', icon: '📈', view: review },
  { id: 'study', label: '学習', icon: '📚', view: study },
  { id: 'hourensou', label: '報連相', icon: '🗣', view: hourensou },
  { id: 'log', label: 'ログ', icon: '📋', view: log },
  { id: 'settings', label: '設定', icon: '⚙️', view: settings },
];
const ACTS = Object.assign({}, ...TABS.map((t) => t.view.acts || {}));
const FORMS = Object.assign({}, ...TABS.map((t) => t.view.forms || {}));

async function loadJson(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(path + ' を読み込めません');
  return r.json();
}

async function boot() {
  const [defaults, rules] = await Promise.all([loadJson('config/defaults.json'), loadJson('config/rules.json')]);
  defaults.rules = rules;
  const store = new Store(await openLocalDb(), defaults);
  await store.load();
  const sync = new SyncEngine(store);
  const app = makeApp(store, sync, rules);
  window.techo = app; // デバッグ用
  store.onChange = () => sync.schedule(2000);
  store.subscribe(() => app.rerender());
  sync.onStatus = () => app.renderHeader();

  if (sync.configured) {
    app.render();
    await app.firstSync();
  } else {
    if (!store.meta.seeded) { await A.seedDefaults(store, defaults, rules); await store.setMeta('seeded', true); }
    if (await A.applyMigrations(store, defaults)) await store.setMeta('lastDayStart', null);
    await app.checkDayStart();
  }
  app.render();

  setInterval(() => app.tick(), 30000);
  setInterval(() => sync.sync(), 5 * 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { app.checkDayStart(); sync.sync(); } });
  window.addEventListener('online', () => sync.sync());
  window.addEventListener('hashchange', () => app.render());
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

function makeApp(store, sync, defaultRules) {
  const fired = {};
  let dayStartRunning = null;
  let pendingRender = false;
  const app = {
    store, sync, defaultRules,
    state: {},
    now: () => new Date(),
    today: () => A.today(store),
    get tab() { const id = (location.hash || '#today').slice(1); return TABS.find((t) => t.id === id) || TABS[0]; },

    async firstSync() {
      await sync.sync();
      if (!store.meta.seeded) { await A.seedDefaults(store, store.defaults, defaultRules); await store.setMeta('seeded', true); }
      if (await A.applyMigrations(store, store.defaults)) await store.setMeta('lastDayStart', null);
      await app.checkDayStart(true);
    },

    // 日付が変わっていたら繰越など（スマホと PC の両方で動いても重複しない）
    checkDayStart(force) {
      if (dayStartRunning) return dayStartRunning;
      dayStartRunning = (async () => {
        const dk = app.today();
        if (store.meta.lastDayStart !== dk) {
          if (sync.configured) await sync.sync();
          const r = await A.runDayStart(store, dk, app.now());
          if (r.carried) app.toast(r.carried + ' 件を今日へ繰り越しました');
        }
        await A.cleanupCarried(store, dk);
        if (sync.configured && (force || store.meta.preparedDate !== dk)) {
          const res = await sync.sync({ prepare: dk });
          if (res.ok) await store.setMeta('preparedDate', dk);
        }
      })().finally(() => { dayStartRunning = null; });
      return dayStartRunning;
    },

    async afterImport() { await store.setMeta('lastDayStart', null); await app.checkDayStart(true); },

    render() {
      const tab = app.tab;
      document.querySelectorAll('nav.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab.id));
      const view = document.getElementById('view');
      try { view.innerHTML = tab.view.render(app); }
      catch (e) { console.error(e); view.innerHTML = '<div class="alert danger">表示できませんでした：' + esc(e.message) + '</div>'; }
      app.renderHeader();
      pendingRender = false;
    },

    rerender() {
      const ae = document.activeElement;
      if (ae && ae.closest && ae.closest('#view') && /INPUT|TEXTAREA|SELECT/.test(ae.tagName) && ae.type !== 'checkbox') { pendingRender = true; return; }
      if (app._raf) return;
      app._raf = requestAnimationFrame(() => { app._raf = null; app.render(); });
    },

    renderHeader() {
      const dk = app.today();
      document.getElementById('hdr-date').textContent = formatMd(dk);
      const chip = document.getElementById('sync-chip');
      const n = store.outbox.size;
      let text, cls;
      if (!sync.configured) { text = '未接続'; cls = 'warn'; }
      else if (sync.status.state === 'syncing') { text = '同期中…'; cls = ''; }
      else if (sync.status.state === 'error' || sync.status.state === 'offline') { text = (sync.status.state === 'offline' ? 'オフライン' : 'エラー') + (n ? '・未送信' + n : ''); cls = 'warn'; }
      else { text = n ? '未送信 ' + n : '同期済み'; cls = n ? '' : 'ok'; }
      chip.textContent = text;
      chip.className = 'sync-chip ' + cls;
      chip.title = store.meta.syncError || '';
    },

    toast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.classList.add('show');
      clearTimeout(app._toast);
      app._toast = setTimeout(() => t.classList.remove('show'), 3200);
    },

    modal(html, onSubmit, modalActs) {
      const dlg = document.getElementById('modal');
      const body = dlg.querySelector('.modal-body');
      body.innerHTML = html;
      dlg._submit = onSubmit; dlg._acts = modalActs || {};
      if (!dlg.open) dlg.showModal();
      const first = body.querySelector('input:not([type=hidden]),select,textarea');
      if (first && window.innerWidth > 700) first.focus();
    },
    closeModal() { const d = document.getElementById('modal'); if (d.open) d.close(); },

    confirm(message, okLabel, cancelLabel) {
      return new Promise((resolve) => {
        const dlg = document.getElementById('confirm');
        dlg.querySelector('.confirm-msg').textContent = message;
        const ok = dlg.querySelector('[data-ok]'), ng = dlg.querySelector('[data-ng]');
        ok.textContent = okLabel || 'OK'; ng.textContent = cancelLabel || 'キャンセル';
        const done = (v) => { ok.onclick = ng.onclick = null; dlg.close(); resolve(v); };
        ok.onclick = () => done(true); ng.onclick = () => done(false);
        dlg.oncancel = (e) => { e.preventDefault(); done(false); };
        dlg.showModal();
      });
    },

    // 30 秒ごと：日付の切り替え・通知・計測中の表示更新
    async tick() {
      await app.checkDayStart();
      const now = app.now();
      const v = store.view;
      const st = v.settings;
      const dk = app.today();
      const once = (key, title, body) => { if (fired[key]) return; fired[key] = true; notify(title, body, (t, b) => app.toast(t + '：' + b)); };
      const s = v.state || {};
      if (s.nappingSince && now - parseIso(s.nappingSince) >= (st.napAlarmMin || 20) * 60000) once('nap:' + s.nappingSince, '⏰ 昼寝から起きる時間です', (st.napAlarmMin || 20) + '分たちました');
      if (s.sleepingSince && now >= atTime(dk, st.sleepAlarm || '06:00') && parseIso(s.sleepingSince) < atTime(dk, st.sleepAlarm || '06:00')) once('wake:' + s.sleepingSince, '☀️ 起きる時間です', (st.sleepAlarm || '06:00') + ' になりました');
      const mins = minOfDay(now);
      if (mins >= hmToMin(st.minCheckTime || '23:00')) {
        const miss = minAchievement((v.days[dk] || { tasks: [] }).tasks).missing;
        if (miss.length) once('min:' + dk, '【min】が ' + miss.length + ' 件未完了', miss.map((t) => t.title).join('、'));
      }
      if (mins >= hmToMin(st.bedPrepTime || '23:30') && !s.sleepingSince) once('bed:' + dk, '🛏 寝る準備の時間です', (st.bedPrepTime || '23:30') + ' になりました');
      for (const t of overdueTimers(v.allTasks, now, st.timerWarnMin)) once('timer:' + t.id + t.runningSince, '⏱ 計測の止め忘れ？', '「' + t.title + '」が ' + (st.timerWarnMin || 120) + ' 分以上動いています');
      if (app.tab.id === 'today' && (v.allTasks.some((t) => t.runningSince) || s.nappingSince)) app.rerender();
    },
  };

  // 画面の操作をまとめて受け取る
  document.addEventListener('click', async (e) => {
    const m = e.target.closest('[data-modal-act]');
    if (m) {
      const dlg = document.getElementById('modal');
      const fn = dlg._acts && dlg._acts[m.dataset.modalAct];
      if (fn) { e.preventDefault(); await fn(); }
      return;
    }
    const el = e.target.closest('[data-act]');
    if (!el || (el.tagName === 'INPUT')) return;
    const fn = ACTS[el.dataset.act];
    if (!fn) return;
    e.preventDefault();
    try { await fn(app, el, e); } catch (err) { console.error(err); app.toast('エラー：' + err.message); }
  });
  document.addEventListener('change', async (e) => {
    const el = e.target;
    const name = el.dataset && (el.dataset.actChange || (el.type === 'checkbox' && el.dataset.act));
    if (!name || !ACTS[name]) return;
    try { await ACTS[name](app, el, e); } catch (err) { console.error(err); app.toast('エラー：' + err.message); }
  });
  document.addEventListener('submit', async (e) => {
    const form = e.target;
    const dlg = document.getElementById('modal');
    e.preventDefault();
    try {
      if (dlg.contains(form)) {
        if (dlg._submit) { await dlg._submit(formData(form), form); }
        app.closeModal();
      } else if (form.dataset.form && FORMS[form.dataset.form]) {
        await FORMS[form.dataset.form](app, formData(form), form);
      }
    } catch (err) { console.error(err); app.toast('エラー：' + err.message); }
  });
  document.addEventListener('focusout', () => { setTimeout(() => { if (pendingRender) app.rerender(); }, 50); });
  document.getElementById('modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) app.closeModal(); });
  document.getElementById('sync-chip').addEventListener('click', () => { if (sync.configured) sync.sync({ prepare: app.today() }); else location.hash = '#settings'; });
  return app;
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('view').innerHTML = '<div class="alert danger">起動できませんでした：' + esc(e.message) + '</div>';
});
