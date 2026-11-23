// 「今日」画面：睡眠ボタン・お知らせ・タスク・確認候補
import { esc, fmtMin, fmtTime, tagChip, PRIORITY, isoToLocalInput, localInputToIso } from './util.js';
import { formatMd, addDays, minOfDay, hmToMin, atTime, parseIso, toIso, weekday } from '../core/dates.js';
import { runningMinutes, overdueTimers, capTime } from '../core/timer.js';
import { napSummary, recalcSleep, recalcNap } from '../core/sleep.js';
import { subjectProgress } from '../core/study.js';
import { minAchievement, dayCompletion } from '../core/stats.js';
import { shortcutUrl, isIOS } from '../notify/shortcuts.js';
import { alarmIcs, downloadText } from '../notify/ics.js';
import * as A from '../actions.js';

export function render(app) {
  const v = app.store.view;
  const dk = app.today();
  const now = app.now();
  const day = v.days[dk] || { tasks: [], naps: [] };
  const st = v.state || {};
  const out = [];

  out.push('<section class="card sleep">');
  out.push('<div class="sleep-buttons">' +
    btn('sleep', '🌙 寝る', !st.sleepingSince && !st.nappingSince) +
    btn('wake', '☀️ 起きた', !!st.sleepingSince) +
    btn('nap', '😴 昼寝する', !st.sleepingSince && !st.nappingSince) +
    btn('napEnd', '⏰ 昼寝から起きた', !!st.nappingSince) + '</div>');
  if (st.sleepingSince) out.push('<p class="status-line">睡眠中（' + fmtTime(st.sleepingSince) + '〜）</p>');
  if (st.nappingSince) out.push('<p class="status-line">昼寝中（' + fmtTime(st.nappingSince) + '〜、' + fmtMin(Math.round((now - parseIso(st.nappingSince)) / 60000)) + '）</p>');
  const ns = napSummary(day.naps);
  out.push('<p class="sleep-summary">' +
    (day.sleep ? '昨夜 ' + fmtTime(day.sleep.bed) + '→' + fmtTime(day.sleep.wake) + '　<b>' + fmtMin(day.sleep.min) + '</b>' : '今朝の睡眠は未記録') +
    (ns.count ? '　昼寝 ' + ns.count + '回 ' + fmtMin(ns.totalMin) : '') +
    ' <button class="link" data-act="editSleep" data-date="' + dk + '">修正</button></p>');
  out.push('</section>');

  out.push(alerts(app, dk, now, day));

  const plan = v.plans[dk];
  if (plan && plan.goals && plan.goals.length) {
    out.push('<section class="goals">' + plan.goals.map((g) => '<span class="goal">🎯 ' + esc(g.title) + (g.to ? '<small>〜' + formatMd(g.to) + '</small>' : '') + '</span>').join('') + '</section>');
  }

  const tasks = (day.tasks || []).filter((t) => !t.deleted);
  const c = dayCompletion(tasks);
  const mn = minAchievement(tasks);
  const g = groupTasks(tasks, dk);
  if (g.priority.length) {
    out.push('<section class="card priority"><h2>❗ 優先のやること</h2><ul class="tasks">' + g.priority.map((t) => taskRow(t, now)).join('') + '</ul></section>');
  }
  out.push('<section class="card"><div class="row-between"><h2>毎日の日課</h2><span class="muted">' + c.done + '/' + c.planned + ' 完了・【min】' + mn.done + '/' + mn.total + '</span></div>');
  out.push('<ul class="tasks">' + (g.routine.map((t) => taskRow(t, now)).join('') || '<li class="muted">ありません</li>') + '</ul>');
  if (g.other.length) out.push('<h3>その他のやること</h3><ul class="tasks">' + g.other.map((t) => taskRow(t, now)).join('') + '</ul>');
  out.push('<button class="primary wide" data-act="addTask" data-date="' + dk + '">＋ タスクを追加</button>');
  out.push('</section>');

  const inbox = v.inbox.filter((m) => m.status === 'new').sort((a, b) => (a.date < b.date ? 1 : -1));
  if (inbox.length) {
    out.push('<section class="card"><h2>📩 確認候補（Gmail）</h2><ul class="inbox">' + inbox.map((m) =>
      '<li><div class="mail-subj">' + (m.link ? '<a href="' + esc(m.link) + '" target="_blank" rel="noopener">' + esc(m.subject) + '</a>' : esc(m.subject)) + '</div>' +
      '<div class="muted small">' + esc((m.from || '').replace(/<.*>/, '')) + '・' + fmtTime(m.date) + '</div>' +
      '<div class="small">' + esc(m.snippet || '').slice(0, 140) + '</div>' +
      ((m.dates && m.dates.length) ? '<div class="small">締切の候補: ' + m.dates.map((d) => '<span class="chip">' + formatMd(d.date) + '</span>').join(' ') + '</div>' : '') +
      '<div class="actions"><button data-act="inboxTask" data-id="' + esc(m.id) + '">タスクにする</button><button data-act="inboxHou" data-id="' + esc(m.id) + '">報連相へ</button><button class="ghost" data-act="inboxIgnore" data-id="' + esc(m.id) + '">無視</button></div></li>').join('') + '</ul></section>');
  }
  return out.join('');
}

