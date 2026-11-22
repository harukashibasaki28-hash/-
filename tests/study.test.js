import test from 'node:test';
import assert from 'node:assert/strict';
import { expandUnits, planStudyDay, unitStatus, dailyQuota, subjectProgress, nextUnit, countStudyDays } from '../src/core/study.js';

const fp2 = () => ({
  id: 'fp2', name: 'FP2級', status: 'active', tag: 'min', examDate: '2027-01-24',
  structure: {
    outer: { name: 'CH', format: 'CH{n}' }, inner: { name: 'Sec', format: 'Sec{n}' },
    items: [
      { n: 3, label: '金融資産運用', secs: 10, due: '2026-11-22' },
      { n: 4, label: 'タックスプランニング', secs: 9, due: '2026-12-06' },
      { n: 5, label: '不動産', secs: 6, due: '2026-12-18' },
      { n: 6, label: '相続・事業承継', secs: 5, due: '2027-01-03' },
      { n: 2, label: 'リスクマネジメント', secs: 7, due: '2027-01-10' },
      { n: 1, label: 'ライフプランニングと資金計画', secs: 11, due: '2027-01-19' },
    ],
  },
  est: 45, studyDays: 'weekdays', offDays: ['2026-12-18', '2026-12-31', '2027-01-01'],
  milestones: [{ when: 'afterOuter', title: '{name} {outer} 章末問題', est: 75 }],
  doneBefore: 'CH4-Sec4', perDayMode: 'auto', maxPerDay: 3,
});

const e4002 = () => ({
  id: 'e4002', name: 'ビジネス英単語4002', status: 'active', tag: 'min',
  structure: { outer: { name: 'Stage', format: 'Stage {n}', count: 40 }, inner: { name: 'パート', labels: ['前半', '後半'] } },
  est: 30, perDay: 1, studyDays: 'everyday', milestones: [], doneBefore: 'Stage 12-前半',
});

test('単位の並び：学習順・章ごとに Sec 数が違う・章末問題が章の直後', () => {
  const u = expandUnits(fp2());
  assert.equal(u.filter((x) => !x.milestone).length, 48);
  assert.equal(u.filter((x) => x.milestone).length, 6);
  assert.equal(u[0].key, 'CH3-Sec1');
  assert.equal(u[10].key, 'CH3-章末問題');
  assert.equal(u[10].est, 75);
  assert.equal(u[10].title, 'FP2級 CH3 金融資産運用 章末問題');
  assert.equal(u[11].key, 'CH4-Sec1');
});

test('前半/後半：40 stage × 2 = 80 単位、タイトルは今の手帳と同じ形', () => {
  const u = expandUnits(e4002());
  assert.equal(u.length, 80);
  assert.equal(u[23].key, 'Stage 12-後半');
  assert.equal(u[23].title, 'ビジネス英単語4002 Stage 12 後半');
});

test('4002：次は Stage 12 後半 → 完了したら翌日は Stage 13 前半', () => {
  const s = e4002();
  let p = planStudyDay(s, [], '2026-11-23', 'actual');
  assert.deepEqual(p.generate.map((t) => t.title), ['ビジネス英単語4002 Stage 12 後半【min】']);
  assert.equal(p.generate[0].id, 'stu:e4002:Stage 12-後半');
  const done = Object.assign({}, p.generate[0], { done: true, doneAt: '2026-11-23T15:00:00+09:00' });
  p = planStudyDay(s, [done], '2026-11-24', 'actual');
  assert.deepEqual(p.generate.map((t) => t.unitKey), ['Stage 13-前半']);
});

test('完了を取り消すと戻る（位置を別に持たないので自動で戻る）', () => {
  const s = e4002();
  const t = Object.assign(planStudyDay(s, [], '2026-11-23', 'actual').generate[0], { done: false });
  const p = planStudyDay(s, [Object.assign({}, t, { date: '2026-11-23', carriedTo: '2026-11-24' }), Object.assign({}, t, { id: t.id + '@2026-11-24', date: '2026-11-24', carriedFrom: '2026-11-23', carryCount: 1 })], '2026-11-24', 'actual');
  assert.equal(p.carried, 1, '未完了は繰越される');
  assert.equal(p.generate.length, 0, '繰越がある分、新しい単位は足さない');
});

