import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planSrs, srsState, srsOverview } from '../src/core/srs.js';
import { computeCarryover } from '../src/core/carryover.js';
import { buildDay } from '../src/core/dayBuild.js';
import { planStudyDay, expandUnits } from '../src/core/study.js';
import { buildTimeline } from '../src/core/scheduler.js';

const defaults = JSON.parse(readFileSync(new URL('../config/defaults.json', import.meta.url)));
const sub = (id) => JSON.parse(JSON.stringify(defaults.subjects.find((s) => s.id === id)));

test('金フレ 11/23：遅れている 101〜200・supplement5 を×印で、2周目の 301〜400 を全語で（3ブロック・40分以内）', () => {
  const t = planSrs(sub('kinfre'), [], '2026-11-23', 'actual');
  assert.deepEqual(t.srsBlocks, [{ key: '101-200', mode: 'x' }, { key: 'sup5', mode: 'x' }, { key: '301-400', mode: 'all' }]);
  assert.equal(t.title, '金フレ 本編 101〜200（×印）・supplement5 定型表現（×印）・本編 301〜400（全語）【min】');
  assert.ok(t.est <= 40);
  assert.equal(t.tag, 'min');
  assert.equal(t.id, 'srs:kinfre:2026-11-23');
});

test('やったブロックは学習回数が増え、次の復習日が決まる（2回→3日後、全語→2周目済）', () => {
  const s = sub('kinfre');
  const t = Object.assign(planSrs(s, [], '2026-11-23', 'actual'), { done: true, doneAt: '2026-11-23T08:00:00+09:00' });
  const st = srsState(s, [t], '2026-11-24', 'actual');
  assert.equal(st['101-200'].count, 3);
  assert.equal(st['101-200'].due, '2026-11-30', '3回目→7日後');
  assert.equal(st['301-400'].round2, true);
  assert.equal(st['301-400'].count, 2);
  assert.equal(st['301-400'].due, '2026-11-26', '2回目→3日後');
  const next = planSrs(s, [t], '2026-11-24', 'actual');
  assert.deepEqual(next.srsBlocks.map((b) => b.key), ['201-300', 'sup1'], '翌日は残りの遅れ 201〜300 と、2周目の次 supplement1');
});

test('チェックを外したブロックは数えない', () => {
  const s = sub('kinfre');
  const t = Object.assign(planSrs(s, [], '2026-11-23', 'actual'), { done: true, srsDone: ['301-400'] });
  const st = srsState(s, [t], '2026-11-24', 'actual');
  assert.equal(st['101-200'].count, 2);
  assert.equal(st['301-400'].count, 2);
});

test('2周目が全部終わって復習日も来ていない日でも、毎日必ず1件（近い復習日のブロックで補う）', () => {
  const s = sub('kinfre');
  for (const k of Object.keys(s.initial)) s.initial[k] = { count: 4, last: '2026-11-22', round2: true };
  const t = planSrs(s, [], '2026-11-23', 'actual');
  assert.equal(t.srsBlocks.length, 2);
  assert.ok(t.srsBlocks.every((b) => b.mode === 'x'));
});

test('金フレは繰り越さない（翌日に選び直す）', () => {
  const t = planSrs(sub('kinfre'), [], '2026-11-23', 'actual');
  const r = computeCarryover({ '2026-11-23': { tasks: [t] } }, '2026-11-24');
  assert.equal(r.newTasks.length, 0);
});

test('21:50 に作った翌日の金フレは、日付が変わったら実際の結果で選び直す', () => {
  const s = sub('kinfre');
  const today = planSrs(s, [], '2026-11-23', 'actual');
  const tomorrowOpt = planSrs(s, [today], '2026-11-24', 'optimistic');
  // 実際には今日の分をやらなかった
  const r = buildDay('2026-11-24', { templates: [], subjects: [s], tasksAll: [today, tomorrowOpt], links: [], mode: 'actual' });
  assert.equal(r.replace.length, 1);
  assert.deepEqual(r.replace[0].srsBlocks.map((b) => b.key), ['101-200', 'sup5', '301-400']);
});

test('学習画面の一覧：遅れ・今日・済・まだ', () => {
  const rows = srsOverview(sub('kinfre'), [], '2026-11-23');
  const by = (k) => rows.find((r) => r.key === k);
  assert.equal(by('101-200').status, 'late');
  assert.equal(by('201-300').status, 'late');
  assert.equal(by('1-100').status, 'ok');
  assert.equal(by('301-400').status, 'todo');
  assert.match(by('301-400').next, /1番目/);
});

test('英語講座：発音第8回 → リスニング第1〜12回 → VERSANT 映像1回＋英会話2回のセット', () => {
  const s = sub('eng');
  const u = expandUnits(s).filter((x) => !x.milestone);
  const after = u.slice(u.findIndex((x) => x.key === s.doneBefore) + 1);
  assert.equal(after[0].title, '英語講座 STEP1 英語発音上達講座 第8回');
  assert.equal(after[1].title, '英語講座 STEP2 ビジネス英語リスニング講座 第1回');
  assert.equal(after[1].est, 60);
  assert.deepEqual(after.slice(13, 17).map((x) => x.title.replace('英語講座 STEP3 ', '')), ['VERSANT準拠スピーキング講座 映像 第1回', 'VERSANT オンライン英会話 第1回', 'VERSANT オンライン英会話 第2回', 'VERSANT準拠スピーキング講座 映像 第2回']);
  const p = planStudyDay(s, [], '2026-11-23', 'actual');
  assert.deepEqual(p.generate.map((t) => t.title), ['英語講座 STEP1 英語発音上達講座 第8回【min】'], '1日1回分');
  assert.equal(planStudyDay(s, [], '2026-11-28', 'actual').generate.length, 0, '土日は予備日');
});

test('ビジネス講座：英語が STEP2 に入るまで始めない。始まったら 2 日に 1 回、マナー → Office → PM', () => {
  const s = sub('biz');
  assert.equal(planStudyDay(s, [], '2026-11-24', 'actual').generate.length, 0);
  const step1Done = { id: 'stu:eng:STEP1-英語発音上達講座 第8回', subjectId: 'eng', unitKey: 'STEP1-英語発音上達講座 第8回', date: '2026-11-23', done: true, doneAt: '2026-11-23T10:00:00+09:00' };
  const d1 = planStudyDay(s, [step1Done], '2026-11-24', 'actual').generate;
  assert.deepEqual(d1.map((t) => t.title), ['ビジネス講座 ビジネス実務・マナー講座 第1講【A】']);
  const t1 = Object.assign({}, d1[0], { done: true });
  assert.equal(planStudyDay(s, [step1Done, t1], '2026-11-25', 'actual').generate.length, 0, '翌日は休み');
  assert.deepEqual(planStudyDay(s, [step1Done, t1], '2026-11-26', 'actual').generate.map((t) => t.unitKey), ['マナー-ビジネス実務・マナー講座 第2講']);
});

test('時間に入りきらないときは、金フレより先に【A】【任意】を外す', () => {
  const kin = planSrs(sub('kinfre'), [], '2026-11-23', 'actual');
  const tasks = [Object.assign({}, kin, { priority: 2 }), { id: 'a', title: 'x【A】', tag: 'A', est: 20, priority: 2 }];
  const r = buildTimeline({ date: '2026-11-24', tasks, settings: { planStart: '07:00', planEnd: '08:00', bufferRatio: 0.25, meals: [] }, fixedEvents: [] });
  assert.deepEqual(r.placements.map((p) => p.taskId), [kin.id]);
  assert.equal(r.deferred[0].taskId, 'a');
});
