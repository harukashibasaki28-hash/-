// ルールが参照する指標。新しい指標はここに 1 つ足すだけでルールから使える
import { parseIso, minOfDay, hmToMin, formatHm } from '../core/dates.js';
import { daySummary, bedLateMin, minAchievement } from '../core/stats.js';

// 使える指標の一覧（設定画面に表示）
export const METRIC_DOCS = {
  day: {
    sleepMin: '睡眠時間（分）', bedLateMin: '就寝が目標より何分遅いか', wakeHour: '起床時刻（時、7.5=7:30）',
    napCount: '昼寝の回数', napTotalMin: '昼寝の合計（分）', completionRate: '完了率（%）',
    minDone: '【min】完了数', minTotal: '【min】の数', minMissing: '【min】未完了数',
    ratio: '見積と実績の倍率', startDelay: '予定開始との平均ずれ（分）',
    morningTasksUntouched: '午前に予定していて未着手のタスク数', tasks: 'タスク数',
  },
  task: { carryCount: '繰越回数', est: '見積（分）', actualMin: '実績（分）', actualRatio: '実績÷見積', priority: '優先度' },
  estimate: { actualRatio: '直近の実績倍率（同じ種類のタスク）', samples: '件数', est: '今の見積', newEst: '増やした後の見積' },
};

export function dayMetrics(day, settings) {
  const s = daySummary(day || {});
  const tasks = ((day && day.tasks) || []).filter((t) => !t.deleted);
  const wake = s.wake ? parseIso(s.wake) : null;
  const mn = minAchievement(tasks);
  return {
    sleepMin: s.sleepMin,
    bedLateMin: s.bed ? bedLateMin(s.bed, settings.bedTarget) : null,
    wakeHour: wake ? Math.round((minOfDay(wake) / 60) * 100) / 100 : null,
    wakeTime: s.wake ? formatHm(s.wake) : null,
    napCount: s.napCount, napTotalMin: s.napMin,
    completionRate: s.rate == null ? null : Math.round(s.rate * 100),
    minDone: mn.done, minTotal: mn.total, minMissing: mn.total - mn.done,
    ratio: s.ratio, startDelay: s.startDelay,
    morningTasksUntouched: tasks.filter((t) => t.start && hmToMin(t.start) < 720 && !t.done && !(t.sessions && t.sessions.length)).length,
    tasks: tasks.length,
  };
}

export function taskMetrics(t) {
  return {
    title: t.title, carryCount: t.carryCount || 0, est: t.est || 0, actualMin: t.actualMin || 0, priority: t.priority,
    actualRatio: t.done && t.est > 0 && t.actualMin > 0 ? Math.round((t.actualMin / t.est) * 100) / 100 : null,
  };
}
