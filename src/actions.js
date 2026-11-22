// アプリの操作（画面から呼ぶ）。データの変更はすべてここを通る
import { toIso, addDays, logicalDate, parseIso } from './core/dates.js';
import { normalizeTask, randomId, tagOf } from './core/tasks.js';
import { computeCarryover } from './core/carryover.js';
import { startSleep, endSleep, startNap, endNap } from './core/sleep.js';
import { startTask, stopTask, setDone } from './core/timer.js';
import { buildDay, studyTasksToRemove } from './core/dayBuild.js';
import { nextUnit, unitStatus } from './core/study.js';
import { evaluateRules } from './analysis/ruleEngine.js';
import { computeRatios } from './core/estimates.js';
import { importToRecords, dayData } from './model/records.js';

const OLD = '2000-01-01T00:00:00+09:00'; // 初期データは古い日時にして、サーバーにあるデータを優先させる

export function today(store, now) {
  return logicalDate(now || new Date(), store.view.settings.dayStartsAt);
}

// ── 初期データ ──
export async function seedDefaults(store, defaults, rules) {
  const v = store.view;
  const items = [];
  if (!v.templates.length) for (const t of defaults.templates) items.push({ kind: 'tpl', id: t.id, data: Object.assign({}, t, { id: undefined }), updatedAt: OLD });
  if (!v.subjects.length) for (const s of defaults.subjects) items.push({ kind: 'subj', id: s.id, data: Object.assign({}, s, { id: undefined }), updatedAt: OLD });
  for (const k of ['settings', 'fixedEvents', 'links']) if (!store.get('cfg', k)) items.push({ kind: 'cfg', id: k, data: { value: defaults[k] }, updatedAt: OLD });
  if (!store.get('cfg', 'rules')) items.push({ kind: 'cfg', id: 'rules', data: { value: rules }, updatedAt: OLD });
  for (const it of items) if (it.data && it.data.id === undefined) delete it.data.id;
  if (items.length) await store.putMany(items);
  return items.length;
}

// ── 日付が変わったとき ──
// ①繰越 ②閉じた日のルール（見積もり自動増）③毎日のタスク・学習を追加 ④21:50 に作った学習タスクを実際に合わせる
export async function runDayStart(store, dk, now) {
  const v = store.view;
  const items = [];
  const co = computeCarryover(v.days, dk);
  for (const t of co.updatedTasks) items.push({ kind: 'task', id: t.id, data: strip(t) });
  for (const t of co.newTasks) items.push({ kind: 'task', id: t.id, data: strip(t) });
  for (const d of Object.keys(co.closedDays)) {
    const cur = store.get('day', d);
    items.push({ kind: 'day', id: d, data: Object.assign({}, cur ? cur.data : {}, co.closedDays[d], { closed: true }) });
  }
  if (items.length) await store.putMany(items);

  const closed = Object.keys(co.closedDays).sort();
  if (closed.length) await applyRuleActions(store, closed[closed.length - 1], dk);

  const v2 = store.view;
  const r = buildDay(dk, { templates: v2.templates, subjects: v2.subjects, tasksAll: v2.allTasks, links: v2.links, mode: 'actual' });
  const more = r.create.map((t) => ({ kind: 'task', id: t.id, data: strip(t) }));
  const all = v2.allTasks.concat(r.create);
  for (const id of studyTasksToRemove(dk, all, r.studyKeep)) {
    const rec = store.get('task', id);
    if (rec) more.push({ kind: 'task', id, data: rec.data, deleted: true });
  }
  if (more.length) await store.putMany(more);
  await store.setMeta('lastDayStart', dk);
  return { carried: co.newTasks.length, closed: closed.length, created: r.create.length };
}

function strip(t) { const o = Object.assign({}, t); delete o.id; return o; }

// 実績倍率のルール（raiseEstimate）を自動で適用
export async function applyRuleActions(store, closedDk, todayDk) {
  const v = store.view;
  const applied = store.meta.appliedActions || {};
  const res = evaluateRules({
    date: closedDk, days: v.days, settings: v.settings, rules: v.rules,
    ratios: computeRatios(v.allTasks, closedDk, 28), templates: v.templates, subjects: v.subjects,
  });
  const items = [];
  const log = [];
  for (const f of res.findings) {
    const a = f.action;
    if (!a || a.type !== 'raiseEstimate' || !a.target) continue;
    const key = a.target.kind + ':' + a.target.id + ':' + a.newEst;
    if (applied[key]) continue;
    const rec = store.get(a.target.kind, a.target.id);
    if (!rec || !(a.newEst > (rec.data.est || 0))) continue;
    items.push({ kind: a.target.kind, id: a.target.id, data: Object.assign({}, rec.data, { est: a.newEst }) });
    applied[key] = todayDk;
    log.push({ date: todayDk, text: (rec.data.title || rec.data.name) + ' の見積を ' + (rec.data.est || 0) + '分 → ' + a.newEst + '分に増やしました' });
  }
  if (items.length) {
    await store.putMany(items);
    await store.setMeta('appliedActions', applied);
    await store.setMeta('actionLog', (store.meta.actionLog || []).concat(log).slice(-30));
  }
  return log;
}

