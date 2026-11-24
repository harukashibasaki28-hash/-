// スマホと PC の 2 台を、にせものの GAS（中身は本物の Code.gs）につないで動かす
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { makeEnv } from './helpers/gasEnv.js';
import { memoryDb } from '../src/store/localDb.js';
import { Store } from '../src/store/store.js';
import { SyncEngine } from '../src/store/sync.js';
import * as A from '../src/actions.js';
import { parseIso } from '../src/core/dates.js';
import { normalizeImport } from '../src/model/importExport.js';

const defaults = JSON.parse(readFileSync(new URL('../config/defaults.json', import.meta.url)));
const rules = JSON.parse(readFileSync(new URL('../config/rules.json', import.meta.url)));
const KEY = 'k'.repeat(64);

function server() {
  const env = makeEnv();
  const fetch = async (url, init) => {
    const out = vm.runInContext('doPost(' + JSON.stringify({ postData: { contents: init.body } }) + ').s', env.ctx);
    return { ok: true, status: 200, text: async () => out };
  };
  return { env, fetch };
}

async function device(srv, online) {
  const store = new Store(memoryDb(), defaults);
  await store.load();
  const sync = new SyncEngine(store, { fetch: srv.fetch });
  if (online) await store.setMeta('connection', { url: 'https://example/exec', key: KEY });
  return { store, sync };
}

const at = (s) => parseIso(s);

test('オフラインで記録 → つながったら反映 → もう 1 台で同じデータが見える', async () => {
  const srv = server();
  const phone = await device(srv, false);
  await A.seedDefaults(phone.store, defaults, rules);
  await A.runDayStart(phone.store, '2026-11-23', at('2026-11-23T06:30:00+09:00'));
  await A.sleepStart(phone.store, at('2026-11-22T23:50:00+09:00'));
  await A.sleepEnd(phone.store, at('2026-11-23T06:20:00+09:00'));
  const t = await A.addTask(phone.store, '2026-11-23', { title: '書類を出す', priority: 1, est: 15 });
  assert.equal((await phone.sync.sync()).skipped, true, '未設定なら送らない（オフライン扱い）');
  assert.ok(phone.store.outbox.size > 0);

  await phone.store.setMeta('connection', { url: 'https://example/exec', key: KEY });
  const r = await phone.sync.sync();
  assert.equal(r.ok, true, r.error);
  assert.equal(phone.store.outbox.size, 0);

  const pc = await device(srv, true);
  await pc.sync.sync();
  const v = pc.store.view;
  assert.equal(v.days['2026-11-23'].sleep.min, 390);
  assert.ok(v.days['2026-11-23'].tasks.some((x) => x.id === t.id));
  assert.ok(v.days['2026-11-23'].tasks.some((x) => x.title === 'FP2級 CH4 タックスプランニング Sec5【min】'));
  assert.ok(v.days['2026-11-23'].tasks.some((x) => x.title === 'ビジネス英単語4002 Stage 12 後半【min】'));
  assert.equal(v.templates.length, 3);

  await A.toggleDone(pc.store, t.id, true, at('2026-11-23T10:00:00+09:00'));
  await pc.sync.sync();
  await phone.sync.sync();
  assert.equal(phone.store.view.days['2026-11-23'].tasks.find((x) => x.id === t.id).done, true, 'PC で完了 → スマホにも反映');
});

test('スマホで寝る → PC で起きた（状態も共有）', async () => {
  const srv = server();
  const phone = await device(srv, true);
  const pc = await device(srv, true);
  await A.sleepStart(phone.store, at('2026-11-23T23:40:00+09:00'));
  await phone.sync.sync();
  await pc.sync.sync();
  const r = await A.sleepEnd(pc.store, at('2026-11-24T06:10:00+09:00'));
  assert.equal(r.sleep.min, 390);
});

