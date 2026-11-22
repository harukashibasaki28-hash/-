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