// ── 睡眠 ──
function state(store) { return Object.assign({}, store.view.state); }

export async function sleepStart(store, now, stopRunning) {
  const r = startSleep(state(store), now);
  if (r.error) return r;
  const items = [{ kind: 'cfg', id: 'state', data: { value: r.state } }];
  if (stopRunning) for (const t of store.view.allTasks.filter((x) => x.runningSince)) items.push({ kind: 'task', id: t.id, data: strip(stopTask(t, now)) });
  await store.putMany(items);
  return r;
}

export async function sleepEnd(store, now) {
  const r = endSleep(state(store), now);
  if (r.error) return r;
  const cur = store.get('day', r.date);
  await store.putMany([
    { kind: 'cfg', id: 'state', data: { value: r.state } },
    { kind: 'day', id: r.date, data: Object.assign({}, cur ? cur.data : {}, { sleep: r.sleep }) },
  ]);
  return r;
}

export async function napStart(store, now, stopRunning) {
  const r = startNap(state(store), now);
  if (r.error) return r;
  const items = [{ kind: 'cfg', id: 'state', data: { value: r.state } }];
  if (stopRunning) for (const t of store.view.allTasks.filter((x) => x.runningSince)) items.push({ kind: 'task', id: t.id, data: strip(stopTask(t, now)) });
  await store.putMany(items);
  return r;
}

export async function napEnd(store, now) {
  const r = endNap(state(store), now);
  if (r.error) return r;
  const cur = store.get('day', r.date);
  const naps = ((cur && cur.data.naps) || []).concat([r.nap]);
  await store.putMany([
    { kind: 'cfg', id: 'state', data: { value: r.state } },
    { kind: 'day', id: r.date, data: Object.assign({}, cur ? cur.data : {}, { naps }) },
  ]);
  return r;
}

// ── タスク ──
export async function addTask(store, dk, fields) {
  const t = normalizeTask(Object.assign({ id: randomId(12), source: 'manual' }, fields), dk);
  t.tag = tagOf(t.title);
  await store.put('task', t.id, strip(t));
  return t;
}

export async function updateTask(store, id, patch) {
  const rec = store.get('task', id);
  if (!rec) return;
  const data = Object.assign({}, rec.data, patch);
  if (patch.title != null) data.tag = tagOf(patch.title);
  await store.put('task', id, data);
}

export async function deleteTask(store, id) { await store.remove('task', id); }

export async function toggleDone(store, id, done, now) {
  const rec = store.get('task', id);
  if (!rec) return;
  const t = setDone(Object.assign({ id }, rec.data), done, now);
  await store.put('task', id, strip(t));
  await store.queuePlanUpdates(planUpdatesFor(store, t));
}

// 学習計画シートの「進捗」への書き戻し
export function planUpdatesFor(store, task) {
  const out = [];
  if (task.planRef) out.push({ title: task.planRef.title, start: task.planRef.start, progress: task.done ? '完了' : '未着手' });
  if (task.subjectId) {
    const s = store.view.subjects.find((x) => x.id === task.subjectId);
    if (s && s.planSync !== false) {
      const st = unitStatus(s, store.view.allTasks, task.date, 'actual').filter((u) => !u.milestone);
      const unit = st.find((u) => u.key === task.unitKey);
      if (unit && unit.item && unit.item.label) {
        const group = st.filter((u) => u.outerKey === unit.outerKey);
        const doneN = group.filter((u) => u.done).length;
        const progress = doneN === group.length ? '完了' : doneN > 0 ? '進行中' : '未着手';
        out.push({ title: s.name + '：' + unit.item.label, progress });
      }
    }
  }
  return out;
}

export async function startTimer(store, id, now) {
  const items = [];
  for (const t of store.view.allTasks.filter((x) => x.runningSince && x.id !== id)) items.push({ kind: 'task', id: t.id, data: strip(stopTask(t, now)) });
  const rec = store.get('task', id);
  if (!rec) return;
  items.push({ kind: 'task', id, data: strip(startTask(Object.assign({ id }, rec.data), now)) });
  await store.putMany(items);
}