test('日付が変わって 2 台とも繰越を実行しても重複しない', async () => {
  const srv = server();
  const phone = await device(srv, true);
  await A.seedDefaults(phone.store, defaults, rules);
  await A.runDayStart(phone.store, '2026-11-23', at('2026-11-23T07:00:00+09:00'));
  await phone.sync.sync();
  const pc = await device(srv, true);
  await pc.sync.sync();
  await A.runDayStart(phone.store, '2026-11-24', at('2026-11-24T07:00:00+09:00'));
  await A.runDayStart(pc.store, '2026-11-24', at('2026-11-24T07:05:00+09:00'));
  await phone.sync.sync(); await pc.sync.sync(); await phone.sync.sync();
  const a = phone.store.view.days['2026-11-24'].tasks.map((x) => x.id).sort();
  const b = pc.store.view.days['2026-11-24'].tasks.map((x) => x.id).sort();
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length);
  assert.ok(a.some((id) => id.startsWith('tpl:nikkei:2026-11-23@')), '前日の未完了が繰越');
  assert.ok(!a.includes('tpl:nikkei:2026-11-24'), '繰越されたテンプレートは新しく作らない');
  assert.equal(phone.store.view.days['2026-11-23'].closed, true);
  const fp = a.filter((id) => id.startsWith('stu:fp2'));
  assert.deepEqual(fp, ['stu:fp2:CH4-Sec5@2026-11-24'], 'FP は繰越の Sec5 だけ（新しい Sec は足さない）');
});

test('今の手帳の JSON を読み込むと、もう 1 台にも入る', async () => {
  const srv = server();
  const phone = await device(srv, true);
  const data = normalizeImport({
    'days/2026-11-21': { tasks: [{ id: 'abc', title: '日経新聞 4ニュース【A】', done: true, est: 20, actualMin: 25 }], sleep: { bed: '2026-11-21T00:40:00+09:00', wake: '2026-11-21T07:10:00+09:00', min: 390 }, closed: true },
    'hourensou/h1': { to: '人事', what: '書類', kind: '報告', due: '2026-11-25', done: false },
  });
  await A.importData(phone.store, data, 'merge');
  await phone.sync.sync();
  const pc = await device(srv, true);
  await pc.sync.sync();
  assert.equal(pc.store.view.days['2026-11-21'].sleep.min, 390);
  assert.equal(pc.store.view.days['2026-11-21'].tasks[0].id, 'abc');
  assert.equal(pc.store.view.hourensou.h1.kind, '報告');
});

test('学習タスクを完了すると、学習計画シートへの書き戻し（進行中）を予約', async () => {
  const srv = server();
  const phone = await device(srv, false);
  await A.seedDefaults(phone.store, defaults, rules);
  await A.runDayStart(phone.store, '2026-11-23', at('2026-11-23T07:00:00+09:00'));
  await A.toggleDone(phone.store, 'stu:fp2:CH4-Sec5', true, at('2026-11-23T15:00:00+09:00'));
  assert.deepEqual(phone.store.meta.planUpdates, [{ title: 'FP2級：タックスプランニング', progress: '進行中' }]);
});

test('オフラインで繰越したあと、別の端末で元が完了になっていたら繰越コピーを消す', async () => {
  const srv = server();
  const phone = await device(srv, true);
  const t = await A.addTask(phone.store, '2026-11-23', { title: 'X' });
  await phone.sync.sync();
  const pc = await device(srv, true);
  await pc.sync.sync();
  await A.toggleDone(pc.store, t.id, true, at('2026-11-23T23:00:00+09:00'));
  await pc.sync.sync();
  await A.runDayStart(phone.store, '2026-11-24', at('2026-11-24T07:00:00+09:00')); // オフラインのまま繰越
  assert.ok(phone.store.view.days['2026-11-24'].tasks.some((x) => x.id === t.id + '@2026-11-24'));
  await phone.sync.sync();
  await A.cleanupCarried(phone.store, '2026-11-24');
  assert.equal(phone.store.view.allTasks.find((x) => x.id === t.id).done, true, '別端末の完了は上書きされない');
  assert.ok(!(phone.store.view.days['2026-11-24'] || { tasks: [] }).tasks.some((x) => x.id === t.id + '@2026-11-24'));
});

test('すでに使い始めたデータにも、英語講座・金フレ・ビジネス講座が自動で入る（1回だけ）', async () => {
  const srv = server();
  const phone = await device(srv, true);
  const old = JSON.parse(JSON.stringify(defaults));
  old.subjects = old.subjects.filter((s) => ['fp2', 'e4002'].includes(s.id));
  old.templates = old.templates.map((t) => Object.assign({}, t, { active: true }));
  old.links = [{ match: '英語講座', template: 'eng' }];
  await A.seedDefaults(phone.store, old, rules);
  await A.runDayStart(phone.store, '2026-11-23', at('2026-11-23T07:00:00+09:00'));
  assert.ok(phone.store.view.allTasks.some((t) => t.id === 'tpl:eng:2026-11-23'));
  assert.ok((await A.applyMigrations(phone.store, defaults)) >= 1);
  assert.equal(await A.applyMigrations(phone.store, defaults), 0, '2回目は何もしない');
  await A.runDayStart(phone.store, '2026-11-23', at('2026-11-23T07:00:00+09:00'));
  const ids = phone.store.view.days['2026-11-23'].tasks.map((t) => t.id);
  assert.ok(!ids.includes('tpl:eng:2026-11-23'), '英語学習1講座は置き換え');
  assert.ok(ids.includes('stu:eng:STEP1-英語発音上達講座 第8回'));
  assert.ok(ids.includes('srs:kinfre:2026-11-23'));
  assert.equal(phone.store.view.templates.find((t) => t.id === 'eng').active, false);
});

