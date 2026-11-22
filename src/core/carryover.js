// 繰越：日付が変わったら、前日以前の未完了タスクを今日へコピーし、その日を closed にする
import { carriedId } from './tasks.js';
import { dayCompletion } from './stats.js';

// days: { 'YYYY-MM-DD': { tasks: [...], closed, ... } }
// 返り値: { newTasks, updatedTasks, closedDays: { dk: {planned, done, rate} } }
// 何度呼んでも同じ結果になる（ID が決まっているので、スマホと PC で両方実行しても重複しない）
export function computeCarryover(days, today) {
  const newTasks = [];
  const updatedTasks = [];
  const closedDays = {};
  const todayTasks = (days[today] && days[today].tasks) || [];
  const existing = {};
  for (const t of todayTasks) existing[t.id] = true;

  const keys = Object.keys(days).filter((k) => k < today).sort();
  for (const dk of keys) {
    const day = days[dk];
    if (!day || day.closed) continue;
    const tasks = (day.tasks || []).filter((t) => !t.deleted);
    for (const t of tasks) {
      if (t.done || t.carriedTo) continue;
      const id = carriedId(t.id, today);
      updatedTasks.push(Object.assign({}, t, { carriedTo: today }));
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
  return { newTasks: newTasks, updatedTasks: updatedTasks, closedDays: closedDays };
}
