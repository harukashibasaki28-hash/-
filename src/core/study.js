// 学習科目：単位の展開・その日にやる分の決定・区切りタスク（章末問題など）・遅れ警告
// 「どこまで終わったか」は学習タスクの完了記録から毎回計算する（位置を別に保存しない）。
// GAS にも同梱される。import は同梱ファイル（dates.js / tasks.js）からのみ。
import { addDays, weekday, formatMd, diffDays } from './dates.js';
import { studyTaskId, normalizeTask, carriedOriginals } from './tasks.js';

function fmt(format, n) { return String(format || '{n}').replace('{n}', n); }

// 外側の区切り（章・stage）の一覧
export function outerItems(subject) {
  const st = subject.structure || {};
  if (Array.isArray(st.items) && st.items.length) return st.items;
  const count = (st.outer && st.outer.count) || 0;
  const items = [];
  for (let i = 1; i <= count; i++) items.push({ n: i });
  return items;
}

function innerCount(subject, item) {
  const inner = (subject.structure || {}).inner || {};
  if (Array.isArray(item.units)) return item.units.length;
  if (item.secs != null) return Number(item.secs);
  if (Array.isArray(inner.labels)) return inner.labels.length;
  return Number(inner.count) || 1;
}

function innerKey(subject, j, item) {
  const inner = (subject.structure || {}).inner || {};
  if (item && Array.isArray(item.units)) { const u = item.units[j - 1]; return typeof u === 'string' ? u : u.label; }
  if (Array.isArray(inner.labels)) return inner.labels[j - 1];
  return fmt(inner.format || 'Sec{n}', j);
}

// 全単位を学習順に並べる。区切りタスク（afterOuter）は各区切りの直後に入る
export function expandUnits(subject) {
  const st = subject.structure || {};
  const outerFmt = (st.outer && st.outer.format) || '{n}';
  const units = [];
  for (const item of outerItems(subject)) {
    const ok = fmt(outerFmt, item.n);
    const outerTitle = item.label ? ok + ' ' + item.label : ok;
    const cnt = innerCount(subject, item);
    for (let j = 1; j <= cnt; j++) {
      const ik = innerKey(subject, j, item);
      const u = Array.isArray(item.units) && typeof item.units[j - 1] === 'object' ? item.units[j - 1] : {};
      units.push({
        key: ok + '-' + ik, outerKey: ok, outerTitle: outerTitle, item: item, milestone: false,
        title: subject.name + ' ' + (st.outer && st.outer.hideInTitle ? '' : outerTitle + ' ') + ik, est: u.est || item.est || subject.est || 30,
      });
    }
    for (const ms of subject.milestones || []) {
      if (ms.when !== 'afterOuter') continue;
      const label = ms.key || '章末問題';
      units.push({
        key: ok + '-' + label, outerKey: ok, outerTitle: outerTitle, item: item, milestone: true,
        title: String(ms.title || '{name} {outer} ' + label).replace('{name}', subject.name).replace('{outer}', outerTitle),
        est: ms.est || subject.est || 30,
      });
    }
  }
  return units;
}

export function isStudyDay(subject, dk) {
  if ((subject.offDays || []).indexOf(dk) >= 0) return false;
  const sd = subject.studyDays || 'everyday';
  const wd = weekday(dk);
  if (sd === 'weekdays') return wd >= 1 && wd <= 5;
  if (Array.isArray(sd)) return sd.indexOf(wd) >= 0;
  return true;
}

export function countStudyDays(subject, fromDk, toDk) {
  let n = 0;
  for (let d = fromDk; d <= toDk; d = addDays(d, 1)) if (isStudyDay(subject, d)) n++;
  return n;
}

