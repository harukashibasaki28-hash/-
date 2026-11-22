// 分析の差し替え口。分析器はすべて { id, name, analyze(ctx) => Promise<{ metrics?, findings[] }> } の形。
// 将来 AI 分析を足すときは registerAnalyzer({ id:'ai', analyze: async (ctx) => {...} }) を呼ぶだけ。
import { evaluateRules } from './ruleEngine.js';

const analyzers = [];

export function registerAnalyzer(a) {
  const i = analyzers.findIndex((x) => x.id === a.id);
  if (i >= 0) analyzers.splice(i, 1, a); else analyzers.push(a);
}

export function listAnalyzers() { return analyzers.slice(); }

export const rulesAnalyzer = { id: 'rules', name: 'ルール', analyze: async (ctx) => evaluateRules(ctx) };
registerAnalyzer(rulesAnalyzer);

// 登録された分析器を順に呼び、結果をまとめる（1 つが失敗しても他は続ける）
export async function runAnalysis(ctx) {
  const result = { metrics: {}, findings: [], errors: [] };
  for (const a of analyzers) {
    if (a.enabled === false) continue;
    try {
      const r = await a.analyze(ctx);
      Object.assign(result.metrics, r.metrics || {});
      for (const f of r.findings || []) result.findings.push(Object.assign({ source: a.id }, f));
    } catch (e) {
      result.errors.push(a.id + ': ' + e.message);
    }
  }
  result.findings.sort((x, y) => (y.severity || 0) - (x.severity || 0));
  return result;
}
