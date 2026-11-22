// 画面づくりの小道具
import { formatHm, parseIso, minToHm } from '../core/dates.js';

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtMin(min) {
  if (min == null || isNaN(min)) return '—';
  const m = Math.round(min);
  const h = Math.floor(Math.abs(m) / 60), r = Math.abs(m) % 60;
  return (m < 0 ? '-' : '') + (h ? h + '時間' + (r ? r + '分' : '') : r + '分');
}

export function fmtTime(iso) { return iso ? formatHm(iso) : '—'; }
export function fmtPct(r) { return r == null ? '—' : Math.round(r * 100) + '%'; }
export function fmtRatio(r) { return r == null ? '—' : r.toFixed(2) + '倍'; }

export const PRIORITY = { 1: '高', 2: '中', 3: '低' };

export function tagChip(tag) {
  if (!tag) return '';
  const cls = tag === 'min' ? 'chip-min' : tag === 'A' ? 'chip-a' : 'chip-opt';
  return '<span class="chip ' + cls + '">' + esc(tag) + '</span>';
}

export function isoToLocalInput(iso) {
  const d = parseIso(iso);
  if (!d) return '';
  const p = new Date(d.getTime() + 9 * 3600000).toISOString();
  return p.slice(0, 16);
}

export function localInputToIso(v) {
  if (!v) return null;
  return v.length === 16 ? v + ':00+09:00' : v;
}

export function hm(min) { return minToHm(min); }

// フォームの値をまとめて取る
export function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'number') o[el.name] = el.value === '' ? null : Number(el.value);
    else o[el.name] = el.value;
  }
  return o;
}
