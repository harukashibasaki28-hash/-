// 前の手帳（Claude のチャット）から移したタスクの扱い
// 出どころ daily（日課）・sheet（学習計画シート）は「毎日の日課」として表示し、
// 同じ日にアプリの日課（学習科目・金フレ・毎日のタスク・時間割）がそろったら、手を付けていない前の手帳の分は片付ける。

export const LEGACY_ROUTINE = { daily: true, sheet: true };

// 前の手帳のタスク（タイトル）→ 同じ役目のアプリのタスクがあるか
// carried: true のルールは、繰越されてきた前の手帳の分も片付ける（同じ単位・同じ日課が二重になるため）
const RULES = [
  { re: /金フレ/, carried: true, has: (t) => t.subjectId === 'kinfre' },
  { re: /英語学習プログラム|英語発音上達講座|リスニング講座|VERSANT|リーダーシップ/, carried: true, has: (t) => t.subjectId === 'eng' },
  { re: /4002/, carried: true, has: (t) => t.subjectId === 'e4002' },
  { re: /FP2級.*(CH|Sec|章)/, carried: true, has: (t) => t.subjectId === 'fp2' },
  { re: /日経/, carried: true, has: (t) => t.templateId === 'nikkei' },
  { re: /ChatGPT/, carried: true, has: (t) => t.templateId === 'gpt' },
  { re: /23時半に寝る|寝る準備/, carried: true, has: () => true }, // 23:30 の「寝る準備」通知に置き換え
  { re: /過去問道場/, carried: false, has: (t) => t.source === 'timetable' && /過去問道場/.test(t.title) },
  { re: /vintage/, carried: false, has: (t) => t.source === 'timetable' && /vintage/.test(t.title) },
  { re: /Part7|TOEICリーディング/, carried: false, has: (t) => t.source === 'timetable' && /Part7/.test(t.title) },
];

export function isLegacyRoutine(t) { return !!LEGACY_ROUTINE[t.source]; }

// dk の日の、片付けてよい前の手帳のタスクの ID
export function legacyDuplicates(tasks, dk) {
  const day = (tasks || []).filter((t) => !t.deleted && t.date === dk);
  const mine = day.filter((t) => !isLegacyRoutine(t));
  const out = [];
  for (const t of day) {
    if (!isLegacyRoutine(t) || t.done || t.runningSince || (t.sessions && t.sessions.length)) continue;
    const carried = !!(t.carriedFrom || t.carryCount);
    const rule = RULES.find((r) => r.re.test(t.title || ''));
    if (!rule || (carried && !rule.carried)) continue;
    if (rule.re.source.indexOf('23時半') === 0 || mine.some(rule.has)) out.push(t.id);
  }
  return out;
}