function btn(act, label, enabled) {
  return '<button class="big" data-act="' + act + '"' + (enabled ? '' : ' disabled') + '>' + label + '</button>';
}

// 日課（毎日のタスク・学習科目・金フレ・時間割）と、それ以外に分け、それ以外のうち優先度「高」・締切が近いものを一番上に
const ROUTINE = { template: true, study: true, srs: true, timetable: true };
export function groupTasks(tasks, dk) {
  const soon = addDays(dk, 2);
  const priority = [], routine = [], other = [];
  for (const t of tasks) {
    if (ROUTINE[t.source]) routine.push(t);
    else if (!t.done && (t.priority === 1 || (t.deadline && t.deadline <= soon))) priority.push(t);
    else other.push(t);
  }
  priority.sort((a, b) => ((a.deadline || '9') < (b.deadline || '9') ? -1 : (a.deadline || '9') > (b.deadline || '9') ? 1 : 0));
  return { priority, routine, other };
}

function taskRow(t, now) {
  const running = !!t.runningSince;
  const meta = [];
  if (t.start) meta.push('<span class="time">' + esc(t.start) + '</span>');
  meta.push('見積' + (t.est || 0) + '分');
  if (t.actualMin || running) meta.push('実績' + ((t.actualMin || 0) + (running ? runningMinutes(t, now) : 0)) + '分');
  if (t.deadline) meta.push('<span class="due">締切' + formatMd(t.deadline) + '</span>');
  if (t.carryCount) meta.push('<span class="carry">繰越' + t.carryCount + '回</span>');
  return '<li class="task' + (t.done ? ' done' : '') + (running ? ' running' : '') + '">' +
    '<input type="checkbox" aria-label="完了" data-act="toggle" data-id="' + esc(t.id) + '"' + (t.done ? ' checked' : '') + '>' +
    '<div class="task-main" data-act="editTask" data-id="' + esc(t.id) + '"><div class="task-title">' + tagChip(t.tag) + ' ' + esc(t.title.replace(/【(min|A|任意)】/g, '')) +
    (t.priority === 1 ? ' <span class="prio">高</span>' : '') + '</div><div class="task-meta">' + meta.join('・') + '</div></div>' +
    (t.done ? '' : '<button class="timer' + (running ? ' on' : '') + '" data-act="' + (running ? 'stop' : 'start') + '" data-id="' + esc(t.id) + '" aria-label="' + (running ? '停止' : '開始') + '">' + (running ? '■' : '▶') + '</button>') +
    '</li>';
}

