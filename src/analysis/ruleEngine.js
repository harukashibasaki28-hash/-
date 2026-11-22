// 改善策ルールの評価（ルールは config/rules.json ／ 設定画面で編集）
import { addDays } from '../core/dates.js';
import { dayMetrics, taskMetrics } from './metrics.js';

const OPS = {
  '>': (a, b) => a > b, '>=': (a, b) => a >= b, '<': (a, b) => a < b, '<=': (a, b) => a <= b,
  '==': (a, b) => a == b, '!=': (a, b) => a != b, // eslint-disable-line eqeqeq
};

export function evalCond(cond, m) {
  if (!cond) return false;
  if (Array.isArray(cond.all)) return cond.all.every((c) => evalCond(c, m));
  if (Array.isArray(cond.any)) return cond.any.some((c) => evalCond(c, m));
  const v = m[cond.metric];
  if (v == null || !OPS[cond.op]) return false;
  return OPS[cond.op](v, cond.value);
}

function streakOf(cond) {
  if (!cond) return 0;
  if (cond.streak) return cond.streak;
  for (const c of cond.all || cond.any || []) { const s = streakOf(c); if (s) return s; }
  return 0;
}

export function fill(tpl, m) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (m[k] == null ? '' : String(m[k])));
}

// ルールの形のチェック（設定画面で保存する前に使う）
export function validateRules(rules) {
  const errors = [];
  if (!Array.isArray(rules)) return ['ルールは [ ] の一覧で書いてください'];
  const ids = {};
  rules.forEach((r, i) => {
    const at = (r && r.id) || '#' + (i + 1);
    if (!r || typeof r !== 'object') { errors.push(at + ': { } で書いてください'); return; }
    if (!r.id) errors.push(at + ': id がありません');
    if (ids[r.id]) errors.push(at + ': id が重複しています');
    ids[r.id] = true;
    if (['day', 'task', 'estimate'].indexOf(r.scope || 'day') < 0) errors.push(at + ': scope は day / task / estimate');
    if (!r.when) errors.push(at + ': when（条件）がありません');
    (function chk(c) {
      if (!c) return;
      if (c.all || c.any) return (c.all || c.any).forEach(chk);
      if (!c.metric) errors.push(at + ': 条件に metric がありません');
      if (!OPS[c.op]) errors.push(at + ': op は > >= < <= == != のどれか');
    })(r.when);
    if (!r.advice) errors.push(at + ': advice（改善策）がありません');
  });
  return errors;
}

// ctx: { date, days, settings, rules, ratios, templates, subjects }
export function evaluateRules(ctx) {
  const findings = [];
  const day = ctx.days[ctx.date] || { tasks: [] };
  const dm = dayMetrics(day, ctx.settings);
  for (const r of ctx.rules || []) {
    if (r.enabled === false) continue;
    const scope = r.scope || 'day';
    if (scope === 'day') {
      const need = streakOf(r.when);
      if (!evalCond(r.when, dm)) continue;
      let streak = 1;
      if (need > 1) {
        for (let d = addDays(ctx.date, -1); streak < 60; d = addDays(d, -1)) {
          if (!ctx.days[d] || !evalCond(r.when, dayMetrics(ctx.days[d], ctx.settings))) break;
          streak++;
        }
        if (streak < need) continue;
      }
      const m = Object.assign({}, dm, { streak: streak });
      findings.push({ ruleId: r.id, severity: r.severity || 1, issue: fill(r.issue, m), advice: fill(r.advice, m), action: r.action || null });
    } else if (scope === 'task') {
      const seen = {};
      for (const t of day.tasks || []) {
        if (t.deleted) continue;
        const m = taskMetrics(t);
        if (!evalCond(r.when, m) || seen[t.title]) continue;
        seen[t.title] = true;
        findings.push({ ruleId: r.id, severity: r.severity || 1, issue: fill(r.issue, m), advice: fill(r.advice, m), action: r.action || null, taskId: t.id });
      }
    } else if (scope === 'estimate') {
      for (const target of estimateTargets(ctx)) {
        if (!evalCond(r.when, target.m)) continue;
        findings.push({ ruleId: r.id, severity: r.severity || 1, issue: fill(r.issue, target.m), advice: fill(r.advice, target.m),
          action: r.action ? Object.assign({}, r.action, { target: target.ref, newEst: target.m.newEst }) : null });
      }
    }
  }
  findings.sort((a, b) => b.severity - a.severity);
  return { metrics: dm, findings: findings };
}

// 毎日のタスク・学習科目ごとの直近の実績倍率
function estimateTargets(ctx) {
  const out = [];
  const by = (ctx.ratios && ctx.ratios.byKey) || {};
  for (const tp of ctx.templates || []) {
    const r = by['tpl:' + tp.id];
    if (!r || r.samples < 2 || !(tp.est > 0)) continue;
    out.push({ ref: { kind: 'tpl', id: tp.id }, m: { title: tp.title, actualRatio: r.ratio, samples: r.samples, est: tp.est, newEst: Math.ceil((tp.est * r.ratio) / 5) * 5 } });
  }
  for (const s of ctx.subjects || []) {
    const r = by['subj:' + s.id];
    if (!r || r.samples < 2 || !(s.est > 0) || s.status === 'finished') continue;
    out.push({ ref: { kind: 'subj', id: s.id }, m: { title: s.name, actualRatio: r.ratio, samples: r.samples, est: s.est, newEst: Math.ceil((s.est * r.ratio) / 5) * 5 } });
  }
  return out;
}

// 週の「翌週に変えること」：1 週間で最も重く・多く出た改善策を 1 つ
export function weeklyFocus(perDayFindings) {
  const score = {};
  for (const list of perDayFindings) {
    const seen = {};
    for (const f of list) {
      if (seen[f.ruleId]) continue;
      seen[f.ruleId] = true;
      const s = (score[f.ruleId] = score[f.ruleId] || { count: 0, finding: f });
      s.count++;
    }
  }
  const arr = Object.keys(score).map((k) => score[k]).sort((a, b) => b.count * b.finding.severity - a.count * a.finding.severity);
  return arr.length ? Object.assign({ days: arr[0].count }, arr[0].finding) : null;
}
