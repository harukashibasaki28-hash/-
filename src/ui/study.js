// 「学習」画面：科目の進み具合・遅れ警告・追加/編集/終了・終了した科目の記録
import { esc, fmtMin } from './util.js';
import { formatMd, addDays } from '../core/dates.js';
import { srsOverview, planSrs } from '../core/srs.js';
import { subjectProgress, expandUnits } from '../core/study.js';
import * as A from '../actions.js';

export function render(app) {
  const v = app.store.view;
  const dk = app.today();
  const active = v.subjects.filter((s) => s.status !== 'finished');
  const finished = v.subjects.filter((s) => s.status === 'finished');
  const out = [];
  for (const s of active) out.push(s.type === 'srs' ? srsCard(app, s, dk) : card(app, s, dk));
  out.push('<button class="primary wide" data-act="subjEdit">＋ 科目を追加</button>');
  if (finished.length) {
    out.push('<section class="card"><h2>終了した科目</h2>');
    for (const s of finished) {
      const p = subjectProgress(s, v.allTasks, dk);
      const doneDates = p.units.filter((u) => u.done && u.doneDate && u.doneDate !== '0000-00-00').map((u) => u.doneDate).sort();
      out.push('<details><summary>' + esc(s.name) + '　<span class="muted small">' + (s.startedAt ? formatMd(s.startedAt) : (doneDates[0] ? formatMd(doneDates[0]) : '')) + '〜' + (s.finishedAt ? formatMd(s.finishedAt) : '') + '・' + p.done + '/' + p.total + '単位・' + fmtMin(p.actualMin) + '</span></summary>' +
        '<ul class="units">' + p.units.filter((u) => u.done).map((u) => '<li>' + esc(u.title) + '<span class="muted small">' + (u.doneDate && u.doneDate !== '0000-00-00' ? formatMd(u.doneDate) : '開始前に完了') + '</span></li>').join('') + '</ul>' +
        '<div class="actions"><button data-act="subjStatus" data-id="' + esc(s.id) + '" data-status="active">学習中に戻す</button><button data-act="subjEdit" data-id="' + esc(s.id) + '">編集</button></div></details>');
    }
    out.push('</section>');
  }
  return out.join('');
}

function card(app, s, dk) {
  const p = subjectProgress(s, app.store.view.allTasks, dk);
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  const out = ['<section class="card subject"><div class="row-between"><h2>' + esc(s.name) + ' <span class="chip ' + (s.tag === 'min' ? 'chip-min' : 'chip-a') + '">' + esc(s.tag || 'min') + '</span></h2>' +
    '<button class="ghost" data-act="subjEdit" data-id="' + esc(s.id) + '">編集</button></div>'];
  if (s.memo) out.push('<div class="memo">' + esc(s.memo) + '</div>');
  out.push('<div class="progress" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><div style="width:' + pct + '%"></div></div>');
  out.push('<p>' + p.done + ' / ' + p.total + ' 単位（' + pct + '%）・実績 ' + fmtMin(p.actualMin) + '</p>');
  out.push('<p>次：<b>' + (p.next ? esc(p.next.title) : 'すべて完了') + '</b>　今日の量：' + p.quotaToday + ' 単位' + (s.perDayMode === 'auto' ? '（期限から自動）' : '') + '</p>');
  if (s.examDate) out.push('<p class="muted small">試験日 ' + formatMd(s.examDate) + (p.projectedFinish ? '・このペースで終わる日 ' + formatMd(p.projectedFinish) : '') + '</p>');
  else if (p.projectedFinish) out.push('<p class="muted small">このペースで終わる日 ' + formatMd(p.projectedFinish) + '</p>');
  for (const m of p.messages) out.push('<div class="alert warn">' + esc(m) + '</div>');
  if (!p.behind && p.needs.length) {
    const n = p.needs[0];
    out.push('<p class="ok small">✓ ' + esc(n.label) + '（期限 ' + formatMd(n.due) + '）まで学習日 ' + n.days + ' 日・残り ' + n.remaining + ' 単位</p>');
  }
  if (p.needs.length) {
    out.push('<details><summary>期限ごとの必要ペース</summary><table class="mini"><tr><th>区切り</th><th>期限</th><th>残り</th><th>学習日</th><th>1日</th></tr>' +
      p.needs.map((n) => '<tr' + (n.overdue || n.perDay > 1 ? ' class="bad"' : '') + '><td>' + esc(n.label) + '</td><td>' + formatMd(n.due) + '</td><td>' + n.remaining + '</td><td>' + n.days + '</td><td>' + n.perDay + '</td></tr>').join('') + '</table></details>');
  }
  out.push('<div class="actions"><button data-act="subjNext" data-id="' + esc(s.id) + '">次の単位を今日に追加</button>' +
    '<button class="ghost" data-act="subjStatus" data-id="' + esc(s.id) + '" data-status="finished">終了にする</button></div>');
  out.push('</section>');
  return out.join('');
}

