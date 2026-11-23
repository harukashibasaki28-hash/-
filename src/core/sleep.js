// 睡眠・昼寝の記録
// 夜の睡眠は「起床した日」、昼寝は「開始した日」に記録する。
import { dateKey, toIso, minutesBetween, parseIso } from './dates.js';

// state: { sleepingSince, nappingSince }（スマホと PC で共有する状態）
export function startSleep(state, now) {
  if (state.sleepingSince) return { state, error: 'すでに「寝る」を記録しています' };
  return { state: Object.assign({}, state, { sleepingSince: toIso(now), nappingSince: null }) };
}

// 起きた → 起床日の sleep を返す
export function endSleep(state, now) {
  if (!state.sleepingSince) return { state, error: '「寝る」が記録されていません' };
  const bed = state.sleepingSince;
  const wake = toIso(now);
  return {
    state: Object.assign({}, state, { sleepingSince: null }),
    date: dateKey(now),
    sleep: { bed: bed, wake: wake, min: minutesBetween(bed, wake) },
  };
}

export function startNap(state, now) {
  if (state.nappingSince) return { state, error: 'すでに昼寝中です' };
  if (state.sleepingSince) return { state, error: '睡眠中です' };
  return { state: Object.assign({}, state, { nappingSince: toIso(now) }) };
}

// 昼寝から起きた → 開始日の naps に追加する 1 件を返す
export function endNap(state, now) {
  if (!state.nappingSince) return { state, error: '昼寝が記録されていません' };
  const start = state.nappingSince;
  return {
    state: Object.assign({}, state, { nappingSince: null }),
    date: dateKey(parseIso(start)),
    nap: { start: start, end: toIso(now), min: minutesBetween(start, toIso(now)) },
  };
}

// 時刻を手で直したときの再計算
export function recalcSleep(sleep) {
  if (!sleep) return sleep;
  const o = Object.assign({}, sleep);
  if (o.bed && o.wake) o.min = minutesBetween(o.bed, o.wake);
  return o;
}

export function recalcNap(nap) {
  const o = Object.assign({}, nap);
  if (o.start && o.end) o.min = minutesBetween(o.start, o.end);
  return o;
}

export function napSummary(naps) {
  const list = naps || [];
  let total = 0;
  for (const n of list) total += Number(n.min) || 0;
  return { count: list.length, totalMin: total };
}