// 単位ごとの状態を作る
// tasks: この科目の全タスク（全日付）。mode: 'actual'（実際の完了だけ）か
// 'optimistic'（date より前の日に入っている未完了も終わる前提。21:50 の翌日作成用）
export function unitStatus(subject, tasks, date, mode) {
  const units = expandUnits(subject);
  const idxBefore = subject.doneBefore ? units.findIndex((u) => u.key === subject.doneBefore) : -1;
  const byKey = {};
  const carried = carriedOriginals(tasks);
  for (const t of tasks || []) {
    if (t.deleted || t.subjectId !== subject.id || !t.unitKey) continue;
    (byKey[t.unitKey] = byKey[t.unitKey] || []).push(t);
  }
  return units.map((u, i) => {
    const ts = byKey[u.key] || [];
    let doneDate = null;
    if (i <= idxBefore) doneDate = '0000-00-00';
    for (const t of ts) {
      if (t.done) {
        const d = t.doneAt ? String(t.doneAt).slice(0, 10) : t.date;
        if (!doneDate || d < doneDate) doneDate = d;
      }
    }
    if (!doneDate && mode === 'optimistic') {
      for (const t of ts) if (t.date < date) doneDate = addDays(date, -1);
    }
    return Object.assign({}, u, {
      done: !!doneDate, doneDate: doneDate,
      tasks: ts,
      openOn: ts.filter((t) => !t.done && !t.carriedTo && !carried[t.id]).map((t) => t.date),
    });
  });
}

// その日にやる「通常の単位」の数
export function dailyQuota(subject, status, date, tasks, mode) {
  if (subject.status === 'finished') return 0;
  if (!isStudyDay(subject, date)) return 0;
  if (tasks && !started(subject, tasks, date, mode)) return 0;
  if (tasks && subject.everyNDays > 1) {
    let last = null;
    for (const t of tasks) if (!t.deleted && t.subjectId === subject.id && t.date < date && (!last || t.date > last)) last = t.date;
    if (last && diffDays(last, date) < subject.everyNDays) return 0;
  }
  const remainingAll = status.filter((u) => !u.milestone && !u.done).length;
  if (!remainingAll) return 0;
  if (subject.perDayMode !== 'auto') return Math.min(Number(subject.perDay) || 1, remainingAll);
  const need = paceNeeds(subject, status, date);
  let k = 1;
  for (const n of need) k = Math.max(k, n.perDay);
  return Math.min(k, Number(subject.maxPerDay) || 3, remainingAll);
}

// 開始の条件：startDate 以降、かつ startAfter の単位（別の科目でもよい）が前日までに終わっている
export function started(subject, tasks, date, mode) {
  if (subject.startDate && date < subject.startDate) return false;
  const sa = subject.startAfter;
  if (!sa || !sa.unitKey) return true;
  for (const t of tasks || []) {
    if (t.deleted || t.subjectId !== (sa.subjectId || subject.id) || t.unitKey !== sa.unitKey) continue;
    if (t.done && (t.doneAt ? String(t.doneAt).slice(0, 10) : t.date) < date) return true;
    if (mode === 'optimistic' && t.date < date) return true;
  }
  return !!sa.already;
}

// 期限ごとに「1 日あたり何単位必要か」
export function paceNeeds(subject, status, date) {
  const out = [];
  const groups = [];
  for (const u of status) {
    if (!groups.length || groups[groups.length - 1].key !== u.outerKey) groups.push({ key: u.outerKey, item: u.item, units: [] });
    groups[groups.length - 1].units.push(u);
  }
  let remaining = 0;
  for (const g of groups) {
    const item = g.item;
    remaining += g.units.filter((u) => !u.milestone && !u.done).length;
    if (!item.due) continue;
    if (remaining === 0) continue;
    const days = item.due >= date ? countStudyDays(subject, date, item.due) : 0;
    out.push({
      label: item.label ? g.key + ' ' + item.label : g.key, due: item.due, remaining: remaining, days: days,
      perDay: days > 0 ? Math.ceil(remaining / days) : remaining, overdue: item.due < date,
    });
  }
  const finalDue = subject.targetDate || (subject.examDate ? addDays(subject.examDate, -1 - (Number(subject.reviewDays) || 0)) : null);
  if (finalDue && remaining > 0 && !out.some((o) => o.due === finalDue)) {
    const days = finalDue >= date ? countStudyDays(subject, date, finalDue) : 0;
    out.push({ label: '全体', due: finalDue, remaining: remaining, days: days,
      perDay: days > 0 ? Math.ceil(remaining / days) : remaining, overdue: finalDue < date });
  }
  return out;
}

