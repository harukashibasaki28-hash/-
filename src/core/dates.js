// 日付・時刻のユーティリティ（Asia/Tokyo 固定。端末のタイムゾーンに依存しない）
// このファイルは GAS にも同梱される（tools/build-gas.mjs）。import を書かないこと。

export const JST_OFFSET_MIN = 9 * 60;
const MS_MIN = 60000;
const MS_DAY = 86400000;

function pad2(n) { return (n < 10 ? '0' : '') + n; }

// Date → 東京時間の各要素
export function jstParts(date) {
  const d = new Date(date.getTime() + JST_OFFSET_MIN * MS_MIN);
  return {
    y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(),
    hh: d.getUTCHours(), mm: d.getUTCMinutes(), ss: d.getUTCSeconds(), wd: d.getUTCDay(),
  };
}

// Date → 'YYYY-MM-DD'（東京）
export function dateKey(date) {
  const p = jstParts(date);
  return p.y + '-' + pad2(p.m) + '-' + pad2(p.d);
}

// Date → '2026-11-22T23:41:00+09:00'
export function toIso(date) {
  const p = jstParts(date);
  return p.y + '-' + pad2(p.m) + '-' + pad2(p.d) + 'T' + pad2(p.hh) + ':' + pad2(p.mm) + ':' + pad2(p.ss) + '+09:00';
}

// ISO 文字列 → Date。タイムゾーンが無い文字列は東京時間とみなす
export function parseIso(s) {
  if (!s) return null;
  if (s instanceof Date) return s;
  let str = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) str += 'T00:00:00';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(str)) str += '+09:00';
  const t = Date.parse(str);
  return isNaN(t) ? null : new Date(t);
}

// 'YYYY-MM-DD' + 'HH:MM' → Date（東京）。'24:00' や '25:30' も翌日として扱う
export function atTime(dk, hhmm) {
  const mins = hmToMin(hhmm);
  const base = parseIso(dk + 'T00:00:00+09:00');
  return new Date(base.getTime() + mins * MS_MIN);
}

export function hmToMin(hhmm) {
  if (hhmm == null || hhmm === '') return null;
  const m = String(hhmm).trim().match(/^(\d{1,2})[:：](\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function minToHm(min) {
  const m = Math.round(min);
  return pad2(Math.floor(m / 60)) + ':' + pad2(((m % 60) + 60) % 60);
}

// Date → その日 0:00 からの分（東京）
export function minOfDay(date) {
  const p = jstParts(date);
  return p.hh * 60 + p.mm + p.ss / 60;
}

export function addDays(dk, n) {
  const t = parseIso(dk + 'T12:00:00+09:00').getTime() + n * MS_DAY;
  return dateKey(new Date(t));
}

// 曜日（0=日〜6=土）
export function weekday(dk) {
  return parseIso(dk + 'T12:00:00+09:00').getUTCDay();
}

export function diffDays(fromDk, toDk) {
  return Math.round((parseIso(toDk + 'T12:00:00+09:00') - parseIso(fromDk + 'T12:00:00+09:00')) / MS_DAY);
}

// 2つの時刻の差（分）。end が start より前なら 0
export function minutesBetween(start, end) {
  const a = parseIso(start), b = parseIso(end);
  if (!a || !b) return 0;
  return Math.max(0, Math.round((b - a) / MS_MIN));
}

// 「論理日付」：dayStartsAt（既定 '00:00'）より前の時刻は前日扱い
export function logicalDate(date, dayStartsAt) {
  const off = hmToMin(dayStartsAt || '00:00') || 0;
  return dateKey(new Date(date.getTime() - off * MS_MIN));
}

export function dateRange(fromDk, toDk) {
  const out = [];
  for (let d = fromDk; d <= toDk; d = addDays(d, 1)) out.push(d);
  return out;
}

export const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

export function formatMd(dk) {
  const [, m, d] = dk.split('-').map(Number);
  return m + '/' + d + '(' + WEEKDAY_JA[weekday(dk)] + ')';
}

export function formatHm(iso) {
  const d = parseIso(iso);
  if (!d) return '';
  const p = jstParts(d);
  return pad2(p.hh) + ':' + pad2(p.mm);
}
