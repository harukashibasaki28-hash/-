// JSON の読み込み・書き出し
// 受け付ける形:
//  1. 書き出し形式 { format:'techo', days:{...}, hourensou:{...}, templates, subjects, settings, ... }
//  2. 今の手帳のキー形式 { "days/2026-11-22": {...}, "hourensou/abc": {...} }
//  3. 一部分だけ { days:{...} } / { hourensou:{...} }
import { normalizeTask, normalizeSpan } from '../core/tasks.js';
import { minutesBetween } from '../core/dates.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CONFIG_KEYS = ['settings', 'fixedEvents', 'templates', 'subjects', 'rules', 'links'];

export class ImportError extends Error {}

export function parseJsonText(text) {
  let obj;
  try {
    obj = JSON.parse(String(text).replace(/^﻿/, ''));
  } catch (e) {
    throw new ImportError('JSON として読み込めません（' + e.message + '）');
  }
  return normalizeImport(obj);
}

// どの形でも { days, hourensou, config, warnings } にそろえる
export function normalizeImport(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new ImportError('JSON の一番外側は { } である必要があります');
  const out = { days: {}, hourensou: {}, config: {}, warnings: [] };
  const rawDays = {};
  const rawHou = {};

  for (const key of Object.keys(obj)) {
    const v = obj[key];
    let m;
    if ((m = key.match(/^days\/(\d{4}-\d{2}-\d{2})$/))) rawDays[m[1]] = v;
    else if ((m = key.match(/^hourensou\/(.+)$/))) rawHou[m[1]] = v;
    else if (key === 'days' && v && typeof v === 'object') {
      if (Array.isArray(v)) { for (const d of v) if (d && d.date) rawDays[d.date] = d; }
      else Object.assign(rawDays, v);
    } else if (key === 'hourensou' && v && typeof v === 'object') {
      if (Array.isArray(v)) { for (const h of v) if (h && h.id) rawHou[h.id] = h; }
      else Object.assign(rawHou, v);
    } else if (CONFIG_KEYS.indexOf(key) >= 0) out.config[key] = v;
  }

  for (const dk of Object.keys(rawDays)) {
    if (!DATE_RE.test(dk)) { out.warnings.push('日付の形が違うため読み飛ばしました: ' + dk); continue; }
    out.days[dk] = normalizeDay(rawDays[dk], dk);
  }
  for (const id of Object.keys(rawHou)) out.hourensou[id] = normalizeHourensou(rawHou[id], id);

  if (!Object.keys(out.days).length && !Object.keys(out.hourensou).length && !Object.keys(out.config).length) {
    throw new ImportError('days / hourensou / 設定 のどれも見つかりませんでした');
  }
  return out;
}

export function normalizeDay(d, dk) {
  const day = Object.assign({}, d || {});
  let tasks = day.tasks || [];
  if (!Array.isArray(tasks)) tasks = Object.keys(tasks).map((id) => Object.assign({ id: id }, tasks[id]));
  day.tasks = tasks.map((t) => normalizeTask(t, dk));
  if (day.sleep && typeof day.sleep === 'object') {
    const s = Object.assign({ bed: null, wake: null, min: null }, day.sleep);
    if ((s.min == null || s.min === '') && s.bed && s.wake) s.min = minutesBetween(s.bed, s.wake);
    s.min = s.min == null ? null : Number(s.min);
    day.sleep = s;
  } else day.sleep = null;
  day.naps = Array.isArray(day.naps) ? day.naps.map((n) => {
    const o = normalizeSpan(n);
    if (!o.min && o.start && o.end) o.min = minutesBetween(o.start, o.end);
    return o;
  }) : [];
  day.note = day.note == null ? '' : String(day.note);
  day.review = day.review == null ? '' : day.review;
  day.closed = !!day.closed;
  if (day.rate != null && day.rate !== '') {
    let r = Number(day.rate);
    if (r > 1) r = r / 100; // 百分率で入っていた場合
    day.rate = isNaN(r) ? null : Math.round(r * 100) / 100;
  } else day.rate = null;
  for (const k of ['planned', 'done']) day[k] = day[k] == null || day[k] === '' ? null : Number(day[k]);
  return day;
}

export function normalizeHourensou(h, id) {
  const o = Object.assign({ to: '', what: '', kind: '連絡', due: null, done: false }, h || {});
  o.id = String(o.id || id);
  if (['報告', '連絡', '相談'].indexOf(o.kind) < 0) o.kind = '連絡';
  o.done = !!o.done;
  return o;
}

// 読み込み前のプレビュー
export function previewImport(data) {
  const dates = Object.keys(data.days).sort();
  let tasks = 0;
  for (const dk of dates) tasks += data.days[dk].tasks.length;
  return {
    days: dates.length, from: dates[0] || null, to: dates[dates.length - 1] || null,
    tasks: tasks, hourensou: Object.keys(data.hourensou).length,
    config: Object.keys(data.config), warnings: data.warnings,
  };
}

// 書き出し（今の形＋設定）
export function buildExport(view, now) {
  const days = {};
  for (const dk of Object.keys(view.days).sort()) {
    const d = view.days[dk];
    days[dk] = Object.assign({}, d, { tasks: (d.tasks || []).map((t) => { const o = Object.assign({}, t); delete o.date; return o; }) });
  }
  return {
    format: 'techo', version: 1, exportedAt: now,
    days: days, hourensou: view.hourensou,
    settings: view.settings, fixedEvents: view.fixedEvents, templates: view.templates,
    subjects: view.subjects, rules: view.rules, links: view.links,
  };
}
