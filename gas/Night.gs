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
