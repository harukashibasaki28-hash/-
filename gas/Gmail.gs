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
