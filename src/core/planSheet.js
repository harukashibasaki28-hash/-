// 学習計画スプレッドシート（「予定一覧」「毎日の時間割」）とカレンダー予定の読み取り
// 値は getDisplayValues() の文字列を想定。GAS にも同梱される。
import { addDays, weekday, hmToMin, minToHm } from './dates.js';

function pad2(n) { return (n < 10 ? '0' : '') + n; }

export function hashStr(s) {
  let h = 5381;
  const str = String(s);
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// '2026/11/13' / '2026-11-13' / '2026年11月13日' → '2026-11-13'
export function parseSheetDate(v) {
  if (v == null || v === '') return null;
  const m = String(v).trim().match(/^(\d{4})\s*[/.\-年]\s*(\d{1,2})\s*[/.\-月]\s*(\d{1,2})/);
  return m ? m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]) : null;
}

// '19:00〜21:00' → { start, end }。終日・空欄は null
export function parseTimeRange(v) {
  const m = String(v || '').replace(/[：]/g, ':').match(/(\d{1,2}:\d{2})\s*[〜~\-－ー]\s*(\d{1,2}:\d{2})/);
  return m ? { start: minToHm(hmToMin(m[1])), end: minToHm(hmToMin(m[2])) } : null;
}

function headerIndex(header, names) {
  const idx = {};
  for (const k of Object.keys(names)) {
    idx[k] = header.findIndex((h) => String(h).trim() === names[k]);
  }
  return idx;
}

// ── 予定一覧 ─────────────────────────────
export const PLAN_COLS = { start: '開始日', end: '終了日', time: '時間', kind: '種類', title: '予定', progress: '進捗', memo: '内容・メモ' };

export function parsePlanRows(values) {
  if (!values || !values.length) return [];
  const ix = headerIndex(values[0], PLAN_COLS);
  const out = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const get = (k) => (ix[k] >= 0 ? String(row[ix[k]] == null ? '' : row[ix[k]]).trim() : '');
    const start = parseSheetDate(get('start'));
    const title = get('title');
    if (!start || !title) continue;
    out.push({
      row: r + 1, start: start, end: parseSheetDate(get('end')), time: parseTimeRange(get('time')),
      kind: get('kind'), title: title, progress: get('progress'), memo: get('memo'),
    });
  }
  return out;
}

export function planTaskId(item) { return 'plan:' + item.start + ':' + hashStr(item.title); }

// その日の 予定一覧 → { tasks, blocks, goals, upcoming }
export function planItemsForDate(items, dk, upcomingDays) {
  const res = { tasks: [], blocks: [], goals: [], upcoming: [] };
  for (const it of items) {
    if (it.progress === '完了') continue;
    const end = it.end || it.start;
    if (it.time) {
      if (it.start <= dk && dk <= end) res.blocks.push({ title: it.title, start: it.time.start, end: it.time.end, source: 'plan', memo: it.memo });
      continue;
    }
    if (it.end && it.end !== it.start) {
      if (it.start <= dk && dk <= it.end) res.goals.push({ title: it.title, from: it.start, to: it.end, memo: it.memo, kind: it.kind });
      continue;
    }
    if (it.start === dk) {
      res.tasks.push({
        id: planTaskId(it), title: it.title, priority: /締切|試験/.test(it.kind) ? 1 : 2, est: 30,
        deadline: dk, source: 'plan', planRef: { start: it.start, title: it.title }, memo: it.memo,
      });
    } else if (it.start > dk && it.start <= addDays(dk, upcomingDays || 7) && /締切|試験/.test(it.kind)) {
      res.upcoming.push({ title: it.title, date: it.start, kind: it.kind });
    }
  }
  return res;
}

// 「FP2級：タックスプランニング」の終了日 → 章の期限
export function chapterDues(items, subject) {
  const out = {};
  const norm = (s) => String(s || '').replace(/\s/g, '').replace('継承', '承継');
  const prefix = subject.name + '：';
  for (const it of items) {
    if (it.title.indexOf(prefix) !== 0 || !it.end) continue;
    const label = norm(it.title.slice(prefix.length));
    for (const item of (subject.structure && subject.structure.items) || []) {
      if (item.label && norm(item.label) === label) out[item.n] = it.end;
    }
  }
  return out;
}

// ── 毎日の時間割 ─────────────────────────
export const TT_COLS = { days: '曜日', start: '開始', end: '終了', title: '内容', category: '分類', period: '期間', memo: '休み・メモ' };
const WD = { 日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6 };

export function parseWeekdays(s) {
  const str = String(s || '').trim();
  if (/毎日/.test(str)) return [0, 1, 2, 3, 4, 5, 6];
  const range = str.match(/([日月火水木金土])\s*[〜~\-－]\s*([日月火水木金土])/);
  if (range) {
    const out = [];
    for (let d = WD[range[1]]; ; d = (d + 1) % 7) { out.push(d); if (d === WD[range[2]]) break; }
    return out;
  }
  const out = [];
  for (const ch of str) if (WD[ch] != null && out.indexOf(WD[ch]) < 0) out.push(WD[ch]);
  return out;
}

