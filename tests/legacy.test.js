import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyDuplicates } from '../src/core/legacy.js';
import { groupTasks } from '../src/ui/today.js';

const D = '2026-11-23';
const legacy = (id, title, extra) => Object.assign({ id, title, date: D, source: 'daily', done: false, sessions: [], priority: 2 }, extra);
// 11/23 に前の手帳から移した日課（実際のタイトル）
const old = [
  legacy('a', '英語学習プログラム：英語発音上達講座 第8回（STEP1修了）【min】', { priority: 1 }),
  legacy('b', '金フレ 301〜400（2周目・全語）＋101〜200・supplement5 定型表現（復習・×印中心）'),
  legacy('c', '日経新聞 4ニュース【A】'),
  legacy('d', '23時半に寝る', { priority: 1 }),
  legacy('e', '英語：vintage（文法の章を優先）', { source: 'sheet' }),
  legacy('f', 'FP2級 復習（過去問道場）', { source: 'sheet' }),
  legacy('g', 'TOEICミニテスト4【任意】（11/16週分）', { deadline: D }),
  legacy('h', '英語：vintage（文法の章を優先）（11/21分）', { source: 'sheet', carryCount: 1, carriedFrom: '2026-11-21' }),
  legacy('i', 'ビジネス英単語4002 Stage 12 後半【min】', { done: true }),
];
const mine = [
  { id: 'stu:eng:x', subjectId: 'eng', date: D, source: 'study', title: '英語講座 STEP1 英語発音上達講座 第8回【min】' },
  { id: 'srs:kinfre:' + D, subjectId: 'kinfre', date: D, source: 'srs', title: '金フレ …' },
  { id: 'tpl:nikkei:' + D, templateId: 'nikkei', date: D, source: 'template', title: '日経4ニュース【A】' },
  { id: 'tt:1', date: D, source: 'timetable', title: '英語：Part7' },
  { id: 'tt:2', date: D, source: 'timetable', title: 'FP2級 復習（過去問道場）' },
];

test('前の手帳の日課のうち、アプリの日課と二重になった分（手を付けていないもの）を片付ける', () => {
  assert.deepEqual(legacyDuplicates(old.concat(mine), D).sort(), ['a', 'b', 'c', 'd', 'f']);
});

test('残すもの：今日は Part7 の日なので vintage、繰越されてきた vintage、ミニテスト、完了済み', () => {
  const r = legacyDuplicates(old.concat(mine), D);
  for (const id of ['e', 'g', 'h', 'i']) assert.ok(!r.includes(id), id);
});

test('アプリの日課がまだ届いていなければ片付けない（23時半に寝る だけは通知に置き換え）', () => {
  assert.deepEqual(legacyDuplicates(old, D), ['d']);
});

test('前の手帳の daily・sheet は「毎日の日課」に表示し、「優先のやること」には出さない', () => {
  const g = groupTasks(old.concat([{ id: 'p', title: '人事へ書類提出', source: 'manual', priority: 1, date: D }]), D);
  assert.deepEqual(g.priority.map((t) => t.id), ['p']);
  assert.ok(g.routine.some((t) => t.id === 'a'));
  assert.equal(g.other.length, 0);
});