export async function stopTimer(store, id, at) {
  const rec = store.get('task', id);
  if (!rec) return;
  await store.put('task', id, strip(stopTask(Object.assign({ id }, rec.data), at)));
}

// 後ろ倒し：別の日へ移す（ID はそのまま）
export async function moveTask(store, id, toDk) {
  await updateTask(store, id, { date: toDk, start: null, fixedTime: false });
}

export async function applyTimeline(store, placements) {
  const items = [];
  for (const p of placements) {
    const rec = store.get('task', p.taskId);
    if (!rec) continue;
    items.push({ kind: 'task', id: p.taskId, data: Object.assign({}, rec.data, { start: p.start, planDur: p.dur }) });
  }
  await store.putMany(items);
}

// ── 1 日の記録 ──
export async function saveDayFields(store, dk, fields) { await store.patchDay(dk, fields); }

// ── 学習 ──
export async function addNextStudyUnit(store, subjectId, dk) {
  const s = store.view.subjects.find((x) => x.id === subjectId);
  if (!s) return null;
  const t = nextUnit(s, store.view.allTasks, dk);
  if (!t) return null;
  t.manual = true;
  await store.put('task', t.id, strip(t));
  return t;
}

export async function saveSubject(store, subject) {
  const id = subject.id || 's-' + randomId(6);
  await store.put('subj', id, strip(Object.assign({}, subject, { id })));
  return id;
}

export async function setSubjectStatus(store, id, status, dk) {
  const rec = store.get('subj', id);
  if (!rec) return;
  const patch = { status };
  if (status === 'finished') patch.finishedAt = dk; else patch.finishedAt = null;
  await store.put('subj', id, Object.assign({}, rec.data, patch));
}

// ── 毎日のタスク ──
export async function saveTemplate(store, tpl) {
  const id = tpl.id || 't-' + randomId(6);
  await store.put('tpl', id, strip(Object.assign({}, tpl, { id })));
}
export async function deleteTemplate(store, id) { await store.remove('tpl', id); }

// ── 報連相 ──
export async function saveHou(store, h) {
  const id = h.id || 'h-' + randomId(8);
  await store.put('hou', id, strip(Object.assign({ done: false }, h, { id })));
}
export async function deleteHou(store, id) { await store.remove('hou', id); }

// ── 確認候補（Gmail）──
export async function inboxToTask(store, inboxId, dk, deadline) {
  const rec = store.get('inbox', inboxId);
  if (!rec) return;
  const m = rec.data;
  const t = await addTask(store, dk, { title: m.subject, deadline: deadline || null, priority: deadline ? 1 : 2, est: 15, source: 'gmail', mailLink: m.link });
  await store.put('inbox', inboxId, Object.assign({}, m, { status: 'task', taskId: t.id }));
}
export async function inboxToHou(store, inboxId, due) {
  const rec = store.get('inbox', inboxId);
  if (!rec) return;
  await saveHou(store, { to: (rec.data.from || '').replace(/<.*>/, '').trim(), what: rec.data.subject, kind: '連絡', due: due || null });
  await store.put('inbox', inboxId, Object.assign({}, rec.data, { status: 'hou' }));
}
export async function inboxIgnore(store, inboxId) {
  const rec = store.get('inbox', inboxId);
  if (rec) await store.put('inbox', inboxId, Object.assign({}, rec.data, { status: 'ignored' }));
}

// ── JSON 読み込み ──
// mode: 'merge'（読み込んだもので上書き・ほかは残す）／'replace'（日・タスク・報連相を置き換え）
export async function importData(store, data, mode) {
  const items = importToRecords(data).map((r) => ({ kind: r.kind, id: r.id, data: strip(Object.assign({}, r.data, { id: r.id })) }));
  if (mode === 'replace') {
    const keep = {};
    for (const it of items) keep[it.kind + ':' + it.id] = true;
    for (const r of store.records.values()) {
      if (r.deleted || ['day', 'task', 'hou'].indexOf(r.kind) < 0 || keep[r.key]) continue;
      items.push({ kind: r.kind, id: r.id, data: r.data, deleted: true });
    }
  }
  for (const it of items) if (it.kind === 'day') it.data = dayData(it.data);
  await store.putMany(items);
  return items.length;
}

export function tomorrowOf(dk) { return addDays(dk, 1); }
export function isoNow(now) { return toIso(now || new Date()); }
export function minutesSince(iso, now) { return Math.round(((now || new Date()) - parseIso(iso)) / 60000); }
