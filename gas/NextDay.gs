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