// その日の学習タスクを決める
// 返り値: { quota, carried, generate: [task], keepIds: {id:true} }
export function planStudyDay(subject, tasks, date, mode) {
  if (subject.status === 'finished') return { quota: 0, carried: 0, generate: [], keepIds: {} };
  const status = unitStatus(subject, tasks, date, mode);
  const quota = dailyQuota(subject, status, date, tasks, mode);
  const carriedTasks = (tasks || []).filter((t) => !t.deleted && t.subjectId === subject.id && t.date === date && !t.done && t.carriedFrom);
  const carriedKeys = {};
  for (const t of carriedTasks) carriedKeys[t.unitKey] = true;
  const carriedRegular = carriedTasks.filter((t) => !t.milestone).length;
  let n = Math.max(0, quota - carriedRegular);
  const generate = [];
  for (const u of status) {
    if (u.milestone || u.done || carriedKeys[u.key]) continue;
    if (n <= 0) break;
    if (u.openOn.some((d) => d !== date)) continue; // 別の日に入っている（繰越待ち・先の日）
    generate.push(makeStudyTask(subject, u, date));
    n--;
  }
  // 区切りタスク：その区切りの通常単位がすべて「前日までに」終わっていれば入れる
  for (const u of status) {
    if (!u.milestone || u.done || carriedKeys[u.key]) continue;
    if (u.openOn.some((d) => d !== date)) continue;
    const regs = status.filter((x) => !x.milestone && x.outerKey === u.outerKey);
    if (!regs.length || !regs.every((x) => x.done && x.doneDate < date)) continue;
    generate.push(makeStudyTask(subject, u, date));
  }
  const keepIds = {};
  for (const t of generate) keepIds[t.id] = true;
  return { quota: quota, carried: carriedRegular, generate: generate, keepIds: keepIds };
}

export function makeStudyTask(subject, unit, date) {
  const tag = subject.tag || 'min';
  return normalizeTask({
    id: studyTaskId(subject.id, unit.key),
    title: unit.title + '【' + tag + '】',
    priority: subject.priority || 1, est: unit.est, tag: tag,
    subjectId: subject.id, unitKey: unit.key, milestone: unit.milestone || undefined,
    source: 'study',
  }, date);
}

// 「次の単位を今日に追加」用
export function nextUnit(subject, tasks, date) {
  const status = unitStatus(subject, tasks, date, 'actual');
  for (const u of status) {
    if (u.milestone || u.done) continue;
    if (u.openOn.length) continue;
    return makeStudyTask(subject, u, date);
  }
  return null;
}

// 学習画面用のまとめ
export function subjectProgress(subject, tasks, date) {
  const status = unitStatus(subject, tasks, date, 'actual');
  const regular = status.filter((u) => !u.milestone);
  const done = regular.filter((u) => u.done).length;
  const next = status.find((u) => !u.done) || null;
  const needs = paceNeeds(subject, status, date);
  const normal = subject.perDayMode === 'auto' ? 1 : (Number(subject.perDay) || 1);
  const behind = needs.filter((n) => n.overdue || n.perDay > normal);
  let actualMin = 0;
  for (const u of status) for (const t of u.tasks) actualMin += Number(t.actualMin) || 0;
  const remaining = regular.length - done;
  let projected = null;
  if (remaining > 0 && subject.status !== 'finished') {
    // 1 日 normal 単位のペースで進んだ場合に終わる日
    let left = remaining, d = date, guard = 0;
    const step = subject.everyNDays > 1 ? subject.everyNDays : 1;
    while (left > 0 && guard++ < 2000) { if (isStudyDay(subject, d)) { left -= normal; if (left > 0) d = addDays(d, step); } else d = addDays(d, 1); }
    projected = d;
  }
  const messages = [];
  for (const b of behind) {
    messages.push(b.overdue
      ? '遅れ：' + b.label + '（期限 ' + formatMd(b.due) + '）を過ぎています。残り ' + b.remaining + ' 単位'
      : '遅れ：' + b.label + '（期限 ' + formatMd(b.due) + '）まで学習日 ' + b.days + ' 日で残り ' + b.remaining + ' 単位 → 1 日 ' + b.perDay + ' 単位必要');
  }
  return {
    total: regular.length, done: done, remaining: remaining, next: next, needs: needs,
    behind: behind.length > 0, messages: messages, actualMin: actualMin, projectedFinish: projected,
    quotaToday: dailyQuota(subject, status, date, tasks, 'actual'),
    units: status,
  };
}
