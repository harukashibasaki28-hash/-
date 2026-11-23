import test from 'node:test';
import assert from 'node:assert/strict';
import { dayCompletion, minAchievement, estimateRatio, averageStartDelay, bedLateMin, stddev, bedMinutesFrom18, weekSummary, daySummary } from '../src/core/stats.js';

test('完了率：0 件は null、全完了は 1、端数は小数第 2 位', () => {
  assert.deepEqual(dayCompletion([]), { planned: 0, done: 0, rate: null });
  assert.equal(dayCompletion([{ done: true }, { done: true }]).rate, 1);
  assert.equal(dayCompletion([{ done: true }, { done: false }, { done: false }]).rate, 0.33);
  assert.equal(dayCompletion([{ done: true }, { done: false, deleted: true }]).rate, 1, '削除済みは除く');
});

test('繰越されたタスクは、元の日では未完了・今日の分として予定に数える', () => {
  const orig = [{ id: 'a', done: false, carriedTo: '2026-11-23' }, { id: 'b', done: true }];
  assert.equal(dayCompletion(orig).rate, 0.5);
});

test('【min】の達成数', () => {
  const r = minAchievement([{ tag: 'min', done: true }, { tag: 'min', done: false, title: 'x' }, { tag: 'A', done: true }]);
  assert.equal(r.done, 1); assert.equal(r.total, 2); assert.equal(r.missing.length, 1);
});

test('見積と実績の倍率（実績のある完了タスクのみ）', () => {
  const r = estimateRatio([{ done: true, est: 30, actualMin: 45 }, { done: true, est: 30, actualMin: 33 }, { done: false, est: 60, actualMin: 10 }, { done: true, est: 20, actualMin: 0 }]);
  assert.equal(r.ratio, 1.3); assert.equal(r.samples, 2);
});

test('予定開始との平均ずれ', () => {
  const r = averageStartDelay([
    { start: '10:00', sessions: [{ start: '2026-11-23T10:20:00+09:00' }] },
    { start: '14:00', sessions: [{ start: '2026-11-23T14:30:00+09:00' }, { start: '2026-11-23T13:50:00+09:00' }] },
    { start: null, sessions: [{ start: '2026-11-23T09:00:00+09:00' }] },
  ]);
  assert.equal(r.avg, 5); assert.equal(r.samples, 2);
});

test('就寝の遅れ（24 時またぎ）', () => {
  assert.equal(bedLateMin('2026-11-23T01:00:00+09:00', '24:00'), 60);
  assert.equal(bedLateMin('2026-11-22T23:30:00+09:00', '24:00'), -30);
});

test('就寝時刻の標準偏差は 24 時をまたいでも正しい', () => {
  const xs = ['2026-11-22T23:00:00+09:00', '2026-11-24T01:00:00+09:00'].map(bedMinutesFrom18);
  assert.equal(stddev(xs), 60);
});

test('1 日のまとめと週のまとめ', () => {
  const days = {
    '2026-11-23': { sleep: { bed: '2026-11-22T23:00:00+09:00', min: 420 }, naps: [{ min: 20 }], tasks: [{ done: true }, { done: false }] },
    '2026-11-24': { sleep: { bed: '2026-11-24T01:00:00+09:00', min: 360 }, naps: [], tasks: [{ done: true }] },
  };
  const s = daySummary(days['2026-11-23']);
  assert.equal(s.napCount, 1); assert.equal(s.rate, 0.5);
  const w = weekSummary(days, '2026-11-29', '24:00');
  assert.equal(w.avgSleepMin, 390);
  assert.equal(w.bedStdMin, 60);
  assert.equal(w.lateBedDays, 1);
  assert.equal(w.rows.length, 7);
});
