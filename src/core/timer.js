// タスクの計測（開始／停止）と止め忘れの検知
import { toIso, minutesBetween, parseIso } from './dates.js';

// 1 件のタスクを開始。返り値は変更後のタスク
export function startTask(task, now) {
  if (task.runningSince) return task;
  return Object.assign({}, task, { runningSince: toIso(now) });
}

// 停止。at を渡すとその時刻で止める（止め忘れのとき用）
export function stopTask(task, at) {
  if (!task.runningSince) return task;
  const end = toIso(at);
  const min = minutesBetween(task.runningSince, end);
  const sessions = (task.sessions || []).concat([{ start: task.runningSince, end: end, min: min }]);
  let total = 0;
  for (const s of sessions) total += Number(s.min) || 0;
  return Object.assign({}, task, { runningSince: null, sessions: sessions, actualMin: total });
}

export function runningTasks(tasks) {
  return (tasks || []).filter((t) => t.runningSince);
}

// 動いている時間（分）
export function runningMinutes(task, now) {
  return task.runningSince ? minutesBetween(task.runningSince, toIso(now)) : 0;
}

// 止め忘れ候補（warnMin 以上動いているもの）
export function overdueTimers(tasks, now, warnMin) {
  return runningTasks(tasks).filter((t) => runningMinutes(t, now) >= (warnMin || 120));
}

// 「warnMin で止める」用の時刻
export function capTime(task, capMin) {
  return new Date(parseIso(task.runningSince).getTime() + capMin * 60000);
}

// 完了／未完了の切り替え（計測中なら止める）
export function setDone(task, done, now) {
  let t = task;
  if (done && t.runningSince) t = stopTask(t, now);
  return Object.assign({}, t, { done: !!done, doneAt: done ? toIso(now) : null });
}
