// 実績倍率（実績 ÷ 見積）。タイムラインの配置と「見積もりを自動で増やす」で使う
import { addDays } from './dates.js';

export function ratioKey(task) {
  if (task.templateId) return 'tpl:' + task.templateId;
  if (task.subjectId) return 'subj:' + task.subjectId;
  return 'title:' + String(task.title || '').replace(/【[^】]*】/g, '').replace(/[（(][^）)]*[）)]/g, '').replace(/\s+/g, '');
}

// 直近 windowDays 日の完了タスクから倍率を出す
export function computeRatios(allTasks, today, windowDays) {
  const from = addDays(today, -(windowDays || 28));
  const by = {};
  let ge = 0, ga = 0, gn = 0;
  for (const t of allTasks || []) {
    if (t.deleted || !t.done || !(t.est > 0) || !(t.actualMin > 0)) continue;
    if (!t.date || t.date < from || t.date > today) continue;
    const k = ratioKey(t);
    const b = (by[k] = by[k] || { est: 0, act: 0, samples: 0 });
    b.est += t.est; b.act += t.actualMin; b.samples++;
    ge += t.est; ga += t.actualMin; gn++;
  }
  const byKey = {};
  for (const k of Object.keys(by)) byKey[k] = { ratio: Math.round((by[k].act / by[k].est) * 100) / 100, samples: by[k].samples };
  return { byKey: byKey, global: gn ? { ratio: Math.round((ga / ge) * 100) / 100, samples: gn } : { ratio: null, samples: 0 } };
}

// 配置に使う倍率：そのタスクの実績（2 件以上）→ 全体の実績（5 件以上）→ 既定 1.3
export function factorFor(task, ratios, defaultFactor) {
  const def = defaultFactor || 1.3;
  const k = ratios && ratios.byKey[ratioKey(task)];
  let f = def, source = 'default';
  if (k && k.samples >= 2) { f = k.ratio; source = 'task'; }
  else if (ratios && ratios.global.samples >= 5) { f = ratios.global.ratio; source = 'global'; }
  f = Math.min(3, Math.max(0.5, f));
  return { factor: f, source: source };
}
