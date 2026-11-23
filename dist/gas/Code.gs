// ============================================================
// 手帳アプリ用 Google Apps Script（自動生成ファイル。直接編集しないでください）
// 元のファイル: src/core/*.js（アプリと共通の計算）と gas/*.gs
// 作り方: npm run build:gas
// ============================================================

// ----- src/core/dates.js -----
// 日付・時刻のユーティリティ（Asia/Tokyo 固定。端末のタイムゾーンに依存しない）
// このファイルは GAS にも同梱される（tools/build-gas.mjs）。import を書かないこと。

const JST_OFFSET_MIN = 9 * 60;
const MS_MIN = 60000;
const MS_DAY = 86400000;

function pad2(n) { return (n < 10 ? '0' : '') + n; }

// Date → 東京時間の各要素
function jstParts(date) {
  const d = new Date(date.getTime() + JST_OFFSET_MIN * MS_MIN);
  return {
    y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(),
    hh: d.getUTCHours(), mm: d.getUTCMinutes(), ss: d.getUTCSeconds(), wd: d.getUTCDay(),
  };
}

// Date → 'YYYY-MM-DD'（東京）
function dateKey(date) {
  const p = jstParts(date);
  return p.y + '-' + pad2(p.m) + '-' + pad2(p.d);
}

// Date → '2026-11-22T23:41:00+09:00'
function toIso(date) {
  const p = jstParts(date);
  return p.y + '-' + pad2(p.m) + '-' + pad2(p.d) + 'T' + pad2(p.hh) + ':' + pad2(p.mm) + ':' + pad2(p.ss) + '+09:00';
}

// ISO 文字列 → Date。タイムゾーンが無い文字列は東京時間とみなす
function parseIso(s) {
  if (!s) return null;
  if (s instanceof Date) return s;
  let str = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) str += 'T00:00:00';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(str)) str += '+09:00';
  const t = Date.parse(str);
  return isNaN(t) ? null : new Date(t);
}

// 'YYYY-MM-DD' + 'HH:MM' → Date（東京）。'24:00' や '25:30' も翌日として扱う
function atTime(dk, hhmm) {
  const mins = hmToMin(hhmm);
  const base = parseIso(dk + 'T00:00:00+09:00');
  return new Date(base.getTime() + mins * MS_MIN);
}

