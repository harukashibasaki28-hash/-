import test from 'node:test';
import assert from 'node:assert/strict';
import { startSleep, endSleep, startNap, endNap, napSummary, recalcSleep } from '../src/core/sleep.js';
import { parseIso } from '../src/core/dates.js';

const at = (s) => parseIso(s);

test('日付をまたぐ睡眠は起床した日に記録し、分を計算する', () => {
  let r = startSleep({}, at('2026-11-22T23:50:00+09:00'));
  r = endSleep(r.state, at('2026-11-23T06:20:00+09:00'));
  assert.equal(r.date, '2026-11-23');
  assert.equal(r.sleep.min, 390);
  assert.equal(r.sleep.bed, '2026-11-22T23:50:00+09:00');
  assert.equal(r.state.sleepingSince, null);
});

test('0 時を過ぎてから寝ても起床日に記録', () => {
  let r = startSleep({}, at('2026-11-23T01:10:00+09:00'));
  r = endSleep(r.state, at('2026-11-23T07:00:00+09:00'));
  assert.equal(r.date, '2026-11-23');
  assert.equal(r.sleep.min, 350);
});

test('端末のタイムゾーンが違っても東京時間で日付を決める', () => {
  // UTC で 2026-11-22T21:30Z = 東京 11/23 06:30
  let r = startSleep({}, new Date('2026-11-22T14:00:00Z'));
  r = endSleep(r.state, new Date('2026-11-22T21:30:00Z'));
  assert.equal(r.date, '2026-11-23');
  assert.equal(r.sleep.min, 450);
});

test('昼寝は開始した日に記録（日付をまたいでも）', () => {
  let r = startNap({}, at('2026-11-22T23:40:00+09:00'));
  r = endNap(r.state, at('2026-11-23T00:05:00+09:00'));
  assert.equal(r.date, '2026-11-22');
  assert.equal(r.nap.min, 25);
});

test('二重の「寝る」や、寝ていないのに「起きた」はエラー', () => {
  const s = startSleep({}, at('2026-11-22T23:00:00+09:00')).state;
  assert.ok(startSleep(s, at('2026-11-22T23:10:00+09:00')).error);
  assert.ok(endSleep({}, at('2026-11-23T06:00:00+09:00')).error);
  assert.ok(startNap(s, at('2026-11-22T23:10:00+09:00')).error, '睡眠中は昼寝できない');
});

test('昼寝の回数と合計', () => {
  assert.deepEqual(napSummary([{ min: 20 }, { min: 45 }]), { count: 2, totalMin: 65 });
  assert.deepEqual(napSummary([]), { count: 0, totalMin: 0 });
});

test('時刻を手で直したら睡眠時間を再計算', () => {
  const s = recalcSleep({ bed: '2026-11-22T23:00:00+09:00', wake: '2026-11-23T06:30:00+09:00', min: 0 });
  assert.equal(s.min, 450);
});
