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
