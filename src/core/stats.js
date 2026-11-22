// 集計：完了率・【min】達成・倍率・平均ずれ・睡眠・週の振り返り
import { parseIso, minOfDay, hmToMin, addDays, weekday } from './dates.js';

function round2(x) { return Math.round(x * 100) / 100; }

// 完了率。planned＝その日のタスク数（削除済みを除く）、done＝完了数
export function dayCompletion(tasks) {
  const list = (tasks || []).filter((t) => !t.deleted);
  const planned = list.length;
  const done = list.filter((t) => t.done).length;
  return { planned: planned, done: done, rate: planned ? round2(done / planned) : null };
}

export function minAchievement(tasks) {
  const mins = (tasks || []).filter((t) => !t.deleted && t.tag === 'min');
  return { done: mins.filter((t) => t.done).length, total: mins.length, missing: mins.filter((t) => !t.done) };
}

// 見積と実績の倍率（実績が記録された完了タスクのみ）
export function estimateRatio(tasks) {
  let est = 0, act = 0, n = 0;
  for (const t of tasks || []) {
    if (t.deleted || !t.done) continue;
    if (!(t.est > 0) || !(t.actualMin > 0)) continue;
    est += t.est; act += t.actualMin; n++;
  }
  return n ? { ratio: round2(act / est), samples: n, estMin: est, actualMin: act } : { ratio: null, samples: 0, estMin: 0, actualMin: 0 };
}

// 予定開始（start 'HH:MM'）と、実際に最初に開始した時刻のずれの平均（分、遅れが正）
export function averageStartDelay(tasks) {
  const diffs = [];
  for (const t of tasks || []) {
    if (t.deleted || !t.start || !t.sessions || !t.sessions.length) continue;
    const planned = hmToMin(t.start);
    const first = t.sessions.map((s) => parseIso(s.start)).filter(Boolean).sort((a, b) => a - b)[0];
    if (planned == null || !first) continue;
    diffs.push(minOfDay(first) - planned);
  }
  if (!diffs.length) return { avg: null, samples: 0 };
  return { avg: Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length), samples: diffs.length };
}

// 就寝時刻を「18:00 からの分」に直す（24 時またぎでも連続した値になる）
export function bedMinutesFrom18(iso) {
  const d = parseIso(iso);
  if (!d) return null;
  return (minOfDay(d) - 18 * 60 + 1440) % 1440;
}

// 目標就寝時刻との差（分。遅いほど正）
export function bedLateMin(iso, target) {
  const b = bedMinutesFrom18(iso);
  if (b == null) return null;
  const t = ((hmToMin(target || '24:00') - 18 * 60) + 1440) % 1440;
  return Math.round(b - t);
}

export function mean(xs) {
  const v = xs.filter((x) => x != null && !isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

// 母標準偏差
export function stddev(xs) {
  const v = xs.filter((x) => x != null && !isNaN(x));
  if (v.length < 2) return v.length ? 0 : null;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, x) => a + (x - m) * (x - m), 0) / v.length);
}

// 1 日分のまとめ（今日の進捗・ログ表で使う）
export function daySummary(day) {
  const tasks = (day && day.tasks) || [];
  const naps = (day && day.naps) || [];
  let napMin = 0;
  for (const n of naps) napMin += Number(n.min) || 0;
  const c = dayCompletion(tasks);
  const mn = minAchievement(tasks);
  return {
    sleepMin: day && day.sleep ? (day.sleep.min || null) : null,
    bed: day && day.sleep ? day.sleep.bed : null,
    wake: day && day.sleep ? day.sleep.wake : null,
    napCount: naps.length, napMin: napMin,
    planned: c.planned, done: c.done, rate: c.rate,
    minDone: mn.done, minTotal: mn.total,
    ratio: estimateRatio(tasks).ratio,
    startDelay: averageStartDelay(tasks).avg,
  };
}

// 週（月〜日）の振り返り。endDk はその週の日曜
export function weekSummary(days, endDk, bedTarget) {
  const keys = [];
  for (let i = 6; i >= 0; i--) keys.push(addDays(endDk, -i));
  const rows = keys.map((k) => Object.assign({ date: k }, daySummary(days[k])));
  const beds = rows.map((r) => bedMinutesFrom18(r.bed)).filter((x) => x != null);
  const avgBed = mean(beds);
  return {
    from: keys[0], to: endDk, rows: rows,
    avgSleepMin: mean(rows.map((r) => r.sleepMin)) == null ? null : Math.round(mean(rows.map((r) => r.sleepMin))),
    bedStdMin: stddev(beds) == null ? null : Math.round(stddev(beds)),
    avgBedMin: avgBed == null ? null : Math.round((avgBed + 18 * 60) % 1440),
    avgRate: mean(rows.map((r) => r.rate)),
    lateBedDays: rows.filter((r) => r.bed && bedLateMin(r.bed, bedTarget) >= 60).length,
  };
}

// 直近の日曜（今日が日曜なら今日）
export function lastSunday(dk) {
  return addDays(dk, -weekday(dk));
}
