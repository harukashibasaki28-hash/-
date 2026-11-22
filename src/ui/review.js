// 「振り返り」画面：今日の進捗（夜）と週の振り返り（日曜）
import { esc, fmtMin, fmtTime, fmtPct, fmtRatio } from './util.js';
import { formatMd, addDays, minToHm, weekday } from '../core/dates.js';
import { daySummary, weekSummary, lastSunday } from '../core/stats.js';
import { computeRatios } from '../core/estimates.js';
import { runAnalysis } from '../analysis/index.js';
import { evaluateRules, weeklyFocus } from '../analysis/ruleEngine.js';
import { lineChart, barChart } from './chart.js';
import * as A from '../actions.js';

function ctxFor(app, dk) {
  const v = app.store.view;
  return { date: dk, days: v.days, settings: v.settings, rules: v.rules, ratios: computeRatios(v.allTasks, dk, 28), templates: v.templates, subjects: v.subjects };
}

export function render(app) {
  const today = app.today();
  const dk = app.state.reviewDate || today;
  const v = app.store.view;
  const day = v.days[dk] || { tasks: [], naps: [] };
  const s = daySummary(day);
  const out = [];

  out.push('<section class="card"><div class="row-between"><h2>' + (dk === today ? '今日の進捗' : formatMd(dk) + ' の進捗') + '</h2><div class="seg">' +
    '<button data-act="rvDate" data-date="' + addDays(dk, -1) + '">◀</button>' +
    '<button data-act="rvDate" data-date="' + today + '"' + (dk === today ? ' class="on"' : '') + '>今日</button>' +
    '<button data-act="rvDate" data-date="' + addDays(dk, 1) + '"' + (dk >= today ? ' disabled' : '') + '>▶</button></div></div>');
  out.push('<div class="stats">' +
    stat('睡眠時間', fmtMin(s.sleepMin), s.bed ? fmtTime(s.bed) + '→' + fmtTime(s.wake) : '') +
    stat('昼寝', s.napCount + '回', fmtMin(s.napMin)) +
    stat('完了率', fmtPct(s.rate), s.done + '/' + s.planned) +
    stat('【min】', s.minDone + '/' + s.minTotal, s.minTotal && s.minDone === s.minTotal ? '達成' : '') +
    stat('見積と実績', fmtRatio(s.ratio), '') +
    stat('予定開始とのずれ', s.startDelay == null ? '—' : (s.startDelay >= 0 ? '+' : '') + s.startDelay + '分', '平均') + '</div>');
  out.push('<div id="findings" class="findings"><p class="muted">分析中…</p></div>');
  out.push('<form class="review-form" data-form="review" data-date="' + dk + '"><label>ひとこと振り返り<textarea name="review" rows="3">' + esc(day.review || '') + '</textarea></label>' +
    '<label>メモ<textarea name="note" rows="2">' + esc(day.note || '') + '</textarea></label><button class="primary">保存</button></form>');
  out.push('</section>');

  // 週
  const defEnd = weekday(today) === 0 ? today : lastSunday(addDays(today, 7));
  const end = app.state.weekEnd || defEnd;
  const w = weekSummary(v.days, end, v.settings.bedTarget);
  const perDay = w.rows.map((r) => evaluateRules(ctxFor(app, r.date)).findings);
  const focus = weeklyFocus(perDay);
  out.push('<section class="card"><div class="row-between"><h2>週の振り返り</h2><div class="seg">' +
    '<button data-act="wkEnd" data-date="' + addDays(end, -7) + '">◀</button><button data-act="wkEnd" data-date="' + defEnd + '"' + (end === defEnd ? ' class="on"' : '') + '>今週</button>' +
    '<button data-act="wkEnd" data-date="' + addDays(end, 7) + '"' + (end >= defEnd ? ' disabled' : '') + '>▶</button></div></div>');
  out.push('<p class="muted small">' + formatMd(w.from) + '〜' + formatMd(w.to) + (weekday(today) === 0 && end === today ? '（日曜日：今週のまとめ）' : '') + '</p>');
  out.push('<div class="stats">' + stat('平均睡眠', fmtMin(w.avgSleepMin), '') +
    stat('就寝のばらつき', w.bedStdMin == null ? '—' : '±' + w.bedStdMin + '分', w.avgBedMin == null ? '' : '平均 ' + minToHm(w.avgBedMin)) +
    stat('平均完了率', fmtPct(w.avgRate), '') + stat('就寝が60分以上遅い日', w.lateBedDays + '日', '') + '</div>');
  out.push('<h3>完了率の推移</h3>' + lineChart(w.rows.map((r) => ({ label: formatMd(r.date).replace(/^\d+\//, ''), value: r.rate == null ? null : r.rate * 100 })), { max: 100, unit: '%', title: '完了率の推移' }));
  out.push('<h3>睡眠時間</h3>' + barChart(w.rows.map((r) => ({ label: formatMd(r.date).replace(/^\d+\//, ''), value: r.sleepMin, text: fmtMin(r.sleepMin) })), { max: 600, target: 420, tick: (x) => Math.round(x / 60) + 'h', title: '睡眠時間' }));
  out.push('<div class="focus"><h3>翌週に変えること</h3>' + (focus ? '<p class="big-advice">' + esc(focus.advice) + '</p><p class="muted small">理由：' + esc(focus.issue) + '（今週 ' + focus.days + ' 日）</p>' : '<p>大きな課題はありません。この調子で。</p>') + '</div>');
  out.push('</section>');

  // 分析（非同期。AI 分析を足しても同じ場所に出る）
  runAnalysis(ctxFor(app, dk)).then((res) => {
    const el = document.getElementById('findings');
    if (!el) return;
    el.innerHTML = res.findings.length
      ? '<h3>課題と改善策</h3><ul>' + res.findings.map((f) => '<li class="sev' + f.severity + '"><div class="issue">' + esc(f.issue) + '</div><div class="advice">→ ' + esc(f.advice) + '</div></li>').join('') + '</ul>'
      : '<p>課題は見つかりませんでした。</p>';
    if (res.errors.length) el.innerHTML += '<p class="muted small">' + esc(res.errors.join(' / ')) + '</p>';
  });
  return out.join('');
}

function stat(label, value, sub) {
  return '<div class="stat"><div class="stat-label">' + esc(label) + '</div><div class="stat-value">' + esc(value) + '</div>' + (sub ? '<div class="stat-sub">' + esc(sub) + '</div>' : '') + '</div>';
}

export const acts = {
  rvDate(app, el) { app.state.reviewDate = el.dataset.date; app.rerender(); },
  wkEnd(app, el) { app.state.weekEnd = el.dataset.date; app.rerender(); },
};

export const forms = {
  async review(app, f, form) { await A.saveDayFields(app.store, form.dataset.date, { review: f.review, note: f.note }); app.toast('保存しました'); },
};
