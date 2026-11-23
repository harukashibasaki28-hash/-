// 繰越：日付が変わったら、前日以前の未完了タスクを今日へコピーし、その日を closed にする
import { carriedId, carriedOriginals } from './tasks.js';
import { dayCompletion } from './stats.js';

// days: { 'YYYY-MM-DD': { tasks: [...], closed, ... } }
// 返り値: { newTasks, closedDays: { dk: {planned, done, rate} } }
// 元のタスクは書き換えない（繰越済みかどうかは、繰越コピーがあるかで判断する）
// 何度呼んでも同じ結果になる（ID が決まっているので、スマホと PC で両方実行しても重複しない）
// deletedTasks: 削除済みのタスク（削った繰越コピーも「繰越済み」の印として使う）
export function computeCarryover(days, today, deletedTasks) {
  const newTasks = [];
  const closedDays = {};
  const all = [];
  for (const k of Object.keys(days)) for (const t of (days[k].tasks || [])) all.push(Object.assign({ date: k }, t));
  const carried = carriedOriginals(all.concat((deletedTasks || []).map((t) => Object.assign({}, t, { deleted: false }))));
  const todayTasks = (days[today] && days[today].tasks) || [];
  const existing = {};
  for (const t of todayTasks) existing[t.id] = true;

  const keys = Object.keys(days).filter((k) => k < today).sort();
  for (const dk of keys) {
    const day = days[dk];
    if (!day || day.closed) continue;
    const tasks = (day.tasks || []).filter((t) => !t.deleted);
    for (const t of tasks) {
      if (t.done || carried[t.id] || t.carriedTo || t.noCarry) continue; // 金フレは繰り越さない（翌日に選び直す）
      const id = carriedId(t.id, today);
      if (existing[id]) continue;
      existing[id] = true;
      const copy = Object.assign({}, t, {
        id: id, date: today,
        done: false, doneAt: null, sessions: [], actualMin: 0, runningSince: null, start: null,
        carryCount: (Number(t.carryCount) || 0) + 1, carriedFrom: dk,
      });
      delete copy.carriedTo;
      delete copy.calendarEventId;
      newTasks.push(copy);
    }
    closedDays[dk] = dayCompletion(tasks);
  }
  return { newTasks: newTasks, closedDays: closedDays };
}