function alerts(app, dk, now, day) {
  const v = app.store.view;
  const st = v.settings;
  const out = [];
  for (const t of overdueTimers(v.allTasks, now, st.timerWarnMin)) {
    out.push('<div class="alert warn">⏱ 「' + esc(t.title) + '」の計測が ' + fmtMin(runningMinutes(t, now)) + ' 動いています。止め忘れですか？' +
      '<div class="actions"><button data-act="stop" data-id="' + esc(t.id) + '">今止める</button><button data-act="stopCap" data-id="' + esc(t.id) + '">' + st.timerWarnMin + '分で止める</button><button class="ghost" data-act="keepTimer" data-id="' + esc(t.id) + '">続ける</button></div></div>');
  }
  const mins = minOfDay(now);
  if (mins >= hmToMin(st.minCheckTime || '23:00')) {
    const miss = minAchievement(day.tasks || []).missing;
    if (miss.length) out.push('<div class="alert danger"><b>23:00 の確認：【min】が ' + miss.length + ' 件未完了</b><ul>' + miss.map((t) => '<li>' + esc(t.title) + '</li>').join('') + '</ul></div>');
  }
  if (mins >= hmToMin(st.bedPrepTime || '23:30') && !v.state.sleepingSince) out.push('<div class="alert info">🛏 ' + esc(st.bedPrepTime) + ' になりました。寝る準備を始めましょう。</div>');
  for (const s of v.subjects.filter((x) => x.status !== 'finished')) {
    const p = subjectProgress(s, v.allTasks, dk);
    for (const m of p.messages) out.push('<div class="alert warn">📚 ' + esc(s.name) + '：' + esc(m) + '</div>');
  }
  const plan = v.plans[dk];
  if (plan && plan.upcoming && plan.upcoming.length) out.push('<div class="alert info">📅 近い締切：' + plan.upcoming.map((u) => esc(u.title) + '（' + formatMd(u.date) + '）').join('、') + '</div>');
  const soon = Object.values(v.hourensou).filter((h) => !h.done && h.due && h.due <= addDays(dk, 3)).sort((a, b) => (a.due < b.due ? -1 : 1));
  if (soon.length) out.push('<div class="alert ' + (soon[0].due < dk ? 'danger' : 'info') + '">🗣 報連相：' + soon.map((h) => esc(h.kind + ' ' + h.to + '「' + h.what + '」') + '（' + formatMd(h.due) + (h.due < dk ? ' 期限切れ' : '') + '）').join('、') + '</div>');
  if (mins >= 21 * 60) out.push('<div class="alert info">🌙 今日の進捗を見て、ひとこと振り返りを書きましょう。<div class="actions"><a class="button" href="#review">今日の進捗へ</a></div></div>');
  if (weekday(dk) === 0 && mins >= 18 * 60) out.push('<div class="alert info">📈 日曜日です。週の振り返りで、翌週に変えることを 1 つ決めましょう。<div class="actions"><a class="button" href="#review">週の振り返りへ</a></div></div>');
  for (const l of (app.store.meta.actionLog || []).filter((x) => x.date === dk)) out.push('<div class="alert info">🔧 ' + esc(l.text) + '</div>');
  return out.length ? '<section class="alerts">' + out.join('') + '</section>' : '';
}

// ── 操作 ──
async function confirmStopRunning(app) {
  const running = app.store.view.allTasks.filter((t) => t.runningSince);
  if (!running.length) return false;
  return app.confirm('計測中のタスクがあります：\n' + running.map((t) => '・' + t.title).join('\n') + '\n\n止めますか？', '止める', 'そのまま');
}

function alarmSheet(app, title, at) {
  const v = app.store.view;
  const hhmm = toIso(at).slice(11, 16);
  app.modal('<h2>' + esc(title) + '</h2><p>アプリを閉じていても鳴るように、端末のアラームを設定します。</p>' +
    '<a class="button primary wide" href="' + esc(shortcutUrl(v.settings.shortcutName, hhmm)) + '">⏰ iPhone のアラームを ' + hhmm + ' に設定</a>' +
    '<button class="wide" data-modal-act="ics">📅 カレンダー（.ics）で通知を追加</button>' +
    (isIOS() ? '' : '<p class="muted small">iPhone 以外では .ics を使ってください。</p>') +
    '<p class="muted small">ショートカットの準備は「設定」→「アラームの準備」を参照。</p>', null, {
    ics: () => downloadText('alarm-' + hhmm.replace(':', '') + '.ics', alarmIcs('⏰ ' + title, at, 5), 'text/calendar'),
  });
}

