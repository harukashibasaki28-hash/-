// 「予定」画面：タイムライン自動作成・後ろ倒し候補・カレンダー登録
import { esc, fmtMin, tagChip } from './util.js';
import { formatMd, addDays, minOfDay, weekday } from '../core/dates.js';
import { buildTimeline } from '../core/scheduler.js';
import { computeRatios } from '../core/estimates.js';
import * as A from '../actions.js';

function compute(app, dk) {
  const v = app.store.view;
  const today = app.today();
  const day = v.days[dk] || { tasks: [] };
  return buildTimeline({
    date: dk, tasks: day.tasks, settings: v.settings, fixedEvents: v.fixedEvents, plan: v.plans[dk],
    startMin: dk === today ? minOfDay(app.now()) : null, ratios: computeRatios(v.allTasks, today, 28),
  });
}

export function render(app) {
  const today = app.today();
  const dk = app.state.tlDate && app.state.tlDate >= today ? app.state.tlDate : today;
  const r = compute(app, dk);
  app.state.lastTimeline = { dk, r };
  const v = app.store.view;
  const taskById = {};
  for (const t of (v.days[dk] || { tasks: [] }).tasks) taskById[t.id] = t;

  const rows = [];
  for (const b of r.blocks) rows.push({ start: b.start, end: b.end, cls: 'blk-' + b.kind, title: b.title, kind: b.kind, taskId: b.taskId });
  for (const p of r.placements) rows.push({ start: p.start, end: p.end, cls: 'blk-task', title: p.title, taskId: p.taskId, dur: p.dur, factor: p.factor });
  for (const b of r.breaks) rows.push({ start: b.start, end: b.end, cls: 'blk-break', title: '休憩' });
  rows.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const KIND = { fixed: '固定', travel: '移動', meal: '食事', pinned: '時間割' };

  const out = [];
  out.push('<section class="card"><div class="row-between"><h2>タイムライン</h2><div class="seg">' +
    '<button data-act="tlDate" data-date="' + today + '"' + (dk === today ? ' class="on"' : '') + '>今日</button>' +
    '<button data-act="tlDate" data-date="' + addDays(today, 1) + '"' + (dk !== today ? ' class="on"' : '') + '>明日</button></div></div>');
  out.push('<p class="muted small">' + formatMd(dk) + '　' + r.stats.dayStart + '〜' + r.stats.dayEnd + '　空き ' + fmtMin(r.stats.freeMin) + '・入れる上限 ' + fmtMin(r.stats.capacityMin) + '（75%）・配置 ' + fmtMin(r.stats.usedMin) + '・バッファ ' + fmtMin(r.stats.bufferMin) + '</p>');
  out.push('<ol class="timeline">' + rows.map((x) => {
    const t = x.taskId ? taskById[x.taskId] : null;
    return '<li class="' + x.cls + '"><span class="tl-time">' + x.start + '<small>' + x.end + '</small></span><span class="tl-body">' +
      (KIND[x.kind] ? '<span class="chip">' + KIND[x.kind] + '</span> ' : '') + (t ? tagChip(t.tag) + ' ' : '') + esc(x.title) +
      (x.dur ? '<small class="muted">　' + x.dur + '分（見積×' + x.factor + '）</small>' : '') + '</span></li>';
  }).join('') + '</ol>');
  out.push('<div class="actions"><button class="primary" data-act="tlApply">この配置で決定</button><button data-act="tlCalendar">Google カレンダーに登録</button></div>');
  out.push('</section>');

  if (r.deferred.length) {
    out.push('<section class="card"><h2>後ろ倒し候補（' + r.deferred.length + '件）</h2><ul class="deferred">' + r.deferred.map((d) =>
      '<li><div>' + esc(d.title) + '<div class="muted small">' + d.dur + '分・' + esc(d.reason) + '</div></div><div class="actions">' +
      '<button data-act="tlMove" data-id="' + esc(d.taskId) + '" data-to="' + addDays(dk, 1) + '">明日へ</button>' +
      '<button data-act="tlMove" data-id="' + esc(d.taskId) + '" data-to="' + nextWeekend(dk) + '">週末へ</button>' +
      '<button class="ghost danger" data-act="tlDrop" data-id="' + esc(d.taskId) + '">削る</button></div></li>').join('') + '</ul></section>');
  }
  const plan = v.plans[dk];
  out.push('<p class="muted small">' + (plan ? '学習計画シート・カレンダーの反映: ' + esc((plan.builtAt || '').slice(5, 16).replace('T', ' ')) : 'まだ学習計画シート・カレンダーからの反映はありません（Google との接続後に自動で入ります）') + '</p>');
  return out.join('');
}

function nextWeekend(dk) {
  let d = addDays(dk, 1);
  while (weekday(d) !== 6) d = addDays(d, 1);
  return d;
}

export const acts = {
  tlDate(app, el) { app.state.tlDate = el.dataset.date; app.rerender(); },
  async tlApply(app) {
    const lt = app.state.lastTimeline;
    if (!lt) return;
    await A.applyTimeline(app.store, lt.r.placements);
    app.toast(lt.r.placements.length + '件の時刻を決めました');
  },
  async tlCalendar(app) {
    const lt = app.state.lastTimeline;
    if (!lt) return;
    if (!app.sync.configured) return app.toast('先に「設定」で Google との接続をしてください');
    const v = app.store.view;
    const tasks = ((v.days[lt.dk] || {}).tasks || []).filter((t) => t.start).map((t) => ({
      id: t.id, title: t.title, start: t.start, est: t.est, dur: t.planDur || t.slotMin || t.est, priority: t.priority,
      source: t.source, carriedFrom: t.carriedFrom, deadline: t.deadline, done: t.done, calendarEventId: t.calendarEventId,
    }));
    if (!tasks.length) return app.toast('時刻の決まったタスクがありません。先に「この配置で決定」を押してください');
    try {
      app.toast('カレンダーに登録しています…');
      await app.sync.sync();
      const res = await app.sync.calendar(lt.dk, tasks);
      const items = [];
      for (const id of Object.keys(res.mapping || {})) {
        const rec = app.store.get('task', id);
        if (rec && rec.data.calendarEventId !== res.mapping[id]) items.push({ kind: 'task', id, data: Object.assign({}, rec.data, { calendarEventId: res.mapping[id] }) });
      }
      if (items.length) await app.store.putMany(items);
      app.toast(Object.keys(res.mapping || {}).length + '件をカレンダーに登録・更新しました');
    } catch (e) { app.toast('登録できませんでした：' + e.message); }
  },
  async tlMove(app, el) { await A.moveTask(app.store, el.dataset.id, el.dataset.to); app.toast(formatMd(el.dataset.to) + ' へ移しました'); },
  async tlDrop(app, el) {
    const t = app.store.view.allTasks.find((x) => x.id === el.dataset.id);
    if (t && (await app.confirm('「' + t.title + '」を削りますか？', '削る', 'やめる'))) await A.deleteTask(app.store, t.id);
  },
};
