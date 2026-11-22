// 「レコード」＝同期とスプレッドシート保存の単位（1 日・1 タスク・1 報連相・1 設定…）
// { kind, id, data, updatedAt, deleted }
export const KINDS = ['day', 'task', 'hou', 'tpl', 'subj', 'cfg', 'inbox', 'plan'];
export const CONFIG_IDS = ['settings', 'fixedEvents', 'rules', 'links', 'state'];

export function recKey(kind, id) { return kind + ':' + id; }

const DAY_FIELDS = ['sleep', 'naps', 'note', 'closed', 'planned', 'done', 'rate', 'review'];

export function dayData(day) {
  const o = {};
  for (const f of DAY_FIELDS) if (day[f] !== undefined) o[f] = day[f];
  return o;
}

// 読み込んだデータ → レコードの配列
export function importToRecords(data) {
  const out = [];
  for (const dk of Object.keys(data.days)) {
    const day = data.days[dk];
    out.push({ kind: 'day', id: dk, data: dayData(day) });
    for (const t of day.tasks) out.push({ kind: 'task', id: t.id, data: Object.assign({}, t, { date: dk }) });
  }
  for (const id of Object.keys(data.hourensou)) out.push({ kind: 'hou', id: id, data: data.hourensou[id] });
  const c = data.config || {};
  if (Array.isArray(c.templates)) for (const t of c.templates) out.push({ kind: 'tpl', id: t.id, data: t });
  if (Array.isArray(c.subjects)) for (const s of c.subjects) out.push({ kind: 'subj', id: s.id, data: s });
  for (const k of ['settings', 'fixedEvents', 'rules', 'links']) if (c[k] !== undefined) out.push({ kind: 'cfg', id: k, data: { value: c[k] } });
  return out;
}

// レコードの集まり → 画面で使う形
export function buildView(records, defaults) {
  const v = {
    days: {}, hourensou: {}, templates: [], subjects: [], inbox: [], plans: {},
    settings: Object.assign({}, defaults.settings), fixedEvents: defaults.fixedEvents, rules: defaults.rules,
    links: defaults.links, state: {},
  };
  const tasksByDate = {};
  v.deletedTasks = [];
  for (const r of records) {
    if (r.deleted) { if (r.kind === 'task') v.deletedTasks.push(Object.assign({}, r.data, { id: r.id, deleted: true })); continue; }
    const d = r.data || {};
    switch (r.kind) {
      case 'day': v.days[r.id] = Object.assign(emptyDay(), d, { date: r.id, tasks: [] }); break;
      case 'task': (tasksByDate[d.date] = tasksByDate[d.date] || []).push(Object.assign({}, d, { id: r.id })); break;
      case 'hou': v.hourensou[r.id] = Object.assign({}, d, { id: r.id }); break;
      case 'tpl': v.templates.push(Object.assign({}, d, { id: r.id })); break;
      case 'subj': v.subjects.push(Object.assign({}, d, { id: r.id })); break;
      case 'inbox': v.inbox.push(Object.assign({}, d, { id: r.id })); break;
      case 'plan': v.plans[r.id] = d; break;
      case 'cfg':
        if (r.id === 'settings') v.settings = Object.assign({}, defaults.settings, d.value || {});
        else if (r.id === 'state') v.state = d.value || {};
        else if (d.value !== undefined) v[r.id] = d.value;
        break;
    }
  }
  for (const dk of Object.keys(tasksByDate)) {
    if (!v.days[dk]) v.days[dk] = Object.assign(emptyDay(), { date: dk, tasks: [] });
    v.days[dk].tasks = tasksByDate[dk].sort(taskOrder);
  }
  v.templates.sort((a, b) => (a.order || 0) - (b.order || 0));
  v.allTasks = [];
  for (const dk of Object.keys(tasksByDate)) for (const t of tasksByDate[dk]) v.allTasks.push(t);
  return v;
}

export function emptyDay() {
  return { tasks: [], sleep: null, naps: [], note: '', closed: false, planned: null, done: null, rate: null, review: '' };
}

export function taskOrder(a, b) {
  const sa = a.start || '99:99', sb = b.start || '99:99';
  if (sa !== sb) return sa < sb ? -1 : 1;
  if ((a.priority || 2) !== (b.priority || 2)) return (a.priority || 2) - (b.priority || 2);
  return String(a.id) < String(b.id) ? -1 : 1;
}
