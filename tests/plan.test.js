import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlanRows, planItemsForDate, chapterDues, parseTimetable, timetableSlots, parseWeekdays, periodContains, isHoliday, calendarItems } from '../src/core/planSheet.js';
import { extractDates } from '../src/core/dateExtract.js';
import { buildDay, studyTasksToRemove } from '../src/core/dayBuild.js';

// 実際の「学習計画（英語・FP2級）」の形（一部）
const planValues = [
  ['開始日', '終了日', '時間', '種類', '予定', '進捗', '内容・メモ'],
  ['2026/11/13', '', '終日', 'やること', 'FP2級 CBT受検を予約（1/24）', '完了', ''],
  ['2026/11/23', '2026/12/06', '終日', 'FP2級', 'FP2級：タックスプランニング', '未着手', '目安24h'],
  ['2026/11/30', '', '終日', '締切', '英語研修 STEP1（発音上達講座）修了', '未着手', ''],
  ['2026/12/05', '', '19:00〜21:00', '研修', '基礎レベルレクチャー Reading', '未着手', ''],
  ['2026/12/07', '2026/12/18', '終日', 'FP2級', 'FP2級：不動産', '未着手', ''],
  ['2026/12/21', '2027/01/03', '終日', 'FP2級', 'FP2級：相続・事業承継', '未着手', ''],
];
const ttValues = [
  ['曜日', '開始', '終了', '内容', '分類', '期間', '休み・メモ'],
  ['月〜金', '7:30', '8:10', '英語：金フレ＋ChatGPT英会話', '英語', '11/13〜3/12', '休み：11/18'],
  ['月', '8:30', '9:45', '英語講座（1h）', '英語', '11/16〜2/1', ''],
  ['水木金', '10:30', '11:10', '英語：vintage／Part7（隔日交互）', '英語', '11/13〜12/17', '休み：11/18'],
  ['月', '16:00', '16:40', '英語：vintage／Part7（隔日交互）', '英語', '11/16〜12/14', ''],
  ['火', '13:00', '13:40', '英語：vintage／Part7（隔日交互）', '英語', '11/17〜12/15', ''],
  ['水木金', '13:00', '15:30', 'FP2級 学習（インプット＋問題演習）', 'FP2級', '11/13〜1/22', '休み：11/18、12/18、12/31、1/1'],
  ['月', '13:30', '16:00', 'FP2級 学習（インプット＋問題演習）', 'FP2級', '11/16〜1/18', ''],
  ['月〜金', '20:00', '20:40', 'FP2級 復習（過去問道場）', 'FP2級', '11/13〜1/22', '休み：11/18、12/18、12/31、1/1'],
  ['土日', '終日', '', '予備日（遅れ回収 or 休養）', '予備日', '11/14〜3/14', ''],
];
const links = [
  { match: '英語講座', template: 'eng' },
  { match: '金フレ＋ChatGPT', template: 'gpt', rest: '英語：金フレ' },
  { match: 'FP2級 学習', subject: 'fp2' },
];
const templates = [
  { id: 'nikkei', title: '日経4ニュース【A】', est: 20, priority: 2 },
  { id: 'eng', title: '英語学習1講座【min】', est: 60, priority: 1 },
  { id: 'gpt', title: 'ChatGPT英会話【A】', est: 20, priority: 3 },
];
const fp2 = {
  id: 'fp2', name: 'FP2級', status: 'active', tag: 'min', est: 45, studyDays: 'weekdays', perDayMode: 'auto', maxPerDay: 3,
  structure: { outer: { format: 'CH{n}' }, inner: { format: 'Sec{n}' }, items: [{ n: 4, label: 'タックスプランニング', secs: 9, due: '2026-12-06' }, { n: 5, label: '不動産', secs: 6, due: '2026-12-18' }] },
  milestones: [{ when: 'afterOuter', title: '{name} {outer} 章末問題', est: 75 }], doneBefore: 'CH4-Sec4',
};

