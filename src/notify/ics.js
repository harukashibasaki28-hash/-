// アラーム付き .ics（カレンダーに追加すると、その時刻に通知が鳴る）
function utc(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function alarmIcs(title, at, minutes) {
  const end = new Date(at.getTime() + (minutes || 5) * 60000);
  const uid = 'techo-' + at.getTime() + '@techo';
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//techo//JP', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + utc(new Date()), 'DTSTART:' + utc(at), 'DTEND:' + utc(end),
    'SUMMARY:' + title,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + title, 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

export function downloadText(filename, text, type) {
  const blob = new Blob([text], { type: type || 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