export const acts = {
  async sleep(app) {
    const stop = await confirmStopRunning(app);
    const now = app.now();
    const r = await A.sleepStart(app.store, now, stop);
    if (r.error) return app.toast(r.error);
    const st = app.store.view.settings;
    let at = atTime(A.today(app.store, now), st.sleepAlarm || '06:00');
    if (at <= now) at = atTime(addDays(A.today(app.store, now), 1), st.sleepAlarm || '06:00');
    alarmSheet(app, 'おやすみなさい（起床 ' + (st.sleepAlarm || '06:00') + '）', at);
  },
  async wake(app) {
    const r = await A.sleepEnd(app.store, app.now());
    if (r.error) return app.toast(r.error);
    app.toast('おはようございます。睡眠 ' + fmtMin(r.sleep.min));
    app.checkDayStart();
  },
  async nap(app) {
    const stop = await confirmStopRunning(app);
    const now = app.now();
    const r = await A.napStart(app.store, now, stop);
    if (r.error) return app.toast(r.error);
    const min = app.store.view.settings.napAlarmMin || 20;
    alarmSheet(app, '昼寝（' + min + '分後に起こします）', new Date(now.getTime() + min * 60000));
  },
  async napEnd(app) {
    const r = await A.napEnd(app.store, app.now());
    if (r.error) return app.toast(r.error);
    app.toast('昼寝 ' + fmtMin(r.nap.min));
  },
  async toggle(app, el) {
    const t = app.store.view.allTasks.find((x) => x.id === el.dataset.id);
    if (t && t.srsBlocks && el.checked) { el.checked = false; return srsDoneForm(app, t); }
    await A.toggleDone(app.store, el.dataset.id, el.checked, app.now());
  },
  async start(app, el) { await A.startTimer(app.store, el.dataset.id, app.now()); },
  async stop(app, el) { await A.stopTimer(app.store, el.dataset.id, app.now()); },
  async stopCap(app, el) {
    const t = app.store.view.allTasks.find((x) => x.id === el.dataset.id);
    if (t) await A.stopTimer(app.store, t.id, capTime(t, app.store.view.settings.timerWarnMin || 120));
  },
  async keepTimer(app, el) {
    // 2 時間後にまた聞く：開始時刻はそのまま、確認だけ後ろへ
    const t = app.store.view.allTasks.find((x) => x.id === el.dataset.id);
    if (!t) return;
    const now = app.now();
    await A.stopTimer(app.store, t.id, now);
    await A.startTimer(app.store, t.id, now);
  },
  addTask(app, el) { taskForm(app, null, el.dataset.date); },
  editTask(app, el) { const t = app.store.view.allTasks.find((x) => x.id === el.dataset.id); if (t) taskForm(app, t, t.date); },
  editSleep(app, el) { sleepForm(app, el.dataset.date); },
  async inboxTask(app, el) {
    const m = app.store.view.inbox.find((x) => x.id === el.dataset.id);
    const opts = (m.dates || []).map((d) => '<option value="' + d.date + '">' + formatMd(d.date) + '（' + esc(d.text) + '）</option>').join('');
    app.modal('<h2>タスクにする</h2><p>' + esc(m.subject) + '</p><form><label>締切<select name="deadline"><option value="">なし</option>' + opts + '</select></label>' +
      '<label>入れる日<input type="date" name="date" value="' + app.today() + '"></label><button class="primary wide">追加</button></form>',
    async (f) => { await A.inboxToTask(app.store, m.id, f.date || app.today(), f.deadline || null); app.toast('タスクに追加しました'); });
  },
  async inboxHou(app, el) {
    const m = app.store.view.inbox.find((x) => x.id === el.dataset.id);
    await A.inboxToHou(app.store, m.id, m.dates && m.dates[0] ? m.dates[0].date : null);
    app.toast('報連相に追加しました');
  },
  async inboxIgnore(app, el) { await A.inboxIgnore(app.store, el.dataset.id); },
};