test('予定一覧：1 日だけの締切はタスク、時刻ありは固定予定、期間は目標、完了は読まない', () => {
  const items = parsePlanRows(planValues);
  assert.equal(items.length, 6);
  const d = planItemsForDate(items, '2026-11-30', 7);
  assert.equal(d.tasks[0].title, '英語研修 STEP1（発音上達講座）修了');
  assert.equal(d.tasks[0].priority, 1);
  assert.deepEqual(d.goals.map((g) => g.title), ['FP2級：タックスプランニング']);
  assert.deepEqual(d.upcoming.map((u) => u.title), []);
  const b = planItemsForDate(items, '2026-12-05', 7);
  assert.deepEqual(b.blocks[0], { title: '基礎レベルレクチャー Reading', start: '19:00', end: '21:00', source: 'plan', memo: '' });
  assert.equal(planItemsForDate(items, '2026-11-25', 7).upcoming[0].title, '英語研修 STEP1（発音上達講座）修了', '7 日以内の締切');
});

test('「FP2級：○○」の終了日を章の期限として読む（継承/承継の表記ゆれも吸収）', () => {
  const s = JSON.parse(JSON.stringify(fp2));
  s.structure.items.push({ n: 6, label: '相続・事業継承' });
  assert.deepEqual(chapterDues(parsePlanRows(planValues), s), { 4: '2026-12-06', 5: '2026-12-18', 6: '2027-01-03' });
});

test('曜日・期間（年なし）・休みの読み取り', () => {
  assert.deepEqual(parseWeekdays('月〜金'), [1, 2, 3, 4, 5]);
  assert.deepEqual(parseWeekdays('水木金'), [3, 4, 5]);
  assert.deepEqual(parseWeekdays('土日'), [6, 0]);
  assert.ok(periodContains('11/13〜3/12', '2027-01-10'));
  assert.ok(!periodContains('11/13〜12/17', '2027-01-10'));
  assert.ok(isHoliday('休み：11/18、12/18、12/31、1/1', '2027-01-01'));
  assert.ok(isHoliday('休み：12/31、1/1、1/20〜1/22（FP直前）', '2027-01-21'));
  assert.ok(!isHoliday('休み：11/18', '2026-11-19'));
});

test('時間割：11/23(月) の枠。隔日交互は vintage と Part7 を交互に', () => {
  const rows = parseTimetable(ttValues);
  const slots = timetableSlots(rows, '2026-11-23');
  assert.deepEqual(slots.map((s) => s.start), ['07:30', '08:30', '13:30', '16:00', '20:00']);
  const alt = (dk) => timetableSlots(rows, dk).find((s) => /英語：(vintage|Part7)/.test(s.title)).title;
  const a = alt('2026-11-23'), b = alt('2026-11-24'), c = alt('2026-11-25');
  assert.notEqual(a, b); assert.equal(a, c);
  assert.equal(a, '英語：Part7', '今の手帳と同じく 11/23(月) は Part7');
  assert.equal(timetableSlots(rows, '2026-11-28').length, 0, '土日は予備日でタスクなし');
  assert.ok(!timetableSlots(rows, '2026-11-18').some((s) => s.title === 'FP2級 復習（過去問道場）'), '休みの日');
});

