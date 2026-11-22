// その日の To Do を組み立てる（アプリの日付切り替え時・21:50 の GAS の両方で使う）
// ①毎日のタスク ②学習科目 ③予定一覧 ④時間割の枠 ⑤カレンダー予定
import { weekday, hmToMin, minToHm } from './dates.js';
import { templateTasksFor, normalizeTask, tagOf } from './tasks.js';
import { planStudyDay } from './study.js';
import { planItemsForDate, timetableSlots, calendarItems } from './planSheet.js';

// ctx: { templates, subjects, tasksAll, links, mode, planItems?, timetableRows?, calendarEvents? }
// 返り値: { create: [新しいタスク], patch: [{id, start, fixedTime, slotMin}], studyKeep: {subjectId: keepIds}, plan }
export function buildDay(dk, ctx) {
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
export function studyTasksToRemove(dk, tasksAll, studyKeep) {
  const out = [];
  for (const t of tasksAll || []) {
    if (t.deleted || t.date !== dk || t.source !== 'study' || t.done || t.carriedFrom || t.manual) continue;
    if ((t.sessions && t.sessions.length) || t.runningSince) continue;
    const keep = studyKeep[t.subjectId];
    if (keep && !keep[t.id]) out.push(t.id);
  }
  return out;
}