test('自分で登録した vintage・Part7・ChatGPT英会話：時間割の枠に入り、元の日課は作られず、残っていた分も消える', async () => {
  const { buildDay } = await import('../src/core/dayBuild.js');
  const { parseTimetable } = await import('../src/core/planSheet.js');
  const srv = server();
  const phone = await device(srv, false);
  await A.seedDefaults(phone.store, defaults, rules);
  const sub = (id, name, extra) => ({ kind: 'subj', id, data: Object.assign({ name, tag: 'A', status: 'active', est: 30, perDayMode: 'fixed', perDay: 1, studyDays: 'everyday',
    structure: { outer: { format: '第{n}章' }, inner: { format: 'Sec{n}' }, items: [{ n: 1, label: 'x', secs: 20 }] }, milestones: [] }, extra) });
  await phone.store.putMany([
    sub('s-ryyr4l', 'vintage'), sub('s-54jiwj', '世界一わかりやすいTOEICテストの授業【Part7読解】'), sub('s-3rctv0', 'ChatGPT英会話'),
    { kind: 'task', id: 'tpl:gpt:2099-01-05', data: { date: '2099-01-05', title: 'ChatGPT英会話【A】', templateId: 'gpt', source: 'template' } },
    { kind: 'task', id: 'tt:2099-01-05:x', data: { date: '2099-01-05', title: '英語：vintage', source: 'timetable' } },
    { kind: 'task', id: 'old1', data: { date: '2099-01-05', title: '英語：TOEICリーディング（Part7）', source: 'sheet' } },
    { kind: 'task', id: 'keep', data: { date: '2099-01-05', title: 'FP2級 復習（過去問道場）', source: 'timetable' } },
  ]);
  await A.applyMigrations(phone.store, defaults);
  const v = phone.store.view;
  assert.equal(v.templates.find((t) => t.id === 'gpt').active, false, '毎日のタスク ChatGPT英会話 は停止');
  const ids = v.allTasks.map((t) => t.id);
  assert.ok(!ids.includes('tpl:gpt:2099-01-05') && !ids.includes('tt:2099-01-05:x') && !ids.includes('old1'), '元の日課は消える');
  assert.ok(ids.includes('keep'), '関係ないものは残す');
  const links = v.links;
  assert.deepEqual(links.find((l) => /金フレ/.test(l.match)).subjects, ['kinfre', 's-3rctv0']);
  assert.deepEqual(links.find((l) => /vintage/.test(l.match)).subjects, ['s-ryyr4l', 's-54jiwj']);

  const tt = parseTimetable([['曜日', '開始', '終了', '内容', '分類', '期間', '休み・メモ'],
    ['月〜金', '7:30', '8:10', '英語：金フレ＋ChatGPT英会話', '英語', '11/13〜3/12', ''],
    ['月', '16:00', '16:40', '英語：vintage／Part7（隔日交互）', '英語', '11/16〜12/14', '']]);
  const r = buildDay('2026-11-30', { templates: v.templates, subjects: v.subjects, tasksAll: [], links, mode: 'actual', timetableRows: tt });
  const titles = r.create.map((t) => (t.start || '--:--') + ' ' + t.title);
  assert.ok(!titles.some((x) => /英語：vintage|英語：Part7|ChatGPT英会話【A】/.test(x)), titles.join('\n'));
  assert.ok(titles.some((x) => /^16:00 vintage/.test(x)), '16:00 の枠に vintage');
  assert.ok(titles.some((x) => /^16:30 世界一わかりやすい/.test(x)), 'その後に Part7');
  assert.ok(titles.some((x) => /^0[78]:\d\d ChatGPT英会話 第1章/.test(x)), '金フレのあとに ChatGPT英会話（科目）');
});
