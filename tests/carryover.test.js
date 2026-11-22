import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCarryover } from '../src/core/carryover.js';
import { templateTasksFor } from '../src/core/tasks.js';

const T = (id, extra) => Object.assign({ id, title: id, done: false, sessions: [], actualMin: 0, carryCount: 0, carriedFrom: null }, extra);

test('前日の未完了を今日へコピー（carryCount+1・carriedFrom）し、前日を closed に', () => {
  const days = {
    '2026-11-22': { tasks: [T('a'), T('b', { done: true }), T('c', { carryCount: 2, start: '10:00', sessions: [{ min: 10 }], actualMin: 10 })] },
  };
  const r = computeCarryover(days, '2026-11-23');
  assert.deepEqual(r.newTasks.map((t) => t.id), ['a@2026-11-23', 'c@2026-11-23']);
  const c = r.newTasks[1];
  assert.equal(c.carryCount, 3);
  assert.equal(c.carriedFrom, '2026-11-22');
  assert.equal(c.date, '2026-11-23');
  assert.equal(c.start, null, '予定時刻はリセット');
  assert.deepEqual(c.sessions, [], '計測はリセット');
  assert.equal(c.actualMin, 0);
  assert.deepEqual(r.closedDays['2026-11-22'], { planned: 3, done: 1, rate: 0.33 });
  assert.equal(r.updatedTasks, undefined, '元のタスクは書き換えない（別端末の完了を上書きしないため）');
});

test('複数日分の未完了（数日アプリを開かなかった）をすべて今日へ', () => {
  const days = { '2026-11-20': { tasks: [T('x')] }, '2026-11-21': { tasks: [T('y')] }, '2026-11-22': { tasks: [] } };
  const r = computeCarryover(days, '2026-11-23');
  assert.deepEqual(r.newTasks.map((t) => t.id).sort(), ['x@2026-11-23', 'y@2026-11-23']);
  assert.deepEqual(Object.keys(r.closedDays).sort(), ['2026-11-20', '2026-11-21', '2026-11-22']);
  assert.equal(r.closedDays['2026-11-22'].rate, null, 'タスク 0 件の日の完了率は null');
});

test('closed の日・今日・未来の日は対象外', () => {
  const days = { '2026-11-21': { closed: true, tasks: [T('old')] }, '2026-11-23': { tasks: [T('today')] }, '2026-11-24': { tasks: [T('f')] } };
  const r = computeCarryover(days, '2026-11-23');
  assert.equal(r.newTasks.length, 0);
  assert.deepEqual(Object.keys(r.closedDays), []);
});

test('2 台で実行しても同じ ID になり、二重にコピーしない', () => {
  const days = { '2026-11-22': { tasks: [T('a')] }, '2026-11-23': { tasks: [T('a@2026-11-23', { carryCount: 1 })] } };
  const r = computeCarryover(days, '2026-11-23');
  assert.equal(r.newTasks.length, 0);
});

test('繰越の繰越でも ID が伸びない', () => {
  const days = { '2026-11-23': { tasks: [T('a@2026-11-23', { carryCount: 1, carriedFrom: '2026-11-22' })] } };
  const r = computeCarryover(days, '2026-11-24');
  assert.equal(r.newTasks[0].id, 'a@2026-11-24');
  assert.equal(r.newTasks[0].carryCount, 2);
  assert.equal(r.newTasks[0].carriedFrom, '2026-11-23');
});

test('すでに繰越済み（後の日に繰越コピーがある）・削除済みは繰越さない', () => {
  const days = { '2026-11-22': { tasks: [T('a'), T('d', { deleted: true })] }, '2026-11-23': { closed: true, tasks: [T('a@2026-11-23', { done: true })] } };
  const r = computeCarryover(days, '2026-11-24');
  assert.equal(r.newTasks.length, 0);
  assert.equal(r.closedDays['2026-11-22'].planned, 1, '削除済みは予定数に数えない');
});

test('毎日のタスク：繰越されてきた同じテンプレートがあれば作らない', () => {
  const templates = [{ id: 'nikkei', title: '日経4ニュース【A】', est: 20 }, { id: 'eng', title: '英語学習1講座【min】', est: 30 }];
  const existing = [T('tpl:nikkei:2026-11-22@2026-11-23', { templateId: 'nikkei', carryCount: 1 })];
  const out = templateTasksFor('2026-11-23', templates, existing, 1);
  assert.deepEqual(out.map((t) => t.id), ['tpl:eng:2026-11-23']);
  assert.equal(out[0].tag, 'min');
  assert.equal(templateTasksFor('2026-11-23', templates, existing.concat(out), 1).length, 0, '2 回目は何も作らない');
});

test('曜日指定・無効のテンプレート', () => {
  const templates = [{ id: 'w', title: '月曜だけ', weekdays: [1] }, { id: 'off', title: '停止中', active: false }];
  assert.equal(templateTasksFor('2026-11-23', templates, [], 1).length, 1);
  assert.equal(templateTasksFor('2026-11-24', templates, [], 2).length, 0);
});

test('削った繰越コピーがあれば、元のタスクはもう繰越さない', () => {
  const days = { '2026-11-22': { tasks: [T('a')] } };
  const r = computeCarryover(days, '2026-11-24', [{ id: 'a@2026-11-23', date: '2026-11-23' }]);
  assert.equal(r.newTasks.length, 0);
});
