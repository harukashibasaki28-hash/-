import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonText, normalizeImport, previewImport, buildExport, ImportError } from '../src/model/importExport.js';
import { importToRecords, buildView } from '../src/model/records.js';

const legacy = {
  'days/2026-11-21': {
    tasks: [
      { id: 'qi3k4al0w7o0', title: 'ビジネス英単語4002 Stage 12 後半【min】', done: false, doneAt: null, priority: 1, est: 30,
        actualMin: 0, sessions: [], runningSince: null, deadline: null, start: '14:25', carryCount: 0, carriedFrom: null },
      { id: 'askiz7myhu5k', title: '日経新聞 4ニュース【A】', done: true, doneAt: '2026-11-21T08:10:00+09:00', priority: 2, est: 20,
        actualMin: 25, sessions: [{ start: '2026-11-21T07:45:00+09:00', end: '2026-11-21T08:10:00+09:00', min: 25 }] },
    ],
    sleep: { bed: '2026-11-21T00:40:00+09:00', wake: '2026-11-21T07:10:00+09:00', min: 390 },
    naps: [{ start: '2026-11-21T13:00:00+09:00', end: '2026-11-21T13:25:00+09:00' }],
    note: 'メモ', closed: true, planned: 2, done: 1, rate: 50, review: 'ふりかえり',
  },
  'hourensou/h1': { to: '人事', what: '書類提出', kind: '報告', due: '2026-11-25', done: false },
};

test('今の手帳のキー形式（days/… hourensou/…）を読み込める', () => {
  const d = normalizeImport(legacy);
  assert.deepEqual(Object.keys(d.days), ['2026-11-21']);
  const day = d.days['2026-11-21'];
  assert.equal(day.tasks.length, 2);
  assert.equal(day.tasks[0].tag, 'min');
  assert.equal(day.tasks[1].tag, 'A');
  assert.equal(day.tasks[1].actualMin, 25);
  assert.equal(day.naps[0].min, 25, '昼寝の min が無ければ計算する');
  assert.equal(day.rate, 0.5, '百分率の rate は 0〜1 に直す');
  assert.equal(d.hourensou.h1.kind, '報告');
});

test('書き出し形式 → 読み込み → 書き出し で内容が保たれる', () => {
  const d = normalizeImport(legacy);
  const recs = importToRecords(d);
  const view = buildView(recs, { settings: {}, fixedEvents: [], rules: [], links: [] });
  const out = buildExport(view, '2026-11-22T00:00:00+09:00');
  const again = normalizeImport(JSON.parse(JSON.stringify(out)));
  assert.equal(again.days['2026-11-21'].tasks.length, 2);
  assert.equal(again.days['2026-11-21'].sleep.min, 390);
  assert.equal(again.hourensou.h1.what, '書類提出');
});

test('一部分だけ（days だけ）でも読み込める。欠けた項目は補う', () => {
  const d = normalizeImport({ days: { '2026-11-20': { tasks: [{ title: '買い物' }] } } });
  const t = d.days['2026-11-20'].tasks[0];
  assert.ok(t.id);
  assert.equal(t.done, false);
  assert.equal(t.priority, 2);
  assert.deepEqual(t.sessions, []);
  assert.equal(d.days['2026-11-20'].closed, false);
});

test('sleep の min が無ければ bed と wake から計算する', () => {
  const d = normalizeImport({ days: { '2026-11-20': { sleep: { bed: '2026-11-19T23:30:00+09:00', wake: '2026-11-20T06:00:00+09:00' } } } });
  assert.equal(d.days['2026-11-20'].sleep.min, 390);
});

test('壊れた JSON・中身の無い JSON は分かりやすいエラー', () => {
  assert.throws(() => parseJsonText('{days:'), ImportError);
  assert.throws(() => parseJsonText('[]'), ImportError);
  assert.throws(() => parseJsonText('{"foo":1}'), ImportError);
});

test('日付の形が違うキーは読み飛ばして警告', () => {
  const d = normalizeImport({ days: { '11/20': {}, '2026-11-20': {} } });
  assert.equal(Object.keys(d.days).length, 1);
  assert.equal(d.warnings.length, 1);
});

test('プレビューの件数', () => {
  const p = previewImport(normalizeImport(legacy));
  assert.equal(p.days, 1); assert.equal(p.tasks, 2); assert.equal(p.hourensou, 1);
});