export function taskForm(app, t, dk) {
  const isNew = !t;
  t = t || { title: '', priority: 2, est: 30, deadline: '', start: '' };
  app.modal('<h2>' + (isNew ? 'タスクを追加' : 'タスクを編集') + '</h2><form>' +
    '<label>タイトル（【min】【A】【任意】を付けると分類されます）<input name="title" required value="' + esc(t.title) + '"></label>' +
    '<div class="grid2"><label>優先度<select name="priority">' + [1, 2, 3].map((p) => '<option value="' + p + '"' + (t.priority === p ? ' selected' : '') + '>' + PRIORITY[p] + '</option>').join('') + '</select></label>' +
    '<label>見積（分）<input type="number" name="est" min="0" step="5" value="' + (t.est || 0) + '"></label></div>' +
    '<div class="grid2"><label>予定開始<input type="time" name="start" value="' + esc(t.start || '') + '"></label>' +
    '<label>締切<input type="date" name="deadline" value="' + esc(t.deadline || '') + '"></label></div>' +
    '<label>日付<input type="date" name="date" value="' + esc(dk) + '"></label>' +
    (isNew ? '' : '<label>実績（分）<input type="number" name="actualMin" min="0" value="' + (t.actualMin || 0) + '"></label>') +
    '<button class="primary wide">保存</button>' +
    (isNew ? '' : '<div class="actions"><button type="button" data-modal-act="tomorrow">明日へ</button><button type="button" class="danger" data-modal-act="del">削除</button></div>') +
    '</form>', async (f) => {
    const fields = { title: f.title.trim(), priority: Number(f.priority), est: f.est || 0, start: f.start || null, deadline: f.deadline || null };
    if (isNew) await A.addTask(app.store, f.date || dk, fields);
    else {
      if (f.date && f.date !== t.date) fields.date = f.date;
      if (f.actualMin != null && f.actualMin !== t.actualMin && !(t.sessions && t.sessions.length)) fields.actualMin = f.actualMin;
      if (f.start !== (t.start || '')) fields.fixedTime = false;
      await A.updateTask(app.store, t.id, fields);
    }
  }, {
    tomorrow: async () => { await A.moveTask(app.store, t.id, addDays(t.date, 1)); app.closeModal(); app.toast('明日へ移しました'); },
    del: async () => { if (await app.confirm('「' + t.title + '」を削除しますか？', '削除', 'やめる')) { await A.deleteTask(app.store, t.id); app.closeModal(); } },
  });
}

function sleepForm(app, dk) {
  const day = app.store.view.days[dk] || {};
  const s = day.sleep || {};
  const naps = day.naps || [];
  app.modal('<h2>' + formatMd(dk) + ' の睡眠を修正</h2><form>' +
    '<label>寝た時刻<input type="datetime-local" name="bed" value="' + isoToLocalInput(s.bed) + '"></label>' +
    '<label>起きた時刻<input type="datetime-local" name="wake" value="' + isoToLocalInput(s.wake) + '"></label>' +
    naps.map((n, i) => '<fieldset><legend>昼寝 ' + (i + 1) + '</legend><label>開始<input type="datetime-local" name="napStart' + i + '" value="' + isoToLocalInput(n.start) + '"></label><label>終了<input type="datetime-local" name="napEnd' + i + '" value="' + isoToLocalInput(n.end) + '"></label><label class="check"><input type="checkbox" name="napDel' + i + '"> この昼寝を消す</label></fieldset>').join('') +
    '<button class="primary wide">保存</button></form>', async (f) => {
    const sleep = f.bed || f.wake ? recalcSleep({ bed: localInputToIso(f.bed), wake: localInputToIso(f.wake), min: s.min || null }) : null;
    const newNaps = [];
    naps.forEach((n, i) => { if (!f['napDel' + i]) newNaps.push(recalcNap({ start: localInputToIso(f['napStart' + i]), end: localInputToIso(f['napEnd' + i]), min: n.min })); });
    await A.saveDayFields(app.store, dk, { sleep, naps: newNaps });
  });
}

// 金フレの完了：実際にやったブロックを選ぶ（学習回数と最後の日に記録される）
function srsDoneForm(app, t) {
  app.modal('<h2>金フレ：やったブロック</h2><form>' + t.srsBlocks.map((b, i) => {
    const s = app.store.view.subjects.find((x) => x.id === t.subjectId);
    const blk = s && (s.blocks || []).find((x) => x.key === b.key);
    return '<label class="check block-check"><input type="checkbox" name="b' + i + '" checked> ' + esc(blk ? blk.label : b.key) + (b.mode === 'x' ? '（×印中心）' : '（全語）') + '</label>';
  }).join('') + '<p class="muted small">やらなかったブロックはチェックを外してください。次の日以降にまた選ばれます。</p><button class="primary wide">完了にする</button></form>', async (f) => {
    const keys = t.srsBlocks.filter((b, i) => f['b' + i]).map((b) => b.key);
    if (!keys.length) return app.toast('ブロックを 1 つ以上選んでください');
    await A.updateTask(app.store, t.id, { srsDone: keys });
    await A.toggleDone(app.store, t.id, true, app.now());
  });
}
