// GAS をにせものの Google サービスの上で動かし、同期・翌日作成・書き戻しを確認する
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fakeSheet, fakeBook, makeEnv } from './helpers/gasEnv.js';

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

function fakeCalendar(events) {
  let n = 0;
  const mk = (title, start, end, opts) => {
    const ev = { id: 'ev' + (++n), title, start, end, desc: (opts && opts.description) || '',
      getId() { return this.id; }, getTitle() { return this.title; }, setTitle(t) { this.title = t; },
      getStartTime() { return this.start; }, getEndTime() { return this.end; }, setTime(s, e) { this.start = s; this.end = e; },
      getDescription() { return this.desc; }, setDescription(d) { this.desc = d; }, deleteEvent() { events.splice(events.indexOf(this), 1); },
      isAllDayEvent: () => false, isRecurringEvent: () => false };
    events.push(ev); return ev;
  };
  return { getEventsForDay: () => events.slice(), getEventById: (id) => events.find((e) => e.id === id) || null, createEvent: mk };
}

test('カレンダー登録：今の手帳の予定（手帳ID）は作り直さずに更新、新しいものは作成（Asia/Tokyo）', () => {
  const { ctx } = makeEnv();
  const events = [];
  const cal = fakeCalendar(events);
  const old = cal.createEvent('【手帳】ビジネス英単語4002 Stage 12 後半【min】', new Date('2026-11-23T05:25:00Z'), new Date('2026-11-23T06:05:00Z'), { description: '手帳ID: qi3k4al0w7o0\n優先度: 高' });
  ctx.CalendarApp = { getDefaultCalendar: () => cal };
  const r = post(ctx, { key: 'k'.repeat(64), action: 'calendar', date: '2026-11-23', tasks: [
    { id: 'qi3k4al0w7o0@2026-11-23', title: 'ビジネス英単語4002 Stage 12 後半【min】', start: '15:00', est: 30, priority: 1 },
    { id: 'new1', title: '書類', start: '16:00', est: 20, priority: 2 },
  ] });
  assert.equal(r.ok, true, r.error);
  assert.equal(events.length, 2, '既存 1 件は更新、新規 1 件');
  assert.equal(r.mapping['qi3k4al0w7o0@2026-11-23'], old.id);
  assert.equal(old.start.toISOString(), '2026-11-23T06:00:00.000Z', '15:00 JST');
  const created = events.find((e) => e.id === r.mapping.new1);
  assert.equal(created.title, '【手帳】書類');
  assert.match(created.desc, /手帳ID: new1/);
});

test('Gmail：条件に合う未読メールを確認候補に入れ、手帳済ラベルを付ける。日付の候補も', () => {
  const { ctx } = makeEnv();
  const key = 'k'.repeat(64);
  post(ctx, { key, action: 'sync', since: 0, changes: [{ kind: 'cfg', id: 'settings', data: { value: { gmailFrom: ['mizuho-fg@mail.axol.jp'], gmailKeywords: ['締切', '提出'] } }, updatedAt: '2026-11-22T00:00:00+09:00' }] });
  let query = null;
  const labeled = [];
  const msg = { getId: () => 'm1', isUnread: () => true, getPlainBody: () => '提出期限は12月3日（木）です。', getFrom: () => 'みずほ <mizuho-fg@mail.axol.jp>', getSubject: () => '【ご確認】書類の提出', getDate: () => new Date('2026-11-22T01:00:00Z') };
  const thread = { getId: () => 't1', getMessages: () => [msg], addLabel: (l) => labeled.push(l) };
  ctx.GmailApp = { search: (q) => { query = q; return [thread]; }, getUserLabelByName: () => ({ name: '手帳済' }), createLabel: () => ({}) };
  vm.runInContext('gmailJob()', ctx);
  assert.match(query, /from:mizuho-fg@mail\.axol\.jp/);
  assert.match(query, /-label:手帳済/);
  assert.match(query, /subject:\(締切 OR 提出\)/);
  assert.equal(labeled.length, 1);
  const r = post(ctx, { key, action: 'sync', since: 0, changes: [] });
  const inbox = r.records.find((x) => x.kind === 'inbox');
  assert.equal(inbox.data.subject, '【ご確認】書類の提出');
  assert.equal(inbox.data.status, 'new');
  assert.ok(inbox.data.dates.some((d) => /-12-03$/.test(d.date)));
});

test('23:00：未完了の【min】があれば自分宛てにメール', () => {
  const { ctx } = makeEnv();
  const today = vm.runInContext('todayKey_()', ctx);
  post(ctx, { key: 'k'.repeat(64), action: 'sync', since: 0, changes: [
    { kind: 'task', id: 'a', data: { date: today, title: 'FP2級 CH4 Sec5【min】', tag: 'min', done: false, est: 45 }, updatedAt: '2026-11-22T00:00:00+09:00' },
    { kind: 'task', id: 'b', data: { date: today, title: '日経【A】', tag: 'A', done: false }, updatedAt: '2026-11-22T00:00:00+09:00' },
  ] });
  const sent = [];
  ctx.MailApp = { sendEmail: (to, subj, body) => sent.push({ to, subj, body }) };
  ctx.Session = { getEffectiveUser: () => ({ getEmail: () => 'me@example.com' }) };
  vm.runInContext('minCheckJob()', ctx);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subj, '【手帳】未完了の【min】1件');
  assert.match(sent[0].body, /FP2級 CH4 Sec5/);
});