function hmToMin(hhmm) {
  if (hhmm == null || hhmm === '') return null;
  const m = String(hhmm).trim().match(/^(\d{1,2})[:：](\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minToHm(min) {
  const m = Math.round(min);
  return pad2(Math.floor(m / 60)) + ':' + pad2(((m % 60) + 60) % 60);
}

// Date → その日 0:00 からの分（東京）
function minOfDay(date) {
  const p = jstParts(date);
  return p.hh * 60 + p.mm + p.ss / 60;
}

function addDays(dk, n) {
  const t = parseIso(dk + 'T12:00:00+09:00').getTime() + n * MS_DAY;
  return dateKey(new Date(t));
}

// 曜日（0=日〜6=土）
function weekday(dk) {
  return parseIso(dk + 'T12:00:00+09:00').getUTCDay();
}

function diffDays(fromDk, toDk) {
  return Math.round((parseIso(toDk + 'T12:00:00+09:00') - parseIso(fromDk + 'T12:00:00+09:00')) / MS_DAY);
}

// 2つの時刻の差（分）。end が start より前なら 0
function minutesBetween(start, end) {
  const a = parseIso(start), b = parseIso(end);
  if (!a || !b) return 0;
  return Math.max(0, Math.round((b - a) / MS_MIN));
}

// 「論理日付」：dayStartsAt（既定 '00:00'）より前の時刻は前日扱い
function logicalDate(date, dayStartsAt) {
  const off = hmToMin(dayStartsAt || '00:00') || 0;
  return dateKey(new Date(date.getTime() - off * MS_MIN));
}

function dateRange(fromDk, toDk) {
  const out = [];
  for (let d = fromDk; d <= toDk; d = addDays(d, 1)) out.push(d);
  return out;
}

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

function formatMd(dk) {
  const [, m, d] = dk.split('-').map(Number);
  return m + '/' + d + '(' + WEEKDAY_JA[weekday(dk)] + ')';
}

function formatHm(iso) {
  const d = parseIso(iso);
  if (!d) return '';
  const p = jstParts(d);
  return pad2(p.hh) + ':' + pad2(p.mm);
}


// ----- src/core/tasks.js -----
// タスクの基本操作・ID 規則・毎日のタスクの展開
// GAS にも同梱される（tools/build-gas.mjs）。他ファイルの関数は使わず、import も書かないこと。

// 【min】【A】【任意】をタイトルから判定
function tagOf(title) {
  const m = String(title || '').match(/【(min|MIN|Min|A|任意)】/);
  if (!m) return null;
  const t = m[1].toLowerCase();
  return t === 'min' ? 'min' : t === 'a' ? 'A' : '任意';
}

function randomId(len) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < (len || 12); i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// 繰越コピーの ID：元の ID（@ より前）＋ @ ＋ 繰越先の日付。何台で繰越しても同じ ID になる
function baseId(id) { return String(id).split('@')[0]; }
function carriedId(id, toDate) { return baseId(id) + '@' + toDate; }
// 繰越コピーがある（＝すでに繰り越された）タスクの ID 一覧
// 元のタスクは書き換えない（別の端末での「完了」を上書きしないため）
function carriedOriginals(tasks) {
  const latest = {};
  for (const t of tasks || []) {
    if (t.deleted || String(t.id).indexOf('@') < 0) continue;
    const b = baseId(t.id);
    if (!latest[b] || t.date > latest[b]) latest[b] = t.date;
  }
  const out = {};
  for (const t of tasks || []) {
    const l = latest[baseId(t.id)];
    if (l && t.date < l) out[t.id] = l;
  }
  return out;
}

function templateTaskId(templateId, dk) { return 'tpl:' + templateId + ':' + dk; }
function studyTaskId(subjectId, unitKey) { return 'stu:' + subjectId + ':' + unitKey; }

const TASK_DEFAULTS = {
  title: '', done: false, doneAt: null, priority: 2, est: 30, actualMin: 0,
  sessions: [], runningSince: null, deadline: null, start: null,
  carryCount: 0, carriedFrom: null,
};

// 欠けた項目を補い、型をそろえる
function normalizeTask(t, dk) {
  const o = Object.assign({}, TASK_DEFAULTS, t || {});
  o.id = o.id ? String(o.id) : randomId(12);
  o.title = String(o.title || '');
  o.done = !!o.done;
  o.priority = [1, 2, 3].indexOf(Number(o.priority)) >= 0 ? Number(o.priority) : 2;
  o.est = Number(o.est) > 0 ? Number(o.est) : 0;
  o.sessions = Array.isArray(o.sessions) ? o.sessions.map(normalizeSpan) : [];
  o.actualMin = o.sessions.length ? sumMin(o.sessions) : (Number(o.actualMin) || 0);
  o.carryCount = Number(o.carryCount) || 0;
  if (!o.tag) o.tag = tagOf(o.title);
  if (dk) o.date = dk;
  return o;
}

function normalizeSpan(s) {
  const o = Object.assign({ start: null, end: null, min: 0 }, s || {});
  o.min = Number(o.min) || 0;
  return o;
}

function sumMin(spans) {
  let t = 0;
  for (const s of spans || []) t += Number(s.min) || 0;
  return t;
}

// 毎日のタスク（テンプレート）からその日のタスクを作る。
// existing: その日にすでにあるタスク。繰越されたテンプレート由来のタスクがあれば作らない。
function templateTasksFor(dk, templates, existing, weekdayOfDate) {
  const out = [];
  const have = {};
  for (const t of existing || []) {
    if (t.templateId) have[t.templateId] = true;
    have['id:' + t.id] = true;
  }
  for (const tp of templates || []) {
    if (tp.active === false) continue;
    if (Array.isArray(tp.weekdays) && tp.weekdays.length && tp.weekdays.indexOf(weekdayOfDate) < 0) continue;
    const id = templateTaskId(tp.id, dk);
    if (have[tp.id] || have['id:' + id]) continue;
    out.push(normalizeTask({
      id: id, title: tp.title, priority: tp.priority || 2, est: tp.est || 0,
      tag: tagOf(tp.title), templateId: tp.id, source: 'template',
    }, dk));
  }
  return out;
}


// ----- src/core/study.js -----
// 学習科目：単位の展開・その日にやる分の決定・区切りタスク（章末問題など）・遅れ警告
// 「どこまで終わったか」は学習タスクの完了記録から毎回計算する（位置を別に保存しない）。
// GAS にも同梱される。import は同梱ファイル（dates.js / tasks.js）からのみ。


function fmt(format, n) { return String(format || '{n}').replace('{n}', n); }

// 外側の区切り（章・stage）の一覧
function outerItems(subject) {
  const st = subject.structure || {};
  if (Array.isArray(st.items) && st.items.length) return st.items;
  const count = (st.outer && st.outer.count) || 0;
  const items = [];
  for (let i = 1; i <= count; i++) items.push({ n: i });
  return items;
}

function innerCount(subject, item) {
  const inner = (subject.structure || {}).inner || {};
  if (item.secs != null) return Number(item.secs);
  if (Array.isArray(inner.labels)) return inner.labels.length;
  return Number(inner.count) || 1;
}

function innerKey(subject, j) {
  const inner = (subject.structure || {}).inner || {};
  if (Array.isArray(inner.labels)) return inner.labels[j - 1];
  return fmt(inner.format || 'Sec{n}', j);
}

// 全単位を学習順に並べる。区切りタスク（afterOuter）は各区切りの直後に入る
function expandUnits(subject) {
  const st = subject.structure || {};
  const outerFmt = (st.outer && st.outer.format) || '{n}';
  const units = [];
  for (const item of outerItems(subject)) {
    const ok = fmt(outerFmt, item.n);
    const outerTitle = item.label ? ok + ' ' + item.label : ok;
    const cnt = innerCount(subject, item);
    for (let j = 1; j <= cnt; j++) {
      const ik = innerKey(subject, j);
      units.push({
        key: ok + '-' + ik, outerKey: ok, outerTitle: outerTitle, item: item, milestone: false,
        title: subject.name + ' ' + outerTitle + ' ' + ik, est: subject.est || 30,
      });
    }
    for (const ms of subject.milestones || []) {
      if (ms.when !== 'afterOuter') continue;
      const label = ms.key || '章末問題';
      units.push({
        key: ok + '-' + label, outerKey: ok, outerTitle: outerTitle, item: item, milestone: true,
        title: String(ms.title || '{name} {outer} ' + label).replace('{name}', subject.name).replace('{outer}', outerTitle),
        est: ms.est || subject.est || 30,
      });
    }
  }
  return units;
}

function isStudyDay(subject, dk) {
  if ((subject.offDays || []).indexOf(dk) >= 0) return false;
  const sd = subject.studyDays || 'everyday';
  const wd = weekday(dk);
  if (sd === 'weekdays') return wd >= 1 && wd <= 5;
  if (Array.isArray(sd)) return sd.indexOf(wd) >= 0;
  return true;
}

function countStudyDays(subject, fromDk, toDk) {
  let n = 0;
  for (let d = fromDk; d <= toDk; d = addDays(d, 1)) if (isStudyDay(subject, d)) n++;
  return n;
}

// 単位ごとの状態を作る
// tasks: この科目の全タスク（全日付）。mode: 'actual'（実際の完了だけ）か
// 'optimistic'（date より前の日に入っている未完了も終わる前提。21:50 の翌日作成用）
function unitStatus(subject, tasks, date, mode) {
  const units = expandUnits(subject);
  const idxBefore = subject.doneBefore ? units.findIndex((u) => u.key === subject.doneBefore) : -1;
  const byKey = {};
  const carried = carriedOriginals(tasks);
  for (const t of tasks || []) {
    if (t.deleted || t.subjectId !== subject.id || !t.unitKey) continue;
    (byKey[t.unitKey] = byKey[t.unitKey] || []).push(t);
  }
  return units.map((u, i) => {
    const ts = byKey[u.key] || [];
    let doneDate = null;
    if (i <= idxBefore) doneDate = '0000-00-00';
    for (const t of ts) {
      if (t.done) {
        const d = t.doneAt ? String(t.doneAt).slice(0, 10) : t.date;
        if (!doneDate || d < doneDate) doneDate = d;
      }
    }
    if (!doneDate && mode === 'optimistic') {
      for (const t of ts) if (t.date < date) doneDate = addDays(date, -1);
    }
    return Object.assign({}, u, {
      done: !!doneDate, doneDate: doneDate,
      tasks: ts,
      openOn: ts.filter((t) => !t.done && !t.carriedTo && !carried[t.id]).map((t) => t.date),
    });
  });
}

// その日にやる「通常の単位」の数
function dailyQuota(subject, status, date) {
  if (subject.status === 'finished') return 0;
  if (!isStudyDay(subject, date)) return 0;
  const remainingAll = status.filter((u) => !u.milestone && !u.done).length;
  if (!remainingAll) return 0;
  if (subject.perDayMode !== 'auto') return Math.min(Number(subject.perDay) || 1, remainingAll);
  const need = paceNeeds(subject, status, date);
  let k = 1;
  for (const n of need) k = Math.max(k, n.perDay);
  return Math.min(k, Number(subject.maxPerDay) || 3, remainingAll);
}

// 期限ごとに「1 日あたり何単位必要か」
function paceNeeds(subject, status, date) {
  const out = [];
  const groups = [];
  for (const u of status) {
    if (!groups.length || groups[groups.length - 1].key !== u.outerKey) groups.push({ key: u.outerKey, item: u.item, units: [] });
    groups[groups.length - 1].units.push(u);
  }
  let remaining = 0;
  for (const g of groups) {
    const item = g.item;
    remaining += g.units.filter((u) => !u.milestone && !u.done).length;
    if (!item.due) continue;
    if (remaining === 0) continue;
    const days = item.due >= date ? countStudyDays(subject, date, item.due) : 0;
    out.push({
      label: item.label ? g.key + ' ' + item.label : g.key, due: item.due, remaining: remaining, days: days,
      perDay: days > 0 ? Math.ceil(remaining / days) : remaining, overdue: item.due < date,
    });
  }
  const finalDue = subject.targetDate || (subject.examDate ? addDays(subject.examDate, -1 - (Number(subject.reviewDays) || 0)) : null);
  if (finalDue && remaining > 0 && !out.some((o) => o.due === finalDue)) {
    const days = finalDue >= date ? countStudyDays(subject, date, finalDue) : 0;
    out.push({ label: '全体', due: finalDue, remaining: remaining, days: days,
      perDay: days > 0 ? Math.ceil(remaining / days) : remaining, overdue: finalDue < date });
  }
  return out;
}

// その日の学習タスクを決める
// 返り値: { quota, carried, generate: [task], keepIds: {id:true} }
function planStudyDay(subject, tasks, date, mode) {
  if (subject.status === 'finished') return { quota: 0, carried: 0, generate: [], keepIds: {} };
  const status = unitStatus(subject, tasks, date, mode);
  const quota = dailyQuota(subject, status, date);
  const carriedTasks = (tasks || []).filter((t) => !t.deleted && t.subjectId === subject.id && t.date === date && !t.done && t.carriedFrom);
  const carriedKeys = {};
  for (const t of carriedTasks) carriedKeys[t.unitKey] = true;
  const carriedRegular = carriedTasks.filter((t) => !t.milestone).length;
  let n = Math.max(0, quota - carriedRegular);
  const generate = [];
  for (const u of status) {
    if (u.milestone || u.done || carriedKeys[u.key]) continue;
    if (n <= 0) break;
    if (u.openOn.some((d) => d !== date)) continue; // 別の日に入っている（繰越待ち・先の日）
    generate.push(makeStudyTask(subject, u, date));
    n--;
  }
  // 区切りタスク：その区切りの通常単位がすべて「前日までに」終わっていれば入れる
  for (const u of status) {
    if (!u.milestone || u.done || carriedKeys[u.key]) continue;
    if (u.openOn.some((d) => d !== date)) continue;
    const regs = status.filter((x) => !x.milestone && x.outerKey === u.outerKey);
    if (!regs.length || !regs.every((x) => x.done && x.doneDate < date)) continue;
    generate.push(makeStudyTask(subject, u, date));
  }
  const keepIds = {};
  for (const t of generate) keepIds[t.id] = true;
  return { quota: quota, carried: carriedRegular, generate: generate, keepIds: keepIds };
}

function makeStudyTask(subject, unit, date) {
  const tag = subject.tag || 'min';
  return normalizeTask({
    id: studyTaskId(subject.id, unit.key),
    title: unit.title + '【' + tag + '】',
    priority: subject.priority || 1, est: unit.est, tag: tag,
    subjectId: subject.id, unitKey: unit.key, milestone: unit.milestone || undefined,
    source: 'study',
  }, date);
}

// 「次の単位を今日に追加」用
function nextUnit(subject, tasks, date) {
  const status = unitStatus(subject, tasks, date, 'actual');
  for (const u of status) {
    if (u.milestone || u.done) continue;
    if (u.openOn.length) continue;
    return makeStudyTask(subject, u, date);
  }
  return null;
}

// 学習画面用のまとめ
function subjectProgress(subject, tasks, date) {
  const status = unitStatus(subject, tasks, date, 'actual');
  const regular = status.filter((u) => !u.milestone);
  const done = regular.filter((u) => u.done).length;
  const next = status.find((u) => !u.done) || null;
  const needs = paceNeeds(subject, status, date);
  const normal = subject.perDayMode === 'auto' ? 1 : (Number(subject.perDay) || 1);
  const behind = needs.filter((n) => n.overdue || n.perDay > normal);
  let actualMin = 0;
  for (const u of status) for (const t of u.tasks) actualMin += Number(t.actualMin) || 0;
  const remaining = regular.length - done;
  let projected = null;
  if (remaining > 0 && subject.status !== 'finished') {
    // 1 日 normal 単位のペースで進んだ場合に終わる日
    let left = remaining, d = date, guard = 0;
    while (left > 0 && guard++ < 2000) { if (isStudyDay(subject, d)) left -= normal; if (left > 0) d = addDays(d, 1); }
    projected = d;
  }
  const messages = [];
  for (const b of behind) {
    messages.push(b.overdue
      ? '遅れ：' + b.label + '（期限 ' + formatMd(b.due) + '）を過ぎています。残り ' + b.remaining + ' 単位'
      : '遅れ：' + b.label + '（期限 ' + formatMd(b.due) + '）まで学習日 ' + b.days + ' 日で残り ' + b.remaining + ' 単位 → 1 日 ' + b.perDay + ' 単位必要');
  }
  return {
    total: regular.length, done: done, remaining: remaining, next: next, needs: needs,
    behind: behind.length > 0, messages: messages, actualMin: actualMin, projectedFinish: projected,
    quotaToday: dailyQuota(subject, status, date),
    units: status,
  };
}


// ----- src/core/planSheet.js -----
// 学習計画スプレッドシート（「予定一覧」「毎日の時間割」）とカレンダー予定の読み取り
// 値は getDisplayValues() の文字列を想定。GAS にも同梱される。

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function hashStr(s) {
  let h = 5381;
  const str = String(s);
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// '2026/11/13' / '2026-11-13' / '2026年11月13日' → '2026-11-13'
function parseSheetDate(v) {
  if (v == null || v === '') return null;
  const m = String(v).trim().match(/^(\d{4})\s*[/.\-年]\s*(\d{1,2})\s*[/.\-月]\s*(\d{1,2})/);
  return m ? m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]) : null;
}

// '19:00〜21:00' → { start, end }。終日・空欄は null
function parseTimeRange(v) {
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
const PLAN_COLS = { start: '開始日', end: '終了日', time: '時間', kind: '種類', title: '予定', progress: '進捗', memo: '内容・メモ' };

function parsePlanRows(values) {
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

function planTaskId(item) { return 'plan:' + item.start + ':' + hashStr(item.title); }

// その日の 予定一覧 → { tasks, blocks, goals, upcoming }
function planItemsForDate(items, dk, upcomingDays) {
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
function chapterDues(items, subject) {
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
const TT_COLS = { days: '曜日', start: '開始', end: '終了', title: '内容', category: '分類', period: '期間', memo: '休み・メモ' };
const WD = { 日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6 };

function parseWeekdays(s) {
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
function periodContains(period, dk) {
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

function periodStart(period, dk) {
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
function isHoliday(memo, dk) {
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

function parseTimetable(values) {
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
function timetableSlots(rows, dk) {
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
function isTechoEvent(ev) {
  return /^【手帳】/.test(ev.title || '') || /手帳ID[:：]/.test(ev.description || '');
}

function calendarItems(events, slots) {
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


// ----- src/core/dayBuild.js -----
// その日の To Do を組み立てる（アプリの日付切り替え時・21:50 の GAS の両方で使う）
// ①毎日のタスク ②学習科目 ③予定一覧 ④時間割の枠 ⑤カレンダー予定




// ctx: { templates, subjects, tasksAll, links, mode, planItems?, timetableRows?, calendarEvents? }
// 返り値: { create: [新しいタスク], patch: [{id, start, fixedTime, slotMin}], studyKeep: {subjectId: keepIds}, plan }
function buildDay(dk, ctx) {
  const all = (ctx.tasksAll || []).filter((t) => !t.deleted);
  const onDay = all.filter((t) => t.date === dk);
  const byId = {};
  for (const t of all) byId[t.id] = t;
  const create = [];
  const add = (t) => { if (!byId[t.id] && !create.some((c) => c.id === t.id)) create.push(t); };

  for (const t of templateTasksFor(dk, ctx.templates, onDay, weekday(dk))) add(t);

  const studyKeep = {};
  for (const s of ctx.subjects || []) {
    if (s.status === 'finished') continue;
    const p = planStudyDay(s, all.concat(create), dk, ctx.mode || 'actual');
    studyKeep[s.id] = p.keepIds;
    for (const t of p.generate) add(t);
  }

  const plan = { blocks: [], goals: [], upcoming: [], slots: [] };
  if (ctx.planItems) {
    const pi = planItemsForDate(ctx.planItems, dk, 7);
    plan.blocks = plan.blocks.concat(pi.blocks);
    plan.goals = plan.goals.concat(pi.goals);
    plan.upcoming = pi.upcoming;
    for (const t of pi.tasks) add(normalizeTask(Object.assign({}, t, { tag: tagOf(t.title) }), dk));
  }

  const patch = [];
  if (ctx.timetableRows) {
    const slots = timetableSlots(ctx.timetableRows, dk);
    plan.slots = slots;
    const dayTasks = onDay.concat(create.filter((t) => t.date === dk));
    for (const slot of slots) {
      const link = (ctx.links || []).find((l) => l.match && slot.baseTitle.indexOf(l.match) >= 0);
      let cursor = hmToMin(slot.start);
      const place = (t, min) => {
        const p = { id: t.id, start: minToHm(cursor), fixedTime: true, slotMin: min };
        cursor += min;
        if (t.start) return; // すでに時刻が決まっているものは動かさない
        const c = create.find((x) => x.id === t.id);
        if (c) Object.assign(c, { start: p.start, fixedTime: true, slotMin: p.slotMin });
        else patch.push(p);
      };
      if (link && link.template) {
        const t = dayTasks.find((x) => x.templateId === link.template && !x.done);
        if (link.rest) {
          const restMin = Math.max(10, slot.min - ((t && t.est) || 0));
          const id = 'tt:' + dk + ':' + slot.key;
          add(normalizeTask({ id: id, title: link.rest, est: restMin, priority: 2, source: 'timetable' }, dk));
          place(create.find((x) => x.id === id) || byId[id], restMin);
        }
        if (t) place(t, t.est || slot.min);
        continue;
      }
      if (link && link.subject) {
        const ts = dayTasks.filter((x) => x.subjectId === link.subject && !x.done);
        for (const t of ts) place(t, t.est || 45);
        continue;
      }
      const id = 'tt:' + dk + ':' + slot.key;
      add(normalizeTask({ id: id, title: slot.title, est: slot.min, priority: 2, source: 'timetable', category: slot.category }, dk));
      place(create.find((x) => x.id === id) || byId[id], slot.min);
    }
  }

  if (ctx.calendarEvents) {
    const ci = calendarItems(ctx.calendarEvents, plan.slots);
    for (const b of ci.blocks) if (!plan.blocks.some((x) => x.title === b.title && x.start === b.start)) plan.blocks.push(b);
    for (const g of ci.goals) if (!plan.goals.some((x) => x.title === g.title)) plan.goals.push(g);
  }

  return { create: create, patch: patch, studyKeep: studyKeep, plan: plan };
}

// 日付が変わってアプリを開いたとき、21:50 に作った学習タスクを実際の完了状況に合わせる
// 返り値: 削除する（deleted にする）タスクの ID
function studyTasksToRemove(dk, tasksAll, studyKeep) {
  const out = [];
  for (const t of tasksAll || []) {
    if (t.deleted || t.date !== dk || t.source !== 'study' || t.done || t.carriedFrom || t.manual) continue;
    if ((t.sessions && t.sessions.length) || t.runningSince) continue;
    const keep = studyKeep[t.subjectId];
    if (keep && !keep[t.id]) out.push(t.id);
  }
  return out;
}


// ----- src/core/dateExtract.js -----
// メール本文などから日付を見つける（締切の候補）
// 年が無いものは「基準日以降で一番近い日付」と解釈する。GAS にも同梱される。

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

function extractDates(text, refDk, limit) {
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


// ----- gas/Main.gs -----
// ===== 手帳API（Google Apps Script）=====
// アプリ（GitHub Pages）から呼ばれる窓口。合言葉（キー）が一致したときだけ読み書きする。

var TZ = 'Asia/Tokyo';
var APP_LABEL = '手帳済';

function doGet() {
  // データは返さない（動作確認用）
  return ContentService.createTextOutput('手帳API は動いています。').setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  var res;
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!checkKey_(body.key)) return json_({ ok: false, error: 'unauthorized' });
    switch (body.action) {
      case 'ping': res = { ok: true, now: toIso(new Date()) }; break;
      case 'sync': res = handleSync(body); break;
      case 'calendar': res = handleCalendar(body); break;
      default: res = { ok: false, error: 'unknown action' };
    }
  } catch (err) {
    console.error(err && err.stack || err);
    res = { ok: false, error: String(err && err.message || err) };
  }
  return json_(res);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// キーの確認。間違いが 10 分に 30 回を超えたら、しばらくすべて拒否する
function checkKey_(key) {
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('authFails') || 0);
  if (fails > 30) return false;
  var real = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (!real || typeof key !== 'string' || key.length !== real.length) { cache.put('authFails', String(fails + 1), 600); return false; }
  var diff = 0;
  for (var i = 0; i < real.length; i++) diff |= real.charCodeAt(i) ^ key.charCodeAt(i);
  if (diff !== 0) { cache.put('authFails', String(fails + 1), 600); return false; }
  return true;
}

function todayKey_() { return dateKey(new Date()); }


// ----- gas/Db.gs -----
// ===== スプレッドシート「手帳DB」の読み書き =====
// 1 件 1 行。読み書きは json 列で行い、ほかの列は確認用の表示（アプリが自動で書く）。

var SHEETS = {
  day:   { name: 'days',      cols: ['date', 'sleepMin', 'bed', 'wake', 'naps', 'note', 'closed', 'rate'] },
  task:  { name: 'tasks',     cols: ['date', 'title', 'done', 'est', 'actualMin', 'start', 'carryCount'] },
  hou:   { name: 'hourensou', cols: ['to', 'what', 'kind', 'due', 'done'] },
  tpl:   { name: 'templates', cols: ['title', 'est', 'priority'] },
  subj:  { name: 'subjects',  cols: ['name', 'status'] },
  cfg:   { name: 'config',    cols: [] },
  inbox: { name: 'inbox',     cols: ['subject', 'from', 'status'] },
  plan:  { name: 'dayplans',  cols: [] }
};
var BASE_COLS = ['id', 'rev', 'updatedAt', 'deleted', 'device'];

function db_() { return SpreadsheetApp.getActive(); }

function headerOf_(kind) { return BASE_COLS.concat(SHEETS[kind].cols).concat(['json']); }

function sheetOf_(kind) {
  var ss = db_();
  var sh = ss.getSheetByName(SHEETS[kind].name);
  if (!sh) {
    sh = ss.insertSheet(SHEETS[kind].name);
    var h = headerOf_(kind);
    sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:Z').setNumberFormat('@');
  }
  return sh;
}

// 全行を読む → { rows: [...], index: { id: i } }
function loadKind_(kind) {
  var sh = sheetOf_(kind);
  var h = headerOf_(kind);
  var last = sh.getLastRow();
  var out = { kind: kind, sheet: sh, rows: [], index: {} };
  if (last < 2) return out;
  var vals = sh.getRange(2, 1, last - 1, h.length).getValues();
  var jsonCol = h.length - 1;
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i];
    if (!v[0]) continue;
    var data = {};
    try { data = JSON.parse(v[jsonCol] || '{}'); } catch (e) { data = {}; }
    var rec = { kind: kind, id: String(v[0]), rev: Number(v[1]) || 0, updatedAt: String(v[2] || ''), deleted: v[3] === true || v[3] === 'TRUE' || v[3] === 'true', data: data, row: i + 2 };
    out.index[rec.id] = out.rows.length;
    out.rows.push(rec);
  }
  return out;
}

function display_(kind, rec) {
  var d = rec.data || {};
  switch (kind) {
    case 'day': return [rec.id, d.sleep ? d.sleep.min : '', d.sleep ? d.sleep.bed : '', d.sleep ? d.sleep.wake : '', (d.naps || []).length, d.note || '', !!d.closed, d.rate == null ? '' : d.rate];
    case 'task': return [d.date || '', d.title || '', !!d.done, d.est || '', d.actualMin || 0, d.start || '', d.carryCount || 0];
    case 'hou': return [d.to || '', d.what || '', d.kind || '', d.due || '', !!d.done];
    case 'tpl': return [d.title || '', d.est || '', d.priority || ''];
    case 'subj': return [d.name || '', d.status || ''];
    case 'inbox': return [d.subject || '', d.from || '', d.status || ''];
    default: return [];
  }
}

function rowOf_(kind, rec) {
  var json = JSON.stringify(rec.data || {});
  return [rec.id, rec.rev, rec.updatedAt || '', !!rec.deleted, rec.device || ''].concat(display_(kind, rec)).concat([json]).map(function (x) {
    return typeof x === 'boolean' || typeof x === 'number' ? String(x) : x;
  });
}

// 変更した行の書き込み（既存は上書き、新規はまとめて追加）
function flushKind_(store, dirty) {
  if (!dirty.length) return;
  var sh = store.sheet;
  var width = headerOf_(store.kind).length;
  var appends = [];
  var updates = [];
  for (var i = 0; i < dirty.length; i++) {
    var rec = dirty[i];
    if (rec.row) updates.push(rec); else appends.push(rec);
  }
  // 連続した行はまとめて書く
  updates.sort(function (a, b) { return a.row - b.row; });
  var k = 0;
  while (k < updates.length) {
    var j = k;
    while (j + 1 < updates.length && updates[j + 1].row === updates[j].row + 1) j++;
    var block = [];
    for (var m = k; m <= j; m++) block.push(rowOf_(store.kind, updates[m]));
    sh.getRange(updates[k].row, 1, block.length, width).setValues(block);
    k = j + 1;
  }
  if (appends.length) {
    var start = Math.max(sh.getLastRow(), 1) + 1;
    sh.getRange(start, 1, appends.length, width).setNumberFormat('@').setValues(appends.map(function (r) { return rowOf_(store.kind, r); }));
    for (var n = 0; n < appends.length; n++) appends[n].row = start + n;
  }
}

var REV_ = null;
function nextRev_() {
  if (REV_ == null) REV_ = Number(PropertiesService.getScriptProperties().getProperty('REV') || 0);
  REV_++;
  return REV_;
}
function saveRev_() {
  if (REV_ != null) PropertiesService.getScriptProperties().setProperty('REV', String(REV_));
}
function currentRev_() {
  return REV_ != null ? REV_ : Number(PropertiesService.getScriptProperties().getProperty('REV') || 0);
}

// 複数の種類をまとめて扱う入れ物
function openStores_(kinds) {
  var s = {};
  for (var i = 0; i < kinds.length; i++) s[kinds[i]] = loadKind_(kinds[i]);
  s._dirty = {};
  return s;
}

function getRec_(stores, kind, id) {
  var st = stores[kind];
  var i = st.index[id];
  return i == null ? null : st.rows[i];
}

// サーバー側での書き込み（GAS の自動処理用）。updatedAt は今
function putRec_(stores, kind, id, data, deleted) {
  var st = stores[kind];
  var rec = getRec_(stores, kind, id);
  if (!rec) { rec = { kind: kind, id: id }; st.index[id] = st.rows.length; st.rows.push(rec); }
  rec.data = data; rec.deleted = !!deleted; rec.updatedAt = toIso(new Date()); rec.rev = nextRev_(); rec.device = 'gas';
  (stores._dirty[kind] = stores._dirty[kind] || []).push(rec);
  return rec;
}

function flushStores_(stores) {
  for (var kind in stores._dirty) {
    var uniq = [];
    var seen = {};
    var list = stores._dirty[kind];
    for (var i = list.length - 1; i >= 0; i--) { if (!seen[list[i].id]) { seen[list[i].id] = true; uniq.push(list[i]); } }
    flushKind_(stores[kind], uniq);
  }
  stores._dirty = {};
  saveRev_();
}

function cfgValue_(stores, id, fallback) {
  var r = getRec_(stores, 'cfg', id);
  return r && !r.deleted && r.data && r.data.value !== undefined ? r.data.value : fallback;
}

function allTasks_(stores) {
  var out = [];
  var rows = stores.task.rows;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].deleted) continue;
    var t = rows[i].data || {};
    t.id = rows[i].id;
    out.push(t);
  }
  return out;
}

function listData_(stores, kind) {
  var out = [];
  var rows = stores[kind].rows;
  for (var i = 0; i < rows.length; i++) if (!rows[i].deleted) { var d = rows[i].data || {}; d.id = rows[i].id; out.push(d); }
  return out;
}


// ----- gas/Sync.gs -----
// ===== 同期 =====
// アプリ → { since, changes:[{kind,id,data,updatedAt,deleted}], prepare:'YYYY-MM-DD', planUpdates:[...] }
// GAS → { ok, rev, records:[...since 以降の変更...] }
// 1 件ごとに updatedAt が新しい方を採用（後勝ち）。

var ALL_KINDS = ['day', 'task', 'hou', 'tpl', 'subj', 'cfg', 'inbox', 'plan'];

function handleSync(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var stores = openStores_(ALL_KINDS);
    var changes = body.changes || [];
    var accepted = 0;
    for (var i = 0; i < changes.length; i++) {
      var c = changes[i];
      if (!c || !SHEETS[c.kind] || !c.id) continue;
      var cur = getRec_(stores, c.kind, String(c.id));
      if (cur && cur.updatedAt && c.updatedAt && String(c.updatedAt) < String(cur.updatedAt)) continue; // サーバーの方が新しい
      var st = stores[c.kind];
      if (!cur) { cur = { kind: c.kind, id: String(c.id) }; st.index[cur.id] = st.rows.length; st.rows.push(cur); }
      cur.data = c.data || {}; cur.deleted = !!c.deleted; cur.updatedAt = c.updatedAt || toIso(new Date());
      cur.device = body.device || ''; cur.rev = nextRev_();
      (stores._dirty[c.kind] = stores._dirty[c.kind] || []).push(cur);
      accepted++;
    }
    flushStores_(stores);

    if (body.prepare) {
      try { prepareDay_(stores, body.prepare, 'actual'); flushStores_(stores); }
      catch (e) { console.error('prepare: ' + (e && e.stack || e)); }
    }
    if (body.planUpdates && body.planUpdates.length) {
      try { applyPlanUpdates_(stores, body.planUpdates); } catch (e) { console.error('planUpdates: ' + e); }
    }

    var since = Number(body.since || 0);
    var out = [];
    for (var k = 0; k < ALL_KINDS.length; k++) {
      var rows = stores[ALL_KINDS[k]].rows;
      for (var r = 0; r < rows.length; r++) {
        var x = rows[r];
        if (x.rev > since) out.push({ kind: x.kind, id: x.id, data: x.data, updatedAt: x.updatedAt, deleted: x.deleted, rev: x.rev });
      }
    }
    return { ok: true, accepted: accepted, rev: currentRev_(), records: out, now: toIso(new Date()) };
  } finally {
    lock.releaseLock();
  }
}


// ----- gas/NextDay.gs -----
// ===== 翌日の To Do（毎晩 21:50）と、その日の準備 =====

function nextDayJob() {
  try {
    var lock = LockService.getScriptLock();
    lock.waitLock(25000);
    try {
      var stores = openStores_(ALL_KINDS);
      prepareDay_(stores, addDays(todayKey_(), 1), 'optimistic');
      flushStores_(stores);
    } finally { lock.releaseLock(); }
  } finally {
    scheduleAt_('nextDayJob', '21:50');
  }
}

function settings_(stores) { return cfgValue_(stores, 'settings', {}) || {}; }

function planBook_(stores) {
  var id = settings_(stores).planSheetId;
  if (!id) return null;
  try { return SpreadsheetApp.openById(id); } catch (e) { console.error('学習計画シートを開けません: ' + e); return null; }
}

function readPlanSheet_(stores) {
  var book = planBook_(stores);
  if (!book) return { planItems: null, timetableRows: null };
  var st = settings_(stores);
  var p = book.getSheetByName(st.planSheetName || '予定一覧');
  var t = book.getSheetByName(st.timetableSheetName || '毎日の時間割');
  return {
    planItems: p ? parsePlanRows(p.getDataRange().getDisplayValues()) : null,
    timetableRows: t ? parseTimetable(t.getDataRange().getDisplayValues()) : null
  };
}

function calendarEventsFor_(dk) {
  var cal = CalendarApp.getDefaultCalendar();
  var evs = cal.getEventsForDay(atTime(dk, '12:00'));
  var out = [];
  for (var i = 0; i < evs.length; i++) {
    var ev = evs[i];
    var allDay = ev.isAllDayEvent();
    out.push({
      title: ev.getTitle(), allDay: allDay, recurring: ev.isRecurringEvent(), description: ev.getDescription() || '',
      start: allDay ? null : Utilities.formatDate(ev.getStartTime(), TZ, 'HH:mm'),
      end: allDay ? null : Utilities.formatDate(ev.getEndTime(), TZ, 'HH:mm')
    });
  }
  return out;
}

// dk の To Do を作る（何度実行しても重複しない）
function prepareDay_(stores, dk, mode) {
  var sheet = readPlanSheet_(stores);
  var subjects = listData_(stores, 'subj');

  // 「FP2級：○○」の終了日 → 章の期限
  if (sheet.planItems) {
    for (var s = 0; s < subjects.length; s++) {
      var subj = subjects[s];
      if (!subj.structure || !subj.structure.items) continue;
      var dues = chapterDues(sheet.planItems, subj);
      var changed = false;
      for (var j = 0; j < subj.structure.items.length; j++) {
        var it = subj.structure.items[j];
        if (dues[it.n] && dues[it.n] !== it.due) { it.due = dues[it.n]; changed = true; }
      }
      if (changed) { var d = JSON.parse(JSON.stringify(subj)); delete d.id; putRec_(stores, 'subj', subj.id, d, false); }
    }
  }

  var events = [];
  try { events = calendarEventsFor_(dk); } catch (e) { console.error('calendar: ' + e); }

  var r = buildDay(dk, {
    templates: listData_(stores, 'tpl'), subjects: subjects, tasksAll: allTasks_(stores),
    links: cfgValue_(stores, 'links', []), mode: mode,
    planItems: sheet.planItems, timetableRows: sheet.timetableRows, calendarEvents: events
  });
  for (var i = 0; i < r.create.length; i++) {
    var t = r.create[i];
    var id = t.id; var data = JSON.parse(JSON.stringify(t)); delete data.id;
    var exist = getRec_(stores, 'task', id);
    if (exist && !exist.deleted) continue;
    putRec_(stores, 'task', id, data, false);
  }
  for (var p = 0; p < r.patch.length; p++) {
    var pt = r.patch[p];
    var rec = getRec_(stores, 'task', pt.id);
    if (!rec || rec.deleted || (rec.data && rec.data.start)) continue;
    var nd = rec.data || {};
    nd.start = pt.start; nd.fixedTime = true; nd.slotMin = pt.slotMin;
    putRec_(stores, 'task', pt.id, nd, false);
  }
  var plan = r.plan; plan.builtAt = toIso(new Date()); plan.mode = mode;
  putRec_(stores, 'plan', dk, plan, false);
  return r;
}

// 学習計画シートの「進捗」を書き戻す。u: { title, start?, progress }
function applyPlanUpdates_(stores, updates) {
  var book = planBook_(stores);
  if (!book) return;
  var sh = book.getSheetByName(settings_(stores).planSheetName || '予定一覧');
  if (!sh) return;
  var vals = sh.getDataRange().getDisplayValues();
  var h = vals[0];
  var cTitle = h.indexOf('予定'), cStart = h.indexOf('開始日'), cProg = h.indexOf('進捗');
  if (cTitle < 0 || cProg < 0) return;
  for (var i = 0; i < updates.length; i++) {
    var u = updates[i];
    for (var r = 1; r < vals.length; r++) {
      if (String(vals[r][cTitle]).trim() !== u.title) continue;
      if (u.start && parseSheetDate(vals[r][cStart]) !== u.start) continue;
      if (vals[r][cProg] === u.progress) break;
      if (vals[r][cProg] === '完了' && u.progress === '進行中') break;
      sh.getRange(r + 1, cProg + 1).setValue(u.progress);
      break;
    }
  }
}


// ----- gas/Calendar.gs -----
// ===== タスクの時刻を Google カレンダーに登録・更新（Asia/Tokyo）=====
// 今の手帳と同じ書き方：件名「【手帳】…」、説明に「手帳ID: …」

var PRIORITY_JA = { 1: '高', 2: '中', 3: '低' };

function handleCalendar(body) {
  var cal = CalendarApp.getDefaultCalendar();
  var dk = body.date;
  var dayEvents = cal.getEventsForDay(atTime(dk, '12:00'));
  var byTechoId = {};
  for (var i = 0; i < dayEvents.length; i++) {
    var m = String(dayEvents[i].getDescription() || '').match(/手帳ID[:：]\s*(\S+)/);
    if (m) byTechoId[m[1]] = dayEvents[i];
  }
  var mapping = {};
  var tasks = body.tasks || [];
  for (var t = 0; t < tasks.length; t++) {
    var task = tasks[t];
    if (!task.start) continue;
    var start = atTime(dk, task.start);
    var end = new Date(start.getTime() + Math.max(5, Number(task.dur || task.est || 30)) * 60000);
    var title = '【手帳】' + task.title + (task.done ? ' ✓' : '');
    var desc = '手帳ID: ' + task.id + '\n優先度: ' + (PRIORITY_JA[task.priority] || '中') + '／見積: ' + (task.est || 0) + '分' +
      (task.deadline ? '／締切 ' + task.deadline : '') + '／出どころ: ' + (task.source || '手動') + (task.carriedFrom ? '（' + task.carriedFrom + 'から繰越）' : '');
    var ev = null;
    if (task.calendarEventId) { try { ev = cal.getEventById(task.calendarEventId); } catch (e) { ev = null; } }
    if (!ev) ev = byTechoId[task.id] || byTechoId[baseId(task.id)] || null;
    if (ev) {
      if (ev.getTitle() !== title) ev.setTitle(title);
      if (ev.getStartTime().getTime() !== start.getTime() || ev.getEndTime().getTime() !== end.getTime()) ev.setTime(start, end);
      if (ev.getDescription() !== desc) ev.setDescription(desc);
    } else {
      ev = cal.createEvent(title, start, end, { description: desc });
    }
    mapping[task.id] = ev.getId();
  }
  var removed = 0;
  var rm = body.remove || [];
  for (var r = 0; r < rm.length; r++) {
    var e2 = null;
    if (rm[r].calendarEventId) { try { e2 = cal.getEventById(rm[r].calendarEventId); } catch (x) { e2 = null; } }
    if (!e2) e2 = byTechoId[rm[r].id] || null;
    if (e2 && /^【手帳】/.test(e2.getTitle())) { e2.deleteEvent(); removed++; }
  }
  return { ok: true, mapping: mapping, removed: removed };
}

// 毎日 23:30 の「寝る準備」（通知付きの繰り返し予定）
function ensureBedPrepEvent_() {
  var p = PropertiesService.getScriptProperties();
  if (p.getProperty('BEDPREP_SERIES')) return;
  var cal = CalendarApp.getDefaultCalendar();
  var start = atTime(todayKey_(), '23:30');
  var series = cal.createEventSeries('【手帳】寝る準備', start, new Date(start.getTime() + 15 * 60000),
    CalendarApp.newRecurrence().addDailyRule(), { description: '手帳アプリからの通知です。スマホを置いて、寝る準備を始めましょう。' });
  series.removeAllReminders();
  series.addPopupReminder(0);
  p.setProperty('BEDPREP_SERIES', series.getId());
}


// ----- gas/Gmail.gs -----
// ===== Gmail：確認候補（30 分ごと）=====
// 条件に合う未読メールを手帳の「確認候補」に入れ、「手帳済」ラベルを付けて二重に出さない

function gmailJob() {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var stores = openStores_(ALL_KINDS);
    var st = settings_(stores);
    var froms = (st.gmailFrom || []).filter(String);
    var words = (st.gmailKeywords || ['締切', '提出', '期限', '日程', 'ご確認']).filter(String);
    var parts = [];
    for (var i = 0; i < froms.length; i++) parts.push('from:' + froms[i]);
    if (words.length) parts.push('subject:(' + words.join(' OR ') + ')');
    if (!parts.length) return;
    var q = 'is:unread -label:' + APP_LABEL + ' newer_than:30d (' + parts.join(' OR ') + ')';
    var label = GmailApp.getUserLabelByName(APP_LABEL) || GmailApp.createLabel(APP_LABEL);
    var threads = GmailApp.search(q, 0, 30);
    var today = todayKey_();
    for (var t = 0; t < threads.length; t++) {
      var th = threads[t];
      var msgs = th.getMessages();
      var msg = null;
      for (var m = msgs.length - 1; m >= 0; m--) if (msgs[m].isUnread()) { msg = msgs[m]; break; }
      if (!msg) msg = msgs[msgs.length - 1];
      var body = String(msg.getPlainBody() || '').slice(0, 4000);
      var id = msg.getId();
      if (!getRec_(stores, 'inbox', id)) {
        putRec_(stores, 'inbox', id, {
          threadId: th.getId(), from: msg.getFrom(), subject: msg.getSubject(), date: toIso(msg.getDate()),
          snippet: body.replace(/\s+/g, ' ').slice(0, 300), dates: extractDates(msg.getSubject() + '\n' + body, today, 5),
          link: 'https://mail.google.com/mail/u/0/#all/' + th.getId(), status: 'new'
        }, false);
      }
      th.addLabel(label);
    }
    flushStores_(stores);
  } finally { lock.releaseLock(); }
}


// ----- gas/Night.gs -----
// ===== 23:00 の確認：未完了の【min】をメールで知らせる =====

function minCheckJob() {
  try {
    var stores = openStores_(['task', 'cfg']);
    var today = todayKey_();
    var missing = allTasks_(stores).filter(function (t) { return t.date === today && t.tag === 'min' && !t.done; });
    if (!missing.length) return;
    var st = settings_(stores);
    var lines = missing.map(function (t) { return '・' + t.title + (t.est ? '（' + t.est + '分）' : ''); });
    var body = '23:00 時点で【min】が ' + missing.length + ' 件残っています。\n\n' + lines.join('\n') +
      '\n\n寝る準備は 23:30 から。今日やらない分は、明日へ繰り越されます。' + (st.appUrl ? '\n\n手帳を開く: ' + st.appUrl : '');
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), '【手帳】未完了の【min】' + missing.length + '件', body);
  } finally {
    scheduleAt_('minCheckJob', '23:00');
  }
}


// ----- gas/Setup.gs -----
// ===== 初回セットアップ・トリガー =====
// 使い方：エディタ上部の関数選択で「setup」を選んで ▶実行。表示されたキーをアプリの設定画面に貼る。

function setup() {
  var ss = db_();
  for (var k in SHEETS) sheetOf_(k);
  var def = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
  readme_();
  protectAll_();
  var key = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (!key) key = resetKey_();
  installTriggers_();
  try { ensureBedPrepEvent_(); } catch (e) { console.error('寝る準備の予定: ' + e); }
  try { GmailApp.getUserLabelByName(APP_LABEL) || GmailApp.createLabel(APP_LABEL); } catch (e) { console.error(e); }
  Logger.log('セットアップ完了。\nアプリの「設定」→「Google との接続」に、ウェブアプリの URL と次のキーを貼ってください:\n\n' + key);
}

function showKey() { Logger.log(PropertiesService.getScriptProperties().getProperty('API_KEY')); }

// キーを作り直す（スマホをなくしたときなど）。古いキーは使えなくなる
function resetKey() { Logger.log('新しいキー: ' + resetKey_()); }

function resetKey_() {
  var key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('API_KEY', key);
  return key;
}

function readme_() {
  var ss = db_();
  var sh = ss.getSheetByName('はじめに') || ss.insertSheet('はじめに', 0);
  sh.clear();
  sh.getRange(1, 1, 5, 1).setValues([
    ['このスプレッドシートは手帳アプリが自動で管理しています。'],
    ['直接編集しないでください（編集しようとすると警告が出ます）。'],
    ['誤って書き換えたときは「ファイル」→「変更履歴」→「変更履歴を表示」から元に戻せます。'],
    ['データの確認・修正・書き出しは、手帳アプリの画面から行ってください。'],
    ['']
  ]);
  sh.getRange('A1').setFontWeight('bold').setFontSize(14);
  sh.setColumnWidth(1, 720);
}

function protectAll_() {
  var sheets = db_().getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var sh = sheets[i];
    var ps = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    for (var j = 0; j < ps.length; j++) ps[j].remove();
    var p = sh.protect().setDescription('手帳アプリが管理しています。直接編集しないでください。');
    p.setWarningOnly(true);
    sh.setTabColor(sh.getName() === 'はじめに' ? '#e8a33d' : '#8a8f98');
  }
}

function installTriggers_() {
  var ts = ScriptApp.getProjectTriggers();
  for (var i = 0; i < ts.length; i++) ScriptApp.deleteTrigger(ts[i]);
  scheduleAt_('nextDayJob', '21:50');
  scheduleAt_('minCheckJob', '23:00');
  ScriptApp.newTrigger('gmailJob').timeBased().everyMinutes(30).create();
  ScriptApp.newTrigger('watchdog').timeBased().everyDays(1).atHour(3).inTimezone(TZ).create();
}

// 「毎日 21 時台」ではなく「ちょうど 21:50」に動かすため、1 回だけのトリガーを毎回作り直す
function scheduleAt_(fn, hhmm) {
  var ts = ScriptApp.getProjectTriggers();
  for (var i = 0; i < ts.length; i++) if (ts[i].getHandlerFunction() === fn) ScriptApp.deleteTrigger(ts[i]);
  var now = new Date();
  var at = atTime(dateKey(now), hhmm);
  if (at.getTime() <= now.getTime() + 60000) at = atTime(addDays(dateKey(now), 1), hhmm);
  ScriptApp.newTrigger(fn).timeBased().at(at).create();
}

// 毎日 3 時：予約が消えていたら作り直す（実行エラーで途切れたとき用）
function watchdog() {
  var names = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  if (names.indexOf('nextDayJob') < 0) scheduleAt_('nextDayJob', '21:50');
  if (names.indexOf('minCheckJob') < 0) scheduleAt_('minCheckJob', '23:00');
  if (names.indexOf('gmailJob') < 0) ScriptApp.newTrigger('gmailJob').timeBased().everyMinutes(30).create();
}

