// GAS をにせものの Google サービスの上で動かし、同期・翌日作成・書き戻しを確認する
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildGas } from '../tools/build-gas.mjs';

function fakeSheet(name, values) {
  const data = values ? values.map((r) => r.slice()) : [];
  const sh = {
    name, data,
    getName: () => name,
    getLastRow: () => data.length,
    setFrozenRows() {}, setTabColor() {}, setColumnWidth() {}, clear() { data.length = 0; },
    getProtections: () => [], protect: () => ({ setDescription() { return { setWarningOnly() {} }; } }),
    getDataRange: () => sh.getRange(1, 1, data.length, Math.max(...data.map((r) => r.length), 1)),
    getRange(r, c, nr, nc) {
      if (typeof r === 'string') return { setNumberFormat() { return this; }, setFontWeight() { return this; }, setFontSize() { return this; }, setValues() {} };
      nr = nr || 1; nc = nc || 1;
      const rng = {
        getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = data[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] == null ? '' : row[c - 1 + j]); out.push(o); } return out; },
        setValues(vals) { for (let i = 0; i < vals.length; i++) { data[r - 1 + i] = data[r - 1 + i] || []; for (let j = 0; j < vals[i].length; j++) data[r - 1 + i][c - 1 + j] = vals[i][j]; } return rng; },
        setValue(v) { data[r - 1] = data[r - 1] || []; data[r - 1][c - 1] = v; return rng; },
        setNumberFormat() { return rng; }, setFontWeight() { return rng; },
      };
      rng.getDisplayValues = () => rng.getValues().map((row) => row.map(String));
      return rng;
    },
  };
  return sh;
}

function fakeBook(sheets) {
  const list = sheets || [];
  return {
    sheets: list,
    getSheetByName: (n) => list.find((s) => s.name === n) || null,
    insertSheet(n) { const s = fakeSheet(n); list.push(s); return s; },
    getSheets: () => list, deleteSheet() {},
  };
}

function makeEnv(planBook) {
  const props = {};
  const db = fakeBook([]);
  const env = {
    console,
    SpreadsheetApp: { getActive: () => db, openById: () => planBook, ProtectionType: { SHEET: 'SHEET' } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => { const c = {}; return { get: (k) => c[k] || null, put: (k, v) => { c[k] = v; } }; } },
    ContentService: { MimeType: { JSON: 'json', TEXT: 'text' }, createTextOutput: (s) => ({ s, setMimeType() { return this; } }) },
    CalendarApp: { getDefaultCalendar: () => ({ getEventsForDay: () => [] }) },
    Utilities: { formatDate: () => '00:00', getUuid: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => ({ timeBased: () => ({ at: () => ({ create() {} }) }) }) },
  };
  const ctx = vm.createContext(env);
  vm.runInContext(buildGas(), ctx);
  props.API_KEY = 'k'.repeat(64);
  ctx.__db = db;
  return { ctx, props, db };
}

const post = (ctx, body) => JSON.parse(vm.runInContext('doPost(' + JSON.stringify({ postData: { contents: JSON.stringify(body) } }) + ').s', ctx));

test('キーが違うと何も返さない', () => {
  const { ctx } = makeEnv();
  assert.deepEqual(post(ctx, { key: 'x', action: 'sync' }), { ok: false, error: 'unauthorized' });
});

test('同期：送った変更が保存され、別の端末は差分を受け取る。古い変更は上書きしない', () => {
  const { ctx, db } = makeEnv();
  const key = 'k'.repeat(64);
  const r1 = post(ctx, { key, action: 'sync', since: 0, device: 'phone', changes: [
    { kind: 'task', id: 't1', data: { date: '2026-11-23', title: 'A', done: false }, updatedAt: '2026-11-23T10:00:00+09:00' },
    { kind: 'day', id: '2026-11-23', data: { sleep: { bed: 'x', wake: 'y', min: 400 } }, updatedAt: '2026-11-23T10:00:00+09:00' },
  ] });
  assert.equal(r1.ok, true);
  assert.equal(r1.accepted, 2);
  assert.equal(db.getSheetByName('tasks').data[1][0], 't1');
  const r2 = post(ctx, { key, action: 'sync', since: 0, device: 'pc', changes: [
    { kind: 'task', id: 't1', data: { date: '2026-11-23', title: 'OLD', done: false }, updatedAt: '2026-11-23T09:00:00+09:00' },
  ] });
  assert.equal(r2.accepted, 0, '古い変更は採用しない');
  assert.equal(r2.records.find((r) => r.id === 't1').data.title, 'A');
  const r3 = post(ctx, { key, action: 'sync', since: r1.rev, changes: [] });
  assert.equal(r3.records.length, 0, '前回以降の変更だけ返す');
  const r4 = post(ctx, { key, action: 'sync', since: r1.rev, changes: [{ kind: 'task', id: 't1', data: { date: '2026-11-23', title: 'A', done: true }, updatedAt: '2026-11-23T11:00:00+09:00' }] });
  assert.equal(r4.records.length, 1);
  assert.equal(r4.records[0].data.done, true);
  assert.equal(db.getSheetByName('tasks').data.length, 2, '同じ ID は同じ行を更新');
});

test('その日の準備（prepare）：学習計画シートの時間割から To Do を作り、進捗を書き戻す', () => {
  const plan = fakeBook([
    fakeSheet('予定一覧', [['開始日', '終了日', '時間', '種類', '予定', '進捗', '内容・メモ'], ['2026/11/23', '2026/12/06', '終日', 'FP2級', 'FP2級：タックスプランニング', '未着手', '']]),
    fakeSheet('毎日の時間割', [['曜日', '開始', '終了', '内容', '分類', '期間', '休み・メモ'], ['月', '13:30', '16:00', 'FP2級 学習（インプット＋問題演習）', 'FP2級', '11/16〜1/18', '']]),
  ]);
  const { ctx } = makeEnv(plan);
  const key = 'k'.repeat(64);
  const subj = { name: 'FP2級', status: 'active', tag: 'min', est: 45, studyDays: 'weekdays', perDayMode: 'auto',
    structure: { outer: { format: 'CH{n}' }, inner: { format: 'Sec{n}' }, items: [{ n: 4, label: 'タックスプランニング', secs: 9, due: '2026-12-01' }] }, doneBefore: 'CH4-Sec4' };
  const r = post(ctx, { key, action: 'sync', since: 0, prepare: '2026-11-23', changes: [
    { kind: 'subj', id: 'fp2', data: subj, updatedAt: '2026-11-22T00:00:00+09:00' },
    { kind: 'cfg', id: 'settings', data: { value: { planSheetId: 'x' } }, updatedAt: '2026-11-22T00:00:00+09:00' },
    { kind: 'cfg', id: 'links', data: { value: [{ match: 'FP2級 学習', subject: 'fp2' }] }, updatedAt: '2026-11-22T00:00:00+09:00' },
  ], planUpdates: [{ title: 'FP2級：タックスプランニング', progress: '進行中' }] });
  const task = r.records.find((x) => x.id === 'stu:fp2:CH4-Sec5');
  assert.equal(task.data.start, '13:30');
  assert.equal(r.records.find((x) => x.kind === 'subj').data.structure.items[0].due, '2026-12-06', '章の期限をシートから更新');
  assert.ok(r.records.some((x) => x.kind === 'plan' && x.id === '2026-11-23'));
  assert.equal(plan.getSheetByName('予定一覧').data[1][5], '進行中');
});
