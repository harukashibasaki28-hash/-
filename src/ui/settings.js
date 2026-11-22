// 「設定」画面
import { esc, PRIORITY } from './util.js';
import { WEEKDAY_JA, toIso } from '../core/dates.js';
import { validateRules } from '../analysis/ruleEngine.js';
import { METRIC_DOCS } from '../analysis/metrics.js';
import { parseJsonText, previewImport, buildExport, ImportError } from '../model/importExport.js';
import { downloadText } from '../notify/ics.js';
import { requestPermission, notify } from '../notify/notifier.js';
import * as A from '../actions.js';

export function render(app) {
  const v = app.store.view;
  const s = v.settings;
  const c = app.store.meta.connection || {};
  const meta = app.store.meta;
  const out = [];

  out.push('<section class="card"><h2>Google との接続</h2>' +
    '<form data-form="connection"><label>ウェブアプリの URL<input name="url" type="url" placeholder="https://script.google.com/macros/s/…/exec" value="' + esc(c.url || '') + '"></label>' +
    '<label>キー（合言葉）<input name="key" type="password" autocomplete="off" value="' + esc(c.key || '') + '"></label>' +
    '<div class="actions"><button class="primary">保存して接続</button><button type="button" data-act="syncNow">今すぐ同期</button></div></form>' +
    '<p class="small">状態：' + esc(syncText(app)) + '　未送信 ' + app.store.outbox.size + ' 件' + (meta.lastSyncAt ? '　最終同期 ' + esc(new Date(meta.lastSyncAt).toLocaleString('ja-JP')) : '') + '</p>' +
    (meta.syncError ? '<p class="alert danger small">' + esc(meta.syncError) + '</p>' : '') +
    '<p class="muted small">設定の手順は docs/SETUP_GAS.md（GitHub のリポジトリ内）を見てください。キーはこの端末の中だけに保存されます。</p></section>');

  out.push('<section class="card"><h2>学習計画シート・Gmail</h2><form data-form="google">' +
    '<label>学習計画スプレッドシートの URL または ID<input name="planSheetId" value="' + esc(s.planSheetId || '') + '" placeholder="https://docs.google.com/spreadsheets/d/…"></label>' +
    '<div class="grid2"><label>予定のシート名<input name="planSheetName" value="' + esc(s.planSheetName || '予定一覧') + '"></label><label>時間割のシート名<input name="timetableSheetName" value="' + esc(s.timetableSheetName || '毎日の時間割') + '"></label></div>' +
    '<label>Gmail：確認候補にする差出人（1 行に 1 つ）<textarea name="gmailFrom" rows="2">' + esc((s.gmailFrom || []).join('\n')) + '</textarea></label>' +
    '<label>Gmail：件名のキーワード（1 行に 1 つ）<textarea name="gmailKeywords" rows="3">' + esc((s.gmailKeywords || []).join('\n')) + '</textarea></label>' +
    '<label>このアプリの URL（23:00 のメールに載せる）<input name="appUrl" value="' + esc(s.appUrl || location.href.split('#')[0]) + '"></label>' +
    '<button class="primary">保存</button></form></section>');

  out.push('<section class="card"><h2>目標と時間</h2><form data-form="settings">' +
    '<div class="grid2"><label>起床目標（から）<input type="time" name="wakeFrom" value="' + esc(s.wakeTarget.from) + '"></label><label>起床目標（まで）<input type="time" name="wakeTo" value="' + esc(s.wakeTarget.to) + '"></label></div>' +
    '<div class="grid2"><label>就寝目標<input name="bedTarget" value="' + esc(s.bedTarget) + '"></label><label>1日に使える時間（分）<input type="number" name="availableMin" value="' + (s.availableMin || '') + '"></label></div>' +
    '<div class="grid2"><label>集中しやすい時間帯<select name="focusPeriod">' + [['morning', '午前'], ['afternoon', '午後'], ['evening', '夜']].map(([k, l]) => '<option value="' + k + '"' + (s.focusPeriod === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>' +
    '<label>日付の切り替え<input type="time" name="dayStartsAt" value="' + esc(s.dayStartsAt || '00:00') + '"></label></div>' +
    '<div class="grid2"><label>タイムラインの開始<input type="time" name="planStart" value="' + esc(s.planStart) + '"></label><label>タイムラインの終了<input name="planEnd" value="' + esc(s.planEnd) + '"></label></div>' +
    '<div class="grid2"><label>バッファ（%）<input type="number" name="bufferPct" min="0" max="90" value="' + Math.round((s.bufferRatio == null ? 0.25 : s.bufferRatio) * 100) + '"></label><label>見積の倍率（実績がないとき）<input type="number" step="0.1" name="defaultEstFactor" value="' + s.defaultEstFactor + '"></label></div>' +
    '<label>食事（1 行に「名前, 開始, 分」）<textarea name="meals" rows="2">' + esc((s.meals || []).map((m) => m.label + ', ' + m.start + ', ' + m.min).join('\n')) + '</textarea></label>' +
    '<div class="grid2"><label>休憩：何分ごと<input type="number" name="breakEveryMin" value="' + s.breakEveryMin + '"></label><label>休憩：何分<input type="number" name="breakMin" value="' + s.breakMin + '"></label></div>' +
    '<label>固定予定の前後の移動（分）<input type="number" name="travelMinAroundFixed" value="' + s.travelMinAroundFixed + '"></label>' +
    '<div class="grid2"><label>起床アラーム<input type="time" name="sleepAlarm" value="' + esc(s.sleepAlarm) + '"></label><label>昼寝アラーム（分後）<input type="number" name="napAlarmMin" value="' + s.napAlarmMin + '"></label></div>' +
    '<div class="grid2"><label>【min】の確認<input type="time" name="minCheckTime" value="' + esc(s.minCheckTime) + '"></label><label>寝る準備<input type="time" name="bedPrepTime" value="' + esc(s.bedPrepTime) + '"></label></div>' +
    '<div class="grid2"><label>止め忘れの確認（分）<input type="number" name="timerWarnMin" value="' + s.timerWarnMin + '"></label><label>ショートカットの名前<input name="shortcutName" value="' + esc(s.shortcutName || '手帳アラーム') + '"></label></div>' +
    '<button class="primary">保存</button></form></section>');

  out.push('<section class="card"><h2>固定予定</h2><form data-form="fixed"><label>1 行に「曜日, 開始, 終了, 名前」<textarea name="fixed" rows="3">' +
    esc((v.fixedEvents || []).map((f) => WEEKDAY_JA[f.weekday] + ', ' + f.start + ', ' + f.end + ', ' + f.title).join('\n')) + '</textarea></label><button class="primary">保存</button></form></section>');

  out.push('<section class="card"><h2>毎日のタスク</h2><ul class="tasks">' + v.templates.map((t) =>
    '<li><div class="task-main" data-act="tplEdit" data-id="' + esc(t.id) + '"><div>' + esc(t.title) + (t.active === false ? ' <span class="muted">（停止中）</span>' : '') + '</div><div class="task-meta">見積' + (t.est || 0) + '分・優先度' + PRIORITY[t.priority || 2] + (t.weekdays && t.weekdays.length ? '・' + t.weekdays.map((d) => WEEKDAY_JA[d]).join('') : '・毎日') + '</div></div></li>').join('') +
    '</ul><button class="wide" data-act="tplEdit">＋ 追加</button></section>');

  out.push('<section class="card"><h2>時間割の枠との結び付け</h2><p class="muted small">学習計画シート「毎日の時間割」の内容に match の文字が含まれる枠に、毎日のタスク（template）や学習科目（subject）を入れます。rest は枠の残り時間に入れるタスク名。</p>' +
    '<form data-form="links"><textarea name="links" rows="6" class="code">' + esc(JSON.stringify(v.links || [], null, 2)) + '</textarea><button class="primary">保存</button></form></section>');

  out.push('<section class="card"><h2>改善策のルール</h2><form data-form="rules"><textarea name="rules" rows="12" class="code">' + esc(JSON.stringify(v.rules || [], null, 2)) + '</textarea>' +
    '<div class="actions"><button class="primary">保存</button><button type="button" data-act="rulesReset">初期のルールに戻す</button></div></form>' +
    '<details><summary>使える指標</summary>' + Object.keys(METRIC_DOCS).map((scope) => '<h4>scope: ' + scope + '</h4><ul class="small">' + Object.keys(METRIC_DOCS[scope]).map((k) => '<li><code>' + k + '</code> ' + esc(METRIC_DOCS[scope][k]) + '</li>').join('') + '</ul>').join('') +
    '<p class="small">op は &gt; &gt;= &lt; &lt;= == != 。「all」「any」で組み合わせ、「streak」で連続日数。issue / advice の {指標名} は値に置き換わります。</p></details></section>');

  out.push('<section class="card"><h2>データ</h2><div class="actions"><button data-act="exportJson">JSON を書き出す</button><label class="button">JSON を読み込む<input type="file" accept=".json,application/json" data-act-change="importFile" hidden></label></div>' +
    '<details><summary>JSON を貼り付けて読み込む</summary><form data-form="importPaste"><textarea name="json" rows="6" class="code" placeholder="{ &quot;days/2026-11-22&quot;: { … } }"></textarea><button class="primary">確認する</button></form></details></section>');

  out.push('<section class="card"><h2>通知とアラーム</h2><div class="actions"><button data-act="notifyPerm">通知を許可</button><button data-act="notifyTest">通知のテスト</button></div>' +
    '<p class="muted small">アプリを閉じていても鳴らすには、iPhone のショートカット「' + esc(s.shortcutName || '手帳アラーム') + '」を作ってください（docs/SETUP_ALARM.md）。23:00 の【min】確認はメール、23:30 の寝る準備は Google カレンダーの通知で届きます。</p></section>');

  out.push('<section class="card"><h2>この端末</h2><p class="small muted">端末 ID：' + esc(meta.deviceId) + '・保存先：' + esc(app.store.db.kind) + '</p><button class="danger" data-act="resetLocal">この端末の控えを消して、Google から読み直す</button></section>');
  out.push('<p class="muted small center">手帳 v1.0</p>');
  return out.join('');
}

function syncText(app) {
  if (!app.sync.configured) return '未接続（この端末だけに保存中）';
  const st = app.sync.status.state;
  return { idle: '待機中', syncing: '同期中…', ok: '同期済み', error: 'エラー', offline: 'オフライン（つながったら送ります）' }[st] || st;
}

function lines(s) { return String(s || '').split(/\n/).map((x) => x.trim()).filter(Boolean); }

function sheetIdOf(s) {
  const m = String(s || '').match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  return m ? m[1] : String(s || '').trim();
}

async function saveSettings(app, patch) {
  await app.store.setConfig('settings', Object.assign({}, app.store.view.settings, patch));
  app.toast('保存しました');
}

async function confirmImport(app, text) {
  let data;
  try { data = parseJsonText(text); } catch (e) { return app.toast(e instanceof ImportError ? e.message : String(e)); }
  const p = previewImport(data);
  app.modal('<h2>読み込みの確認</h2><p>' + p.days + ' 日分（' + (p.from || '—') + '〜' + (p.to || '—') + '）・タスク ' + p.tasks + ' 件・報連相 ' + p.hourensou + ' 件' + (p.config.length ? '・設定（' + esc(p.config.join(', ')) + '）' : '') + '</p>' +
    (p.warnings.length ? '<ul class="small">' + p.warnings.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul>' : '') +
    '<button class="primary wide" data-modal-act="merge">マージ（同じ日・同じ ID は上書き、ほかは残す）</button>' +
    '<button class="danger wide" data-modal-act="replace">置き換え（日・タスク・報連相を全部入れ替え）</button>', null, {
    merge: async () => { const n = await A.importData(app.store, data, 'merge'); app.closeModal(); app.toast(n + ' 件を読み込みました'); app.afterImport(); },
    replace: async () => {
      if (!(await app.confirm('今の日・タスク・報連相を、読み込んだ内容に置き換えます。よろしいですか？', '置き換える', 'やめる'))) return;
      const n = await A.importData(app.store, data, 'replace'); app.closeModal(); app.toast(n + ' 件を反映しました'); app.afterImport();
    },
  });
}

export const forms = {
  async connection(app, f) {
    await app.store.setMeta('connection', { url: f.url.trim(), key: f.key.trim() });
    app.toast('接続しています…');
    try {
      await app.sync.ping();
      app.toast('接続できました。同期します');
      await app.firstSync();
    } catch (e) { app.toast('接続できません：' + e.message); }
    app.rerender();
  },
  async google(app, f) {
    await saveSettings(app, { planSheetId: sheetIdOf(f.planSheetId), planSheetName: f.planSheetName.trim(), timetableSheetName: f.timetableSheetName.trim(), gmailFrom: lines(f.gmailFrom), gmailKeywords: lines(f.gmailKeywords), appUrl: f.appUrl.trim() });
  },
  async settings(app, f) {
    const meals = lines(f.meals).map((l) => { const p = l.split(/[,，、]/).map((x) => x.trim()); return { label: p[0], start: p[1], min: Number(p[2]) || 60 }; }).filter((m) => m.start);
    await saveSettings(app, {
      wakeTarget: { from: f.wakeFrom, to: f.wakeTo }, bedTarget: f.bedTarget, availableMin: f.availableMin, focusPeriod: f.focusPeriod, dayStartsAt: f.dayStartsAt || '00:00',
      planStart: f.planStart, planEnd: f.planEnd, bufferRatio: (f.bufferPct == null ? 25 : f.bufferPct) / 100, defaultEstFactor: f.defaultEstFactor || 1.3,
      meals, breakEveryMin: f.breakEveryMin, breakMin: f.breakMin, travelMinAroundFixed: f.travelMinAroundFixed,
      sleepAlarm: f.sleepAlarm, napAlarmMin: f.napAlarmMin, minCheckTime: f.minCheckTime, bedPrepTime: f.bedPrepTime, timerWarnMin: f.timerWarnMin, shortcutName: f.shortcutName,
    });
  },
  async fixed(app, f) {
    const list = lines(f.fixed).map((l) => { const p = l.split(/[,，、]/).map((x) => x.trim()); return { weekday: WEEKDAY_JA.indexOf(p[0]), start: p[1], end: p[2], title: p.slice(3).join(', ') }; });
    if (list.some((x) => x.weekday < 0 || !x.start || !x.end)) return app.toast('曜日（日〜土の 1 文字）・開始・終了を確認してください');
    await app.store.setConfig('fixedEvents', list); app.toast('保存しました');
  },
  async links(app, f) {
    try { const v = JSON.parse(f.links); if (!Array.isArray(v)) throw new Error('[ ] の一覧で書いてください'); await app.store.setConfig('links', v); app.toast('保存しました'); }
    catch (e) { app.toast('保存できません：' + e.message); }
  },
  async rules(app, f) {
    let v;
    try { v = JSON.parse(f.rules); } catch (e) { return app.toast('JSON の形が違います：' + e.message); }
    const errs = validateRules(v);
    if (errs.length) return app.modal('<h2>ルールを確認してください</h2><ul>' + errs.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>');
    await app.store.setConfig('rules', v); app.toast('ルールを保存しました');
  },
  async importPaste(app, f) { await confirmImport(app, f.json); },
};

function tplForm(app, t) {
  const isNew = !t;
  t = t || { title: '', est: 20, priority: 2, weekdays: [] };
  app.modal('<h2>毎日のタスク</h2><form><label>タイトル（【min】【A】【任意】）<input name="title" required value="' + esc(t.title) + '"></label>' +
    '<div class="grid2"><label>見積（分）<input type="number" name="est" min="0" step="5" value="' + (t.est || 0) + '"></label><label>優先度<select name="priority">' + [1, 2, 3].map((p) => '<option value="' + p + '"' + ((t.priority || 2) === p ? ' selected' : '') + '>' + PRIORITY[p] + '</option>').join('') + '</select></label></div>' +
    '<fieldset><legend>曜日（何も選ばなければ毎日）</legend><div class="weekdays">' + WEEKDAY_JA.map((d, i) => '<label class="check"><input type="checkbox" name="wd' + i + '"' + ((t.weekdays || []).indexOf(i) >= 0 ? ' checked' : '') + '>' + d + '</label>').join('') + '</div></fieldset>' +
    '<label class="check"><input type="checkbox" name="active"' + (t.active === false ? '' : ' checked') + '> 使う</label>' +
    '<button class="primary wide">保存</button>' + (isNew ? '' : '<button type="button" class="danger wide" data-modal-act="del">削除</button>') + '</form>',
  async (f) => {
    const wds = [0, 1, 2, 3, 4, 5, 6].filter((i) => f['wd' + i]);
    await A.saveTemplate(app.store, Object.assign({}, t, { title: f.title.trim(), est: f.est || 0, priority: Number(f.priority), weekdays: wds, active: !!f.active }));
  }, { del: async () => { if (await app.confirm('「' + t.title + '」を削除しますか？', '削除', 'やめる')) { await A.deleteTemplate(app.store, t.id); app.closeModal(); } } });
}

export const acts = {
  async syncNow(app) { const r = await app.sync.sync({ prepare: app.today() }); app.toast(r.skipped ? '先に接続してください' : r.ok ? '同期しました' : '同期できません：' + r.error); app.rerender(); },
  tplEdit(app, el) { tplForm(app, el.dataset.id ? app.store.view.templates.find((t) => t.id === el.dataset.id) : null); },
  async rulesReset(app) { if (await app.confirm('ルールを初期の内容に戻しますか？', '戻す', 'やめる')) { await app.store.setConfig('rules', app.defaultRules); app.toast('戻しました'); } },
  exportJson(app) {
    const data = buildExport(app.store.view, toIso(new Date()));
    downloadText('techo-' + app.today() + '.json', JSON.stringify(data, null, 1), 'application/json');
  },
  async importFile(app, el) {
    const file = el.files && el.files[0];
    if (!file) return;
    const text = await file.text();
    el.value = '';
    await confirmImport(app, text);
  },
  async notifyPerm(app) { const r = await requestPermission(); app.toast(r === 'granted' ? '通知を許可しました' : r === 'unsupported' ? 'この端末では通知が使えません（ホーム画面に追加すると使える場合があります）' : '通知は許可されていません'); },
  async notifyTest(app) { await notify('手帳', '通知のテストです', (t, b) => app.toast(t + '：' + b)); },
  async resetLocal(app) {
    if (!app.sync.configured) return app.toast('Google と接続していないため、消すとデータが戻せません');
    if (app.store.outbox.size && !(await app.confirm('まだ送っていない変更が ' + app.store.outbox.size + ' 件あります。消しますか？', '消す', 'やめる'))) return;
    const conn = app.store.meta.connection;
    await app.store.resetAll();
    await app.store.setMeta('connection', conn);
    await app.firstSync();
    app.toast('読み直しました');
  },
};
