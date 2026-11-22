import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline } from '../src/core/scheduler.js';
import { computeRatios, factorFor } from '../src/core/estimates.js';
import { hmToMin } from '../src/core/dates.js';

const settings = {
  planStart: '07:00', planEnd: '23:30', bufferRatio: 0.25, defaultEstFactor: 1.3, focusPeriod: 'afternoon',
  meals: [{ label: '昼食', start: '12:00', min: 60 }, { label: '夕食', start: '19:00', min: 60 }],
  breakEveryMin: 90, breakMin: 10, travelMinAroundFixed: 30,
};
const fixed = [{ weekday: 1, start: '10:30', end: '12:00', title: '英語スピーキング' }];
const T = (id, est, extra) => Object.assign({ id, title: id, est, priority: 2, done: false }, extra);

test('見積の 1.3 倍で配置し、固定予定・移動・食事を避ける', () => {
  const r = buildTimeline({ date: '2026-11-23', tasks: [T('a', 30)], settings, fixedEvents: fixed });
  assert.equal(r.placements[0].dur, 40);
  assert.equal(r.placements[0].factor, 1.3);
  assert.ok(r.blocks.some((b) => b.kind === 'travel' && b.start === '10:00'));
  for (const p of r.placements) {
    const s = hmToMin(p.start), e = hmToMin(p.end);
    for (const b of r.blocks) assert.ok(e <= hmToMin(b.start) || s >= hmToMin(b.end), p.start + ' と ' + b.title + ' が重なる');
  }
});

test('空き時間の 75% まで。入らない分は後ろ倒し候補（理由付き）', () => {
  const tasks = [];
  for (let i = 0; i < 20; i++) tasks.push(T('t' + i, 60));
  const r = buildTimeline({ date: '2026-11-24', tasks, settings, fixedEvents: fixed });
  assert.ok(r.stats.usedMin <= r.stats.capacityMin);
  assert.equal(r.stats.capacityMin, Math.floor(r.stats.freeMin * 0.75));
  assert.ok(r.deferred.length > 0);
  assert.match(r.deferred[0].reason, /バッファ/);
});

test('締切が近い → 優先度が高い の順に先に配置', () => {
  const tasks = [T('low', 30, { priority: 3 }), T('high', 30, { priority: 1 }), T('due', 30, { priority: 3, deadline: '2026-11-24' })];
  const r = buildTimeline({ date: '2026-11-24', tasks, settings: Object.assign({}, settings, { bufferRatio: 0.95 }), fixedEvents: [] });
  // バッファが大きく 1 件しか入らない → 締切のあるものが入る
  assert.deepEqual(r.placements.map((p) => p.taskId), ['due']);
});

test('重いタスクは午後、軽いタスクは隙間に入る', () => {
  const tasks = [T('heavy', 60), T('light', 10)];
  const r = buildTimeline({ date: '2026-11-23', tasks, settings, fixedEvents: fixed });
  const heavy = r.placements.find((p) => p.taskId === 'heavy');
  assert.ok(hmToMin(heavy.start) >= 12 * 60, '重いものは午後: ' + heavy.start);
  const light = r.placements.find((p) => p.taskId === 'light');
  // 一番短い隙間は 9:55〜10:00 ではなく、7:00〜10:00 / 12:30… のうち最小のもの
  assert.ok(light);
});

test('90 分続いたら 10 分休憩を入れる', () => {
  const tasks = [T('a', 50), T('b', 50), T('c', 50)];
  const r = buildTimeline({ date: '2026-11-24', tasks, settings: Object.assign({}, settings, { meals: [] }), fixedEvents: [] });
  assert.ok(r.breaks.length >= 1);
});

test('時間割で時刻が決まっているタスクは動かさず、その時間を避ける', () => {
  const tasks = [T('fp', 45, { fixedTime: true, start: '13:30', slotMin: 150 }), T('x', 60)];
  const r = buildTimeline({ date: '2026-11-24', tasks, settings, fixedEvents: [] });
  assert.ok(!r.placements.some((p) => p.taskId === 'fp'));
  const x = r.placements.find((p) => p.taskId === 'x');
  assert.ok(hmToMin(x.end) <= 13 * 60 + 30 || hmToMin(x.start) >= 16 * 60);
});

test('過去の実績倍率があればそれを使う（同じ種類 2 件以上）', () => {
  const hist = [
    { templateId: 'nikkei', done: true, est: 20, actualMin: 30, date: '2026-11-20' },
    { templateId: 'nikkei', done: true, est: 20, actualMin: 30, date: '2026-11-21' },
  ];
  const ratios = computeRatios(hist, '2026-11-22', 28);
  assert.deepEqual(factorFor({ templateId: 'nikkei' }, ratios, 1.3), { factor: 1.5, source: 'task' });
  assert.deepEqual(factorFor({ templateId: 'other' }, ratios, 1.3), { factor: 1.3, source: 'default' });
  const r = buildTimeline({ date: '2026-11-24', tasks: [T('n', 20, { templateId: 'nikkei' })], settings, fixedEvents: [], ratios });
  assert.equal(r.placements[0].dur, 30);
});

test('今日の途中から作り直すときは今の時刻より後に置く', () => {
  const r = buildTimeline({ date: '2026-11-24', tasks: [T('a', 30)], settings, fixedEvents: [], startMin: 15 * 60 + 2 });
  assert.ok(hmToMin(r.placements[0].start) >= 15 * 60 + 5);
});
