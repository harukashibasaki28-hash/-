// メール本文などから日付を見つける（締切の候補）
// 年が無いものは「基準日以降で一番近い日付」と解釈する。GAS にも同梱される。
import { addDays } from './dates.js';

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function toHalfWidth(s) {
  return String(s || '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/／/g, '/').replace(/：/g, ':').replace(/（/g, '(').replace(/）/g, ')');
}

function valid(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function nearestFuture(m, d, refDk) {
  const ry = Number(refDk.slice(0, 4));
  for (const y of [ry, ry + 1]) {
    if (!valid(y, m, d)) continue;
    const k = y + '-' + pad2(m) + '-' + pad2(d);
    if (k >= refDk) return k;
  }
  return null;
}

export function extractDates(text, refDk, limit) {
  const s = toHalfWidth(text);
  const found = [];
  const add = (dk, raw, idx) => {
    if (!dk || found.some((f) => f.date === dk)) return;
    const ctx = s.slice(Math.max(0, idx - 20), Math.min(s.length, idx + raw.length + 20)).replace(/\s+/g, ' ').trim();
    found.push({ date: dk, text: raw, context: ctx });
  };
  let m;
  const full = /(20\d{2})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*日?/g;
  const taken = [];
  while ((m = full.exec(s))) {
    const y = +m[1], mo = +m[2], d = +m[3];
    taken.push([m.index, m.index + m[0].length]);
    if (valid(y, mo, d)) add(y + '-' + pad2(mo) + '-' + pad2(d), m[0], m.index);
  }
  const overlaps = (i) => taken.some(([a, b]) => i >= a && i < b);
  const jp = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/g;
  while ((m = jp.exec(s))) if (!overlaps(m.index)) add(nearestFuture(+m[1], +m[2], refDk), m[0], m.index);
  const slash = /(^|[^\d/])(\d{1,2})\/(\d{1,2})(?![\d/])(\s*\([月火水木金土日]\))?/g;
  while ((m = slash.exec(s))) {
    const i = m.index + m[1].length;
    if (overlaps(i)) continue;
    add(nearestFuture(+m[2], +m[3], refDk), m[0].slice(m[1].length), i);
  }
  const rel = [['明後日', 2], ['あさって', 2], ['明日', 1], ['あした', 1], ['本日', 0], ['今日', 0]];
  for (const [w, n] of rel) {
    const i = s.indexOf(w);
    if (i >= 0) add(addDays(refDk, n), w, i);
  }
  found.sort((a, b) => (a.date < b.date ? -1 : 1));
  return found.slice(0, limit || 5);
}