function itemsToText(s) {
  const items = (s.structure && s.structure.items) || [];
  return items.map((i) => [i.n, i.label || '', Array.isArray(i.units) ? i.units.length : i.secs != null ? i.secs : '', i.due || ''].join(', ')).join('\n');
}

function textToItems(text) {
  const items = [];
  for (const line of String(text || '').split(/\n/)) {
    const p = line.split(/[,，、]/).map((x) => x.trim());
    if (!p[0]) continue;
    const it = { n: isNaN(Number(p[0])) ? p[0] : Number(p[0]) };
    if (p[1]) it.label = p[1];
    if (p[2]) it.secs = Number(p[2]);
    if (p[3]) it.due = p[3].replace(/\//g, '-');
    items.push(it);
  }
  return items;
}

export function subjectForm(app, s) {
  const isNew = !s;
  s = s || { name: '', tag: 'min', status: 'active', est: 30, perDayMode: 'fixed', perDay: 1, maxPerDay: 3, studyDays: 'everyday', offDays: [], structure: { outer: { name: '章', format: '第{n}章', count: 10 }, inner: { name: 'Sec', format: 'Sec{n}', count: 5 } }, milestones: [], planSync: false };
  const st = s.structure || {};
  const inner = st.inner || {};
  const innerText = Array.isArray(inner.labels) ? inner.labels.join(',') : (inner.format || 'Sec{n}');
  const ms = (s.milestones || [])[0];
  const units = expandUnits(s);
  app.modal('<h2>' + (isNew ? '科目を追加' : esc(s.name) + ' を編集') + '</h2><form>' +
    '<label>名前<input name="name" required value="' + esc(s.name) + '"></label>' +
    '<div class="grid2"><label>種類<select name="tag">' + ['min', 'A', '任意'].map((t) => '<option' + (s.tag === t ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>' +
    '<label>状態<select name="status"><option value="active"' + (s.status !== 'finished' ? ' selected' : '') + '>学習中</option><option value="finished"' + (s.status === 'finished' ? ' selected' : '') + '>終了</option></select></label></div>' +
    '<div class="grid2"><label>試験日<input type="date" name="examDate" value="' + esc(s.examDate || '') + '"></label><label>目標日<input type="date" name="targetDate" value="' + esc(s.targetDate || '') + '"></label></div>' +
    '<fieldset><legend>区切り方</legend>' +
    '<div class="grid2"><label>外側の書式（{n}=番号）<input name="outerFormat" value="' + esc((st.outer && st.outer.format) || '{n}') + '"></label>' +
    '<label>外側の数（下の一覧が空のとき）<input type="number" name="outerCount" min="0" value="' + esc((st.outer && st.outer.count) || '') + '"></label></div>' +
    '<label>内側（「Sec{n}」のような書式、または「前半,後半」のような一覧）<input name="inner" value="' + esc(innerText) + '"></label>' +
    '<label>内側の数（書式のとき・下の一覧で個別に指定も可）<input type="number" name="innerCount" min="1" value="' + esc(inner.count || '') + '"></label>' +
    '<label>外側の一覧（学習する順。1 行に「番号, 名前, 内側の数, 期限」）<textarea name="items" rows="6" placeholder="4, タックスプランニング, 9, 2026-12-06">' + esc(itemsToText(s)) + '</textarea></label></fieldset>' +
    '<fieldset><legend>1 日の量</legend><div class="grid2"><label>決め方<select name="perDayMode"><option value="fixed"' + (s.perDayMode !== 'auto' ? ' selected' : '') + '>決まった量</option><option value="auto"' + (s.perDayMode === 'auto' ? ' selected' : '') + '>期限から逆算（自動）</option></select></label>' +
    '<label>1 日の量（決まった量のとき）<input type="number" name="perDay" min="1" value="' + (s.perDay || 1) + '"></label></div>' +
    '<div class="grid2"><label>自動のときの上限<input type="number" name="maxPerDay" min="1" value="' + (s.maxPerDay || 3) + '"></label>' +
    '<label>1 単位の見積（分）<input type="number" name="est" min="5" step="5" value="' + (s.est || 30) + '"></label></div>' +
    '<label>学習する日<select name="studyDays"><option value="everyday"' + (s.studyDays !== 'weekdays' ? ' selected' : '') + '>毎日</option><option value="weekdays"' + (s.studyDays === 'weekdays' ? ' selected' : '') + '>平日のみ</option></select></label>' +
    '<label>休みの日（カンマ区切り）<input name="offDays" value="' + esc((s.offDays || []).join(', ')) + '" placeholder="2026-12-31, 2027-01-01"></label></fieldset>' +
    '<fieldset><legend>区切りの翌日に入れるタスク（章末問題など）</legend><label class="check"><input type="checkbox" name="msOn"' + (ms ? ' checked' : '') + '> 使う</label>' +
    '<div class="grid2"><label>名前（{name}=科目名、{outer}=区切り）<input name="msTitle" value="' + esc(ms ? ms.title : '{name} {outer} 章末問題') + '"></label>' +
    '<label>見積（分）<input type="number" name="msEst" min="5" step="5" value="' + (ms ? ms.est : 75) + '"></label></div></fieldset>' +
    '<label>ここまで終わっている（使い始める前の分）<select name="doneBefore"><option value="">なし（最初から）</option>' + units.map((u) => '<option value="' + esc(u.key) + '"' + (s.doneBefore === u.key ? ' selected' : '') + '>' + esc(u.title) + '</option>').join('') + '</select></label>' +
    '<label class="check"><input type="checkbox" name="planSync"' + (s.planSync ? ' checked' : '') + '> 学習計画シートの「' + esc(s.name || '科目名') + '：○○」の進捗を書き戻す</label>' +
    '<button class="primary wide">保存</button></form>', async (f) => {
    const fixedList = (st.items || []).some((i) => Array.isArray(i.units));
    const isLabels = !fixedList && f.inner.indexOf('{n}') < 0;
    const items = textToItems(f.items);
    const structure = {
      outer: Object.assign({}, st.outer || {}, { format: f.outerFormat || '{n}', count: f.outerCount || undefined }),
      inner: isLabels ? { name: inner.name || '', labels: f.inner.split(/[,，、]/).map((x) => x.trim()).filter(Boolean) } : { name: inner.name || '', format: f.inner, count: f.innerCount || 1 },
    };
    if (items.length) structure.items = items;
    if (fixedList) { structure.outer = st.outer; structure.inner = st.inner; structure.items = (st.items || []).map((it) => { const e = items.find((x) => String(x.n) === String(it.n)); return Object.assign({}, it, e && e.due ? { due: e.due } : {}); }); }
    const subject = Object.assign({}, s, {
      name: f.name.trim(), tag: f.tag, status: f.status, examDate: f.examDate || null, targetDate: f.targetDate || null,
      structure, perDayMode: f.perDayMode, perDay: f.perDay || 1, maxPerDay: f.maxPerDay || 3, est: f.est || 30, studyDays: f.studyDays,
      offDays: f.offDays.split(/[,，、\s]+/).map((x) => x.trim().replace(/\//g, '-')).filter(Boolean),
      milestones: f.msOn ? [{ when: 'afterOuter', key: '章末問題', title: f.msTitle, est: f.msEst || 75 }] : [],
      doneBefore: f.doneBefore || null, planSync: !!f.planSync,
    });
    if (isNew) subject.startedAt = app.today();
    if (f.status === 'finished' && s.status !== 'finished') subject.finishedAt = app.today();
    await A.saveSubject(app.store, subject);
  });
}

const SRS_STATUS = { ok: '済', due: '今日', late: '遅れ', todo: 'まだ' };

function srsCard(app, s, dk) {
  const v = app.store.view;
  const rows = srsOverview(s, v.allTasks, dk);
  const todayTask = v.allTasks.find((t) => t.id === 'srs:' + s.id + ':' + dk);
  const plan = todayTask || planSrs(s, v.allTasks, dk, 'actual');
  const left = (s.round2Order || []).filter((k) => { const r = rows.find((x) => x.key === k); return r && !r.round2; });
  const out = ['<section class="card subject"><div class="row-between"><h2>' + esc(s.name) + ' <span class="chip chip-min">' + esc(s.tag || 'min') + '</span></h2>' +
    '<button class="ghost" data-act="srsEdit" data-id="' + esc(s.id) + '">学習回数を直す</button></div>'];
  if (s.memo) out.push('<div class="memo">' + esc(s.memo) + '</div>');
  out.push('<p>今日：<b>' + (plan ? esc(plan.title.replace(/【[^】]*】/g, '')) : 'なし') + '</b>' + (plan ? '（約' + (plan.srsWords || '') + '語・' + plan.est + '分）' : '') + (todayTask && todayTask.done ? ' ✓' : '') + '</p>');
  out.push('<p class="muted small">2周目の残り：' + (left.length ? left.map((k) => esc(rows.find((x) => x.key === k).label)).join(' → ') : 'なし（全ブロック済）') + '</p>');
  out.push('<div class="table-wrap"><table class="srs"><tr><th>ブロック</th><th>回数</th><th>次にやること</th></tr>' + rows.map((r) =>
    '<tr class="' + r.status + '"><td>' + esc(r.label) + (r.level ? '<br><small class="muted">' + esc(r.level) + '</small>' : '') + '</td><td>' + r.count + '回' + (r.round2 ? '' : '<br><small class="muted">2周目まだ</small>') + '</td><td>' + esc(r.next) + '</td></tr>').join('') + '</table></div>');
  out.push('<p class="muted small">復習の間隔（最後に学習した日から）：' + (s.intervals || [1, 3, 7, 14, 30]).map((d, i) => (i + 1) + (i === 4 ? '回以上' : '回') + '→' + d + '日後').join('・') + '</p>');
  out.push('</section>');
  return out.join('');
}

function srsForm(app, s) {
  const rows = srsOverview(s, app.store.view.allTasks, app.today());
  app.modal('<h2>' + esc(s.name) + '：学習回数を直す</h2><p class="muted small">今日の分まで含めた、今の状態を入力してください。</p><form><div class="table-wrap"><table class="srs"><tr><th>ブロック</th><th>回数</th><th>最後の日</th><th>2周目済</th></tr>' +
    rows.map((r, i) => '<tr><td>' + esc(r.label) + '</td><td><input type="number" min="0" name="c' + i + '" value="' + r.count + '" style="width:64px"></td><td><input type="date" name="l' + i + '" value="' + esc(r.last || '') + '"></td><td><input type="checkbox" name="r' + i + '"' + (r.round2 ? ' checked' : '') + '></td></tr>').join('') +
    '</table></div><button class="primary wide">保存</button></form>', async (f) => {
    const initial = {};
    rows.forEach((r, i) => { initial[r.key] = { count: f['c' + i] || 0, last: f['l' + i] || null, round2: !!f['r' + i] }; });
    await A.saveSubject(app.store, Object.assign({}, s, { initial, initialAsOf: addDays(app.today(), 1) }));
    app.toast('保存しました');
  });
}

export const acts = {
  srsEdit(app, el) { srsForm(app, app.store.view.subjects.find((x) => x.id === el.dataset.id)); },
  subjEdit(app, el) { subjectForm(app, el.dataset.id ? app.store.view.subjects.find((s) => s.id === el.dataset.id) : null); },
  async subjNext(app, el) {
    const t = await A.addNextStudyUnit(app.store, el.dataset.id, app.today());
    app.toast(t ? '「' + t.title + '」を今日に追加しました' : '追加できる単位がありません');
  },
  async subjStatus(app, el) {
    const s = app.store.view.subjects.find((x) => x.id === el.dataset.id);
    if (el.dataset.status === 'finished' && !(await app.confirm('「' + s.name + '」を終了にしますか？\n翌日以降のタスクは作られなくなります（記録は残ります）。', '終了にする', 'やめる'))) return;
    await A.setSubjectStatus(app.store, el.dataset.id, el.dataset.status, app.today());
  },
};

