import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { buildGas } from '../tools/build-gas.mjs';
import { buildDay } from '../src/core/dayBuild.js';

const code = buildGas();

test('GAS 用ファイルに import / export が残っていない', () => {
  assert.ok(!/^\s*import\s/m.test(code));
  assert.ok(!/^\s*export\s/m.test(code));
});

test('GAS 用ファイルがそのまま実行でき、アプリと同じ計算結果になる', () => {
  const ctx = vm.createContext({ console });
  vm.runInContext(code, ctx);
  for (const fn of ['doPost', 'doGet', 'setup', 'nextDayJob', 'gmailJob', 'minCheckJob', 'watchdog', 'handleSync', 'handleCalendar', 'buildDay', 'extractDates']) {
    assert.equal(typeof vm.runInContext('typeof ' + fn, ctx), 'string');
    assert.equal(vm.runInContext('typeof ' + fn, ctx), 'function', fn + ' がない');
  }
  const input = {
    templates: [{ id: 'nikkei', title: '日経4ニュース【A】', est: 20 }],
    subjects: [{ id: 'e4002', name: 'ビジネス英単語4002', tag: 'min', est: 30, perDay: 1,
      structure: { outer: { format: 'Stage {n}', count: 40 }, inner: { labels: ['前半', '後半'] } }, doneBefore: 'Stage 12-前半' }],
    tasksAll: [], links: [], mode: 'actual',
  };
  ctx.__in = JSON.parse(JSON.stringify(input));
  const gasOut = JSON.parse(vm.runInContext('JSON.stringify(buildDay("2026-11-23", __in))', ctx));
  const appOut = JSON.parse(JSON.stringify(buildDay('2026-11-23', input)));
  assert.deepEqual(gasOut.create.map((t) => t.id), appOut.create.map((t) => t.id));
  assert.deepEqual(gasOut.create.map((t) => t.title), ['日経4ニュース【A】', 'ビジネス英単語4002 Stage 12 後半【min】']);
});

test('コミット済みの dist/gas/Code.gs が最新（npm run build:gas を忘れていない）', () => {
  assert.equal(readFileSync(new URL('../dist/gas/Code.gs', import.meta.url), 'utf8'), code);
});
