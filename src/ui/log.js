// 「ログ」画面：日次ログ表（日付・就寝・起床・睡眠・昼寝・予定数・完了数・メモ）
import { esc, fmtMin, fmtTime } from './util.js';
import { formatMd, addDays } from '../core/dates.js';
import { daySummary } from '../core/stats.js';
import { downloadText } from '../notify/ics.js';

export function logRows(view, from, to) {
  const keys = Object.keys(view.days).filter((k) => k >= from && k <= to).sort().reverse();
  return keys.map((k) => {
    const d = view.days[k];
    const s = daySummary(d);
    return { date: k, bed: s.bed, wake: s.wake, sleepMin: s.sleepMin, napCount: s.napCount, napMin: s.napMin, planned: d.closed && d.planned != null ? d.planned : s.planned, done: d.closed && d.done != null ? d.done : s.done, note: d.note || '' };
  });
}

export function render(app) {
  const to = app.today();
  const days = app.state.logDays || 30;
  const rows = logRows(app.store.view, addDays(to, -days + 1), to);
  return '<section class="card"><div class="row-between"><h2>日次ログ</h2><button data-act="logCsv">CSV</button></div><div class="table-wrap"><table class="log"><thead><tr><th>日付</th><th>就寝</th><th>起床</th><th>睡眠</th><th>昼寝</th><th>予定</th><th>完了</th><th>メモ</th></tr></thead><tbody>' +
    rows.map((r) => '<tr><td>' + formatMd(r.date) + '</td><td>' + fmtTime(r.bed) + '</td><td>' + fmtTime(r.wake) + '</td><td>' + fmtMin(r.sleepMin) + '</td><td>' + (r.napCount ? r.napCount + '回 ' + fmtMin(r.napMin) : '—') + '</td><td>' + r.planned + '</td><td>' + r.done + '</td><td class="note">' + esc(r.note) + '</td></tr>').join('') +
    '</tbody></table></div><button class="wide" data-act="logMore">さらに 30 日分</button></section>';
}

export const acts = {
  logMore(app) { app.state.logDays = (app.state.logDays || 30) + 30; app.rerender(); },
  logCsv(app) {
    const rows = logRows(app.store.view, '0000-00-00', app.today());
    const q = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
    const csv = '﻿日付,就寝,起床,睡眠(分),昼寝(回),昼寝(分),予定数,完了数,メモ\n' + rows.map((r) => [r.date, fmtTime(r.bed), fmtTime(r.wake), r.sleepMin == null ? '' : r.sleepMin, r.napCount, r.napMin, r.planned, r.done, q(r.note)].join(',')).join('\n');
    downloadText('techo-log-' + app.today() + '.csv', csv, 'text/csv');
  },
};
