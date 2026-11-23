// 金フレなどの「ブロックごとに忘却曲線で復習する」教材
// 状態（学習回数・最後に学習した日・2周目が済んだか）は、初期値＋完了した金フレのタスクから毎回計算する。
// GAS にも同梱される。import は同梱ファイルからのみ。
import { addDays, diffDays } from './dates.js';
import { normalizeTask } from './tasks.js';

export const DEFAULT_INTERVALS = [1, 3, 7, 14, 30]; // 学習回数 1,2,3,4,5以上 → 次の復習まで（日）

export function intervalFor(subject, count) {
  const iv = subject.intervals || DEFAULT_INTERVALS;
  return iv[Math.min(Math.max(count, 1), iv.length) - 1];
}

export function srsTaskId(subjectId, dk) { return 'srs:' + subjectId + ':' + dk; }

function doneDateOf(t) { return t.doneAt ? String(t.doneAt).slice(0, 10) : t.date; }

// ブロックごとの状態。mode 'optimistic' は date より前の未完了タスクも終わった前提（21:50 の翌日作成用）
export function srsState(subject, tasks, date, mode) {
  const st = {};
  const init = subject.initial || {};
  for (const b of subject.blocks || []) {
    const i = init[b.key] || {};
    st[b.key] = { key: b.key, block: b, count: Number(i.count) || 0, last: i.last || null, round2: !!i.round2 };
  }
  const asOf = subject.initialAsOf || '0000-00-00';
  const list = [];
  for (const t of tasks || []) {
    if (t.deleted || t.subjectId !== subject.id || !t.srsBlocks) continue;
    let d = null;
    if (t.done) d = doneDateOf(t);
    else if (mode === 'optimistic' && t.date < date) d = t.date;
    if (!d || d < asOf || d >= date) continue;
    list.push({ d: d, t: t });
  }
  list.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  for (const x of list) {
    const doneKeys = x.t.done && Array.isArray(x.t.srsDone) ? x.t.srsDone : x.t.srsBlocks.map((b) => b.key);
    for (const b of x.t.srsBlocks) {
      if (doneKeys.indexOf(b.key) < 0 || !st[b.key]) continue;
      const s = st[b.key];
      if (s.last === x.d) continue; // 同じ日に二重に数えない
      s.count++; s.last = x.d;
      if (b.mode === 'all') s.round2 = true;
    }
  }
  for (const k of Object.keys(st)) {
    const s = st[k];
    s.due = s.round2 && s.last ? addDays(s.last, intervalFor(subject, s.count)) : null;
    s.overdue = s.due ? diffDays(s.due, date) : null; // 0 = 今日が復習日、正 = 遅れ
  }
  return st;
}

function blockMin(subject, b, mode) {
  const per = mode === 'all' ? (subject.minAll || 15) : (subject.minX || 8);
  return Math.round(per * ((b.words || 100) / 100));
}

// その日のブロックを選ぶ（説明資料のルールどおり）
// ① 復習日が来たブロックを、遅れが大きい順に（学習回数 2 回以上は ×印中心）
// ② 2 周目がまだのブロックを 1 つ（全語、決めた順番で）
// ③ 2 ブロックに届かなければ、次の復習日が近いブロックで補う
// 多くても 3 ブロック・40 分まで
export function planSrs(subject, tasks, date, mode) {
  if (subject.status === 'finished') return null;
  const st = srsState(subject, tasks, date, mode);
  const daily = subject.dailyBlocks || 2;
  const maxBlocks = subject.maxBlocks || 3;
  const maxMin = subject.maxMin || 40;
  const order = subject.round2Order || (subject.blocks || []).map((b) => b.key);
  const fresh = order.map((k) => st[k]).find((s) => s && !s.round2) || null;
  const due = Object.keys(st).map((k) => st[k]).filter((s) => s.due && s.overdue >= 0).sort((a, b) => b.overdue - a.overdue || (a.key < b.key ? -1 : 1));
  const chosen = [];
  let minutes = 0;
  const add = (s, m) => {
    const min = blockMin(subject, s.block, m);
    if (chosen.length >= maxBlocks || (chosen.length && minutes + min > maxMin)) return false;
    chosen.push({ key: s.key, mode: m, label: s.block.label, words: s.block.words || 100, min: min, overdue: s.overdue, count: s.count });
    minutes += min;
    return true;
  };
  const reviewSlots = fresh ? maxBlocks - 1 : maxBlocks;
  for (const s of due.slice(0, reviewSlots)) add(s, s.count >= 2 ? 'x' : 'all');
  if (fresh) add(fresh, 'all');
  if (chosen.length < daily) {
    const upcoming = Object.keys(st).map((k) => st[k]).filter((s) => s.due && s.overdue < 0 && !chosen.some((c) => c.key === s.key))
      .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
    for (const s of upcoming) { if (chosen.length >= daily) break; add(s, 'x'); }
  }
  if (!chosen.length) return null;
  const tag = subject.tag || 'min';
  const words = chosen.reduce((a, c) => a + c.words, 0);
  return normalizeTask({
    id: srsTaskId(subject.id, date),
    title: subject.name + ' ' + chosen.map((c) => c.label + (c.mode === 'x' ? '（×印）' : '（全語）')).join('・') + '【' + tag + '】',
    priority: subject.priority || 1, est: minutes, tag: tag,
    subjectId: subject.id, srsBlocks: chosen.map((c) => ({ key: c.key, mode: c.mode })), srsWords: words,
    source: 'srs', noCarry: true, mustKeep: true,
  }, date);
}

// 学習画面用
export function srsOverview(subject, tasks, date) {
  // 今日やった分も反映する（遅れの日数は今日を基準に）
  const st = srsState(subject, tasks, addDays(date, 1), 'actual');
  for (const k of Object.keys(st)) if (st[k].due) st[k].overdue = diffDays(st[k].due, date);
  const order = subject.round2Order || [];
  return (subject.blocks || []).map((b) => {
    const s = st[b.key];
    let status, next;
    if (!s.round2) { status = 'todo'; next = '2周目を全語で' + (order.indexOf(b.key) >= 0 ? '（' + (order.filter((k) => !st[k].round2).indexOf(b.key) + 1) + '番目）' : ''); }
    else if (s.overdue > 0) { status = 'late'; next = s.overdue + '日遅れ → ' + (s.count >= 2 ? '×印で回収' : '全語'); }
    else if (s.overdue === 0) { status = 'due'; next = '今日が復習日 → ' + (s.count >= 2 ? '×印中心' : '全語'); }
    else { status = 'ok'; next = s.due.slice(5).replace('-', '/') + ' に復習（' + intervalFor(subject, s.count) + '日後）'; }
    return { key: b.key, label: b.label, level: b.level || '', words: b.words || 100, count: s.count, last: s.last, round2: s.round2, due: s.due, status: status, next: next };
  });
}