// 'm/d' を、dk の前後で意味の通る年に
function mdToDate(md, year) {
  const m = String(md).match(/(\d{1,2})\/(\d{1,2})/);
  return m ? year + '-' + pad2(+m[1]) + '-' + pad2(+m[2]) : null;
}

// '11/13〜3/12' が dk を含むか
export function periodContains(period, dk) {
  const m = String(period || '').match(/(\d{1,2}\/\d{1,2})\s*[〜~\-－]\s*(\d{1,2}\/\d{1,2})/);
  if (!m) return true;
  const y = Number(dk.slice(0, 4));
  for (const sy of [y - 1, y]) {
    const s = mdToDate(m[1], sy);
    let e = mdToDate(m[2], sy);
    if (e < s) e = mdToDate(m[2], sy + 1);
    if (s <= dk && dk <= e) return true;
  }
  return false;
}

export function periodStart(period, dk) {
  const m = String(period || '').match(/(\d{1,2}\/\d{1,2})\s*[〜~\-－]\s*(\d{1,2}\/\d{1,2})/);
  if (!m) return null;
  const y = Number(dk.slice(0, 4));
  for (const sy of [y, y - 1]) {
    const s = mdToDate(m[1], sy);
    if (s <= dk) return s;
  }
  return null;
}

// 「休み：11/18、12/18、1/20〜1/22（FP直前）」に dk が含まれるか
export function isHoliday(memo, dk) {
  const idx = String(memo || '').indexOf('休み');
  if (idx < 0) return false;
  const s = String(memo).slice(idx);
  const md = dk.slice(5).split('-').map(Number);
  const cur = md[0] * 100 + md[1];
  const re = /(\d{1,2})\/(\d{1,2})(?:\s*[〜~\-－]\s*(\d{1,2})\/(\d{1,2}))?/g;
  let m;
  while ((m = re.exec(s))) {
    const a = +m[1] * 100 + +m[2];
    if (!m[3]) { if (a === cur) return true; continue; }
    const b = +m[3] * 100 + +m[4];
    if (a <= b ? cur >= a && cur <= b : cur >= a || cur <= b) return true;
  }
  return false;
}

export function parseTimetable(values) {
  if (!values || !values.length) return [];
  const ix = headerIndex(values[0], TT_COLS);
  const out = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const get = (k) => (ix[k] >= 0 ? String(row[ix[k]] == null ? '' : row[ix[k]]).trim() : '');
    if (!get('title')) continue;
    out.push({
      row: r + 1, days: parseWeekdays(get('days')), daysText: get('days'),
      start: hmToMin(get('start')) == null ? null : minToHm(hmToMin(get('start'))),
      end: hmToMin(get('end')) == null ? null : minToHm(hmToMin(get('end'))),
      title: get('title'), category: get('category'), period: get('period'), memo: get('memo'),
    });
  }
  return out;
}

function rowActive(row, dk) {
  return row.days.indexOf(weekday(dk)) >= 0 && periodContains(row.period, dk) && !isHoliday(row.memo, dk);
}

// 「A／B（隔日交互）」を、期間の初日から数えて交互に
function resolveAlternation(row, rows, dk) {
  const m = row.title.match(/^(.*?)([^：／]+)／([^（(]+)[（(]隔日交互[）)]/);
  if (!m) return row.title;
  const same = rows.filter((r) => r.title === row.title);
  let from = null;
  for (const r of same) { const ps = periodStart(r.period, dk); if (ps && (!from || ps < from)) from = ps; }
  if (!from) from = addDays(dk, -60);
  let n = 0;
  for (let d = from; d < dk; d = addDays(d, 1)) if (same.some((r) => rowActive(r, d))) n++;
  return m[1] + (n % 2 === 0 ? m[2] : m[3]).trim();
}

// その日の時間の枠
export function timetableSlots(rows, dk) {
  const out = [];
  for (const row of rows) {
    if (!row.start || !row.end || /予備日/.test(row.category)) continue;
    if (!rowActive(row, dk)) continue;
    out.push({
      key: hashStr(row.title + '|' + row.daysText), title: resolveAlternation(row, rows, dk), baseTitle: row.title,
      start: row.start, end: row.end, min: hmToMin(row.end) - hmToMin(row.start), category: row.category,
    });
  }
  return out.sort((a, b) => (a.start < b.start ? -1 : 1));
}

// ── カレンダー予定 ─────────────────────────
// ev: { title, start:'HH:MM'|null, end, allDay, recurring, transparent, description }
export function isTechoEvent(ev) {
  return /^【手帳】/.test(ev.title || '') || /手帳ID[:：]/.test(ev.description || '');
}

export function calendarItems(events, slots) {
  const res = { blocks: [], goals: [] };
  for (const ev of events || []) {
    if (isTechoEvent(ev)) continue;
    if (ev.allDay) { res.goals.push({ title: ev.title, source: 'calendar' }); continue; }
    if (!ev.start || !ev.end) continue;
    if (ev.recurring && slots.some((s) => hmToMin(s.start) < hmToMin(ev.end) && hmToMin(ev.start) < hmToMin(s.end))) continue;
    res.blocks.push({ title: ev.title, start: ev.start, end: ev.end, source: 'calendar' });
  }
  return res;
}
