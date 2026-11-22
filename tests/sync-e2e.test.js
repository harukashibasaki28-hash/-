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