test('21:50 の翌日作成（optimistic）：今日の分は終わる前提で次の分を作る', () => {
  const s = e4002();
  const today = Object.assign(planStudyDay(s, [], '2026-11-23', 'actual').generate[0], { date: '2026-11-23' });
  const p = planStudyDay(s, [today], '2026-11-24', 'optimistic');
  assert.deepEqual(p.generate.map((t) => t.unitKey), ['Stage 13-前半']);
});

test('FP2級：CH4 Sec4 まで完了 → 11/23(月) は CH4 Sec5。期限から逆算して 1 日 1 Sec', () => {
  const s = fp2();
  const p = planStudyDay(s, [], '2026-11-23', 'actual');
  assert.equal(p.quota, 1);
  assert.deepEqual(p.generate.map((t) => t.title), ['FP2級 CH4 タックスプランニング Sec5【min】']);
});

test('FP2級：土日は学習日ではないので作らない', () => {
  assert.equal(planStudyDay(fp2(), [], '2026-11-28', 'actual').generate.length, 0);
});

test('期限から逆算：残りが多いと 1 日の Sec 数が増える（上限 3）', () => {
  const s = fp2();
  s.doneBefore = 'CH3-章末問題'; // CH4 は 9 Sec 残り
  // 12/1(火)〜12/4(金) の学習日 4 日で 9 Sec → 3
  const st = unitStatus(s, [], '2026-12-01', 'actual');
  assert.equal(countStudyDays(s, '2026-12-01', '2026-12-06'), 4);
  assert.equal(dailyQuota(s, st, '2026-12-01'), 3);
  const prog = subjectProgress(s, [], '2026-12-01');
  assert.equal(prog.behind, true);
  assert.match(prog.messages[0], /1 日 3 単位必要/);
});

test('章の全 Sec が終わった翌日に章末問題（その日の通常 Sec も入れる）', () => {
  const s = fp2();
  s.doneBefore = 'CH4-Sec8';
  const last = { id: 'stu:fp2:CH4-Sec9', subjectId: 'fp2', unitKey: 'CH4-Sec9', date: '2026-11-30', done: true, doneAt: '2026-11-30T15:00:00+09:00' };
  const sameDay = planStudyDay(s, [last], '2026-11-30', 'actual');
  assert.ok(!sameDay.generate.some((t) => t.milestone), '完了した当日は入れない');
  const p = planStudyDay(s, [last], '2026-12-01', 'actual');
  const titles = p.generate.map((t) => t.title);
  assert.ok(titles.includes('FP2級 CH4 タックスプランニング 章末問題【min】'));
  assert.ok(titles.includes('FP2級 CH5 不動産 Sec1【min】'));
  assert.equal(p.generate.find((t) => t.milestone).est, 75);
});

test('最後の単位のあとは何も作らない・終了した科目は作らない', () => {
  const s = e4002();
  s.doneBefore = 'Stage 40-後半';
  assert.equal(planStudyDay(s, [], '2026-11-23', 'actual').generate.length, 0);
  const f = e4002(); f.status = 'finished';
  assert.equal(planStudyDay(f, [], '2026-11-23', 'actual').generate.length, 0);
});

test('何度実行しても同じ ID（スマホ・PC・GAS で重複しない）', () => {
  const a = planStudyDay(fp2(), [], '2026-11-24', 'actual').generate.map((t) => t.id);
  const b = planStudyDay(fp2(), [], '2026-11-24', 'actual').generate.map((t) => t.id);
  assert.deepEqual(a, b);
});

test('すでに別の日に入っている単位は飛ばす／次の単位を今日に追加', () => {
  const s = e4002();
  const tomorrow = { id: 'stu:e4002:Stage 12-後半', subjectId: 'e4002', unitKey: 'Stage 12-後半', date: '2026-11-24', done: false };
  const p = planStudyDay(s, [tomorrow], '2026-11-23', 'actual');
  assert.deepEqual(p.generate.map((t) => t.unitKey), ['Stage 13-前半']);
  const n = nextUnit(s, [tomorrow], '2026-11-23');
  assert.equal(n.unitKey, 'Stage 13-前半');
});

test('進み具合のまとめ', () => {
  const pr = subjectProgress(fp2(), [], '2026-11-23');
  assert.equal(pr.total, 48);
  assert.equal(pr.done, 14);
  assert.equal(pr.next.key, 'CH4-Sec5');
  assert.equal(pr.behind, false, 'CH4 残り 5 Sec / 学習日 10 日 → 遅れなし');
});