test('翌日の To Do：毎日のタスク・学習・時間割の結び付け', () => {
  const r = buildDay('2026-11-23', {
    templates, subjects: [fp2], tasksAll: [], links, mode: 'optimistic',
    planItems: parsePlanRows(planValues), timetableRows: parseTimetable(ttValues),
    calendarEvents: [
      { title: '【手帳】日経新聞 4ニュース【A】', start: '19:30', end: '19:55', description: '手帳ID: x' },
      { title: '英語講座（1h）', start: '08:30', end: '09:45', recurring: true },
      { title: 'FP2級：タックスプランニング', allDay: true },
      { title: '歯医者', start: '18:00', end: '18:30' },
    ],
  });
  const by = (id) => r.create.find((t) => t.id === id);
  assert.equal(by('tpl:eng:2026-11-23').start, '08:30', '英語講座の枠に英語学習1講座');
  assert.equal(by('tpl:eng:2026-11-23').fixedTime, true);
  const rest = r.create.find((t) => t.title === '英語：金フレ');
  assert.equal(rest.start, '07:30'); assert.equal(rest.est, 20);
  assert.equal(by('tpl:gpt:2026-11-23').start, '07:50', '金フレのあとに ChatGPT 英会話');
  assert.equal(by('stu:fp2:CH4-Sec5').start, '13:30', 'FP2級の枠に今日の Sec');
  assert.ok(r.create.some((t) => t.title === 'FP2級 復習（過去問道場）' && t.start === '20:00'));
  assert.equal(by('tpl:nikkei:2026-11-23').start, null, '枠のないものは時刻なし（タイムラインで配置）');
  assert.deepEqual(r.plan.blocks.map((b) => b.title), ['歯医者'], '手帳の予定・時間割と重なる繰り返し予定は除く');
  assert.ok(r.plan.goals.some((g) => g.title === 'FP2級：タックスプランニング'));
});

test('2 回目の実行では何も作らない（21:50 とアプリ起動の両方で動いても重複しない）', () => {
  const ctx = { templates, subjects: [fp2], links, mode: 'actual', timetableRows: parseTimetable(ttValues) };
  const r1 = buildDay('2026-11-23', Object.assign({ tasksAll: [] }, ctx));
  const r2 = buildDay('2026-11-23', Object.assign({ tasksAll: r1.create }, ctx));
  assert.equal(r2.create.length, 0);
  assert.equal(r2.patch.length, 0);
});

test('日付が変わったら、前日に終わらなかった学習の分だけ新しい単位を減らす', () => {
  // 21:50 に Sec6 を翌日分として作ったが、Sec5 が終わらず繰越された
  const sec5 = { id: 'stu:fp2:CH4-Sec5', subjectId: 'fp2', unitKey: 'CH4-Sec5', date: '2026-11-23', done: false, carriedTo: '2026-11-24', source: 'study' };
  const sec5c = Object.assign({}, sec5, { id: 'stu:fp2:CH4-Sec5@2026-11-24', date: '2026-11-24', carriedTo: undefined, carriedFrom: '2026-11-23', carryCount: 1 });
  const sec6 = { id: 'stu:fp2:CH4-Sec6', subjectId: 'fp2', unitKey: 'CH4-Sec6', date: '2026-11-24', done: false, source: 'study', sessions: [] };
  const all = [sec5, sec5c, sec6];
  const r = buildDay('2026-11-24', { templates: [], subjects: [fp2], tasksAll: all, links, mode: 'actual' });
  assert.deepEqual(studyTasksToRemove('2026-11-24', all, r.studyKeep), ['stu:fp2:CH4-Sec6']);
});

test('カレンダー：終日は目標、手帳の予定は除く', () => {
  const c = calendarItems([{ title: '英語【TOEIC期】', allDay: true }, { title: 'x', start: '10:00', end: '11:00', description: '手帳ID: abc' }], []);
  assert.equal(c.goals.length, 1); assert.equal(c.blocks.length, 0);
});

test('メール本文から締切の候補日を見つける', () => {
  const text = '提出期限は2026年12月3日です。説明会は12/10(木)、予備日は１２月２０日。明日までにご確認ください。1/15にも。';
  const ds = extractDates(text, '2026-11-23', 10).map((d) => d.date);
  assert.deepEqual(ds, ['2026-11-24', '2026-12-03', '2026-12-10', '2026-12-20', '2027-01-15']);
  assert.deepEqual(extractDates('3/4〜の資料、2026/11/30 締切', '2026-11-23').map((d) => d.date), ['2026-11-30', '2027-03-04']);
});
