import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateRules, validateRules, weeklyFocus } from '../src/analysis/ruleEngine.js';
import { runAnalysis, registerAnalyzer } from '../src/analysis/index.js';
import { computeRatios } from '../src/core/estimates.js';

const rules = JSON.parse(readFileSync(new URL('../config/rules.json', import.meta.url)));
const settings = { bedTarget: '24:00' };

test('同梱のルールファイルは形が正しい', () => {
  assert.deepEqual(validateRules(rules), []);
  assert.ok(validateRules([{ id: 'x', when: { metric: 'a', op: '=>' } }]).length > 0);
});

test('昼寝 60 分超 → 昼寝は20分アラームで1回まで', () => {
  const days = { '2026-11-23': { naps: [{ min: 40 }, { min: 30 }], tasks: [] } };
  const r = evaluateRules({ date: '2026-11-23', days, settings, rules });
  const f = r.findings.find((x) => x.ruleId === 'nap_long');
  assert.equal(f.advice, '昼寝は20分アラームで1回まで');
  assert.equal(f.issue, '昼寝が合計70分（2回）');
});

test('就寝が 60 分以上遅い日が 2 日続いたら（1 日だけなら出ない）', () => {
  const late = (d) => ({ sleep: { bed: d + 'T01:10:00+09:00', min: 360 }, tasks: [] });
  const one = { '2026-11-23': late('2026-11-23') };
  assert.ok(!evaluateRules({ date: '2026-11-23', days: one, settings, rules }).findings.some((f) => f.ruleId === 'late_bed'));
  const two = { '2026-11-22': late('2026-11-22'), '2026-11-23': late('2026-11-23') };
  const f = evaluateRules({ date: '2026-11-23', days: two, settings, rules }).findings.find((x) => x.ruleId === 'late_bed');
  assert.equal(f.advice, '23:30に寝る準備');
  assert.match(f.issue, /2日/);
});

test('起床 7 時以降で朝のタスクが未着手 → 朝タスクを午後へ移す', () => {
  const days = { '2026-11-23': { sleep: { wake: '2026-11-23T07:40:00+09:00' }, tasks: [{ title: '朝', start: '08:00', done: false, sessions: [] }] } };
  const f = evaluateRules({ date: '2026-11-23', days, settings, rules }).findings.find((x) => x.ruleId === 'late_wake');
  assert.equal(f.advice, '朝タスクを午後へ移す');
});

test('同じタスクの繰越 3 回以上', () => {
  const days = { '2026-11-23': { tasks: [{ title: 'vintage', carryCount: 3 }, { title: 'x', carryCount: 1 }] } };
  const fs = evaluateRules({ date: '2026-11-23', days, settings, rules }).findings.filter((x) => x.ruleId === 'carry3');
  assert.equal(fs.length, 1);
  assert.equal(fs[0].advice, 'やる／削る／週末に回すを決める');
});

test('実績倍率 1.3 倍超 → 見積もりを増やすアクション', () => {
  const hist = [
    { templateId: 'nikkei', done: true, est: 20, actualMin: 30, date: '2026-11-21' },
    { templateId: 'nikkei', done: true, est: 20, actualMin: 30, date: '2026-11-22' },
  ];
  const ctx = { date: '2026-11-22', days: {}, settings, rules, ratios: computeRatios(hist, '2026-11-22'), templates: [{ id: 'nikkei', title: '日経4ニュース【A】', est: 20 }] };
  const f = evaluateRules(ctx).findings.find((x) => x.ruleId === 'ratio_over');
  assert.deepEqual(f.action, { type: 'raiseEstimate', target: { kind: 'tpl', id: 'nikkei' }, newEst: 30 });
  assert.match(f.advice, /30分/);
});

test('ルールを追加すれば（コードを直さずに）新しい改善策が出る', () => {
  const custom = [{ id: 'short_sleep', when: { metric: 'sleepMin', op: '<', value: 360 }, advice: '早く寝る', issue: '睡眠{sleepMin}分' }];
  const r = evaluateRules({ date: '2026-11-23', days: { '2026-11-23': { sleep: { min: 300 }, tasks: [] } }, settings, rules: custom });
  assert.equal(r.findings[0].issue, '睡眠300分');
});

test('分析器の差し替え：追加した分析器の結果も合わせて返す。失敗しても他は動く', async () => {
  registerAnalyzer({ id: 'dummy-ai', analyze: async () => ({ findings: [{ severity: 5, issue: 'AI', advice: 'AI の提案' }] }) });
  registerAnalyzer({ id: 'broken', analyze: async () => { throw new Error('x'); } });
  const r = await runAnalysis({ date: '2026-11-23', days: {}, settings, rules });
  assert.equal(r.findings[0].advice, 'AI の提案');
  assert.equal(r.errors.length, 1);
});

test('週の「翌週に変えること」は 1 つ', () => {
  const f = weeklyFocus([[{ ruleId: 'a', severity: 1 }], [{ ruleId: 'b', severity: 3 }], [{ ruleId: 'a', severity: 1 }, { ruleId: 'b', severity: 3 }]]);
  assert.equal(f.ruleId, 'b');
});
