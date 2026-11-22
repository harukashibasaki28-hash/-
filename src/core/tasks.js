// タスクの基本操作・ID 規則・毎日のタスクの展開
// GAS にも同梱される（tools/build-gas.mjs）。他ファイルの関数は使わず、import も書かないこと。

// 【min】【A】【任意】をタイトルから判定
export function tagOf(title) {
  const m = String(title || '').match(/【(min|MIN|Min|A|任意)】/);
  if (!m) return null;
  const t = m[1].toLowerCase();
  return t === 'min' ? 'min' : t === 'a' ? 'A' : '任意';
}

export function randomId(len) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < (len || 12); i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// 繰越コピーの ID：元の ID（@ より前）＋ @ ＋ 繰越先の日付。何台で繰越しても同じ ID になる
export function baseId(id) { return String(id).split('@')[0]; }
export function carriedId(id, toDate) { return baseId(id) + '@' + toDate; }
// 繰越コピーがある（＝すでに繰り越された）タスクの ID 一覧
// 元のタスクは書き換えない（別の端末での「完了」を上書きしないため）
export function carriedOriginals(tasks) {
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

export function templateTaskId(templateId, dk) { return 'tpl:' + templateId + ':' + dk; }
export function studyTaskId(subjectId, unitKey) { return 'stu:' + subjectId + ':' + unitKey; }

export const TASK_DEFAULTS = {
  title: '', done: false, doneAt: null, priority: 2, est: 30, actualMin: 0,
  sessions: [], runningSince: null, deadline: null, start: null,
  carryCount: 0, carriedFrom: null,
};

// 欠けた項目を補い、型をそろえる
export function normalizeTask(t, dk) {
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

export function normalizeSpan(s) {
  const o = Object.assign({ start: null, end: null, min: 0 }, s || {});
  o.min = Number(o.min) || 0;
  return o;
}

export function sumMin(spans) {
  let t = 0;
  for (const s of spans || []) t += Number(s.min) || 0;
  return t;
}

// 毎日のタスク（テンプレート）からその日のタスクを作る。
// existing: その日にすでにあるタスク。繰越されたテンプレート由来のタスクがあれば作らない。
export function templateTasksFor(dk, templates, existing, weekdayOfDate) {
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
