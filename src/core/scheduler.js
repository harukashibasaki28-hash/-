// タイムライン自動作成
// ルール: 空き時間の 75% まで / 見積×倍率で配置 / 締切→優先度→繰越回数の順 /
// 重いものは集中しやすい時間帯、軽いものは隙間 / 移動・食事・休憩の枠を確保 / 入らない分は後ろ倒し候補
import { hmToMin, minToHm, weekday } from './dates.js';
import { factorFor } from './estimates.js';

const FOCUS = { morning: [300, 720], afternoon: [720, 1080], evening: [1080, 1440] };

function subtract(intervals, s, e) {
  const out = [];
  for (const iv of intervals) {
    if (e <= iv.s || s >= iv.e) { out.push(iv); continue; }
    if (s > iv.s) out.push({ s: iv.s, e: s });
    if (e < iv.e) out.push({ s: e, e: iv.e });
  }
  return out;
}

function roundUp5(x) { return Math.ceil(x / 5) * 5; }

export function sortForSchedule(a, b) {
  const da = a.deadline || '9999', db = b.deadline || '9999';
  if (da !== db) return da < db ? -1 : 1;
  if ((a.priority || 2) !== (b.priority || 2)) return (a.priority || 2) - (b.priority || 2);
  if ((a.carryCount || 0) !== (b.carryCount || 0)) return (b.carryCount || 0) - (a.carryCount || 0);
  return (b.est || 0) - (a.est || 0);
}

// opts: { date, tasks, settings, fixedEvents, plan: {blocks:[{title,start,end}]}, startMin, ratios }
export function buildTimeline(opts) {
  const st = opts.settings || {};
  const date = opts.date;
  const wd = weekday(date);
  const dayStart = Math.max(hmToMin(st.planStart || '07:00'), opts.startMin != null ? roundUp5(opts.startMin) : 0);
  const dayEnd = hmToMin(st.planEnd || '23:30');
  const blocks = [];

  for (const fe of opts.fixedEvents || []) {
    if (fe.weekday !== wd) continue;
    const s = hmToMin(fe.start), e = hmToMin(fe.end);
    const tr = fe.travel === false ? 0 : (st.travelMinAroundFixed || 0);
    if (tr) blocks.push({ kind: 'travel', title: '移動', s: s - tr, e: s });
    blocks.push({ kind: 'fixed', title: fe.title, s: s, e: e });
    if (tr) blocks.push({ kind: 'travel', title: '移動', s: e, e: e + tr });
  }
  for (const b of (opts.plan && opts.plan.blocks) || []) {
    const s = hmToMin(b.start), e = hmToMin(b.end);
    if (s == null || e == null) continue;
    if (blocks.some((x) => x.kind === 'fixed' && x.s === s && x.e === e)) continue;
    blocks.push({ kind: 'fixed', title: b.title, s: s, e: e });
  }
  for (const m of st.meals || []) {
    const s = hmToMin(m.start);
    blocks.push({ kind: 'meal', title: m.label, s: s, e: s + (m.min || 60) });
  }

  const undone = (opts.tasks || []).filter((t) => !t.done && !t.deleted);
  const pinned = undone.filter((t) => t.fixedTime && t.start);
  for (const t of pinned) {
    const s = hmToMin(t.start);
    blocks.push({ kind: 'pinned', title: t.title, taskId: t.id, s: s, e: s + (t.slotMin || t.est || 30) });
  }

  let free = [{ s: dayStart, e: dayEnd }];
  for (const b of blocks) free = subtract(free, b.s, b.e);
  free = free.filter((iv) => iv.e - iv.s >= 5).map((iv) => ({ s: iv.s, e: iv.e, run: 0 }));
  const freeMin = free.reduce((a, iv) => a + iv.e - iv.s, 0);
  const capacity = Math.floor(freeMin * (1 - (st.bufferRatio == null ? 0.25 : st.bufferRatio)));

  const focus = FOCUS[st.focusPeriod || 'afternoon'] || FOCUS.afternoon;
  const breakEvery = st.breakEveryMin || 90, breakMin = st.breakMin || 10;
  const placements = [], breaks = [], deferred = [];
  let used = 0;

  const candidates = undone.filter((t) => !(t.fixedTime && t.start)).sort(sortForSchedule);
  for (const t of candidates) {
    const f = factorFor(t, opts.ratios, st.defaultEstFactor);
    const dur = Math.max(5, roundUp5((t.est || 15) * f.factor));
    if (used + dur > capacity) { deferred.push({ taskId: t.id, title: t.title, dur: dur, reason: 'バッファ（空き時間の' + Math.round((st.bufferRatio == null ? 0.25 : st.bufferRatio) * 100) + '%）を残すため' }); continue; }
    const need = (iv) => dur + (iv.run > 0 && iv.run + dur > breakEvery ? breakMin : 0);
    const fits = free.filter((iv) => iv.e - iv.s >= need(iv));
    if (!fits.length) { deferred.push({ taskId: t.id, title: t.title, dur: dur, reason: dur + '分続けて入る空き時間がない' }); continue; }
    let pick;
    if (dur >= 45) {
      pick = fits.find((iv) => iv.s >= focus[0] && iv.s < focus[1]) || fits.find((iv) => iv.e > focus[0] && iv.s < focus[1]) || fits[0];
      if (pick.s < focus[0] && pick.e - focus[0] >= need(pick) && pick.e > focus[0]) {
        // 集中しやすい時間帯の始まりに寄せる
        const idx = free.indexOf(pick);
        free.splice(idx, 1, { s: pick.s, e: focus[0], run: pick.run }, { s: focus[0], e: pick.e, run: 0 });
        pick = free[idx + 1];
      }
    } else if (dur <= 20) {
      pick = fits.slice().sort((a, b) => (a.e - a.s) - (b.e - b.s) || a.s - b.s)[0];
    } else {
      pick = fits[0];
    }
    if (pick.run > 0 && pick.run + dur > breakEvery) {
      breaks.push({ start: minToHm(pick.s), end: minToHm(pick.s + breakMin) });
      pick.s += breakMin; pick.run = 0;
    }
    placements.push({ taskId: t.id, title: t.title, start: minToHm(pick.s), end: minToHm(pick.s + dur), dur: dur, factor: f.factor, factorSource: f.source });
    pick.s += dur; pick.run += dur; used += dur;
    free = free.filter((iv) => iv.e - iv.s >= 5);
  }

  return {
    placements: placements, breaks: breaks, deferred: deferred,
    blocks: blocks.map((b) => ({ kind: b.kind, title: b.title, taskId: b.taskId, start: minToHm(b.s), end: minToHm(b.e) })).sort((a, b) => (a.start < b.start ? -1 : 1)),
    stats: { freeMin: freeMin, capacityMin: capacity, usedMin: used, bufferMin: freeMin - used, dayStart: minToHm(dayStart), dayEnd: minToHm(dayEnd) },
  };
}
