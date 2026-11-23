// ===== 初回セットアップ・トリガー =====
// 使い方：エディタ上部の関数選択で「setup」を選んで ▶実行。表示されたキーをアプリの設定画面に貼る。

function setup() {
  var ss = db_();
  for (var k in SHEETS) sheetOf_(k);
  var def = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
  readme_();
  protectAll_();
  var key = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (!key) key = resetKey_();
  installTriggers_();
  try { ensureBedPrepEvent_(); } catch (e) { console.error('寝る準備の予定: ' + e); }
  try { GmailApp.getUserLabelByName(APP_LABEL) || GmailApp.createLabel(APP_LABEL); } catch (e) { console.error(e); }
  Logger.log('セットアップ完了。\nアプリの「設定」→「Google との接続」に、ウェブアプリの URL と次のキーを貼ってください:\n\n' + key);
}

function showKey() { Logger.log(PropertiesService.getScriptProperties().getProperty('API_KEY')); }

// キーを作り直す（スマホをなくしたときなど）。古いキーは使えなくなる
function resetKey() { Logger.log('新しいキー: ' + resetKey_()); }

function resetKey_() {
  var key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('API_KEY', key);
  return key;
}

function readme_() {
  var ss = db_();
  var sh = ss.getSheetByName('はじめに') || ss.insertSheet('はじめに', 0);
  sh.clear();
  sh.getRange(1, 1, 5, 1).setValues([
    ['このスプレッドシートは手帳アプリが自動で管理しています。'],
    ['直接編集しないでください（編集しようとすると警告が出ます）。'],
    ['誤って書き換えたときは「ファイル」→「変更履歴」→「変更履歴を表示」から元に戻せます。'],
    ['データの確認・修正・書き出しは、手帳アプリの画面から行ってください。'],
    ['']
  ]);
  sh.getRange('A1').setFontWeight('bold').setFontSize(14);
  sh.setColumnWidth(1, 720);
}

function protectAll_() {
  var sheets = db_().getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var sh = sheets[i];
    var ps = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    for (var j = 0; j < ps.length; j++) ps[j].remove();
    var p = sh.protect().setDescription('手帳アプリが管理しています。直接編集しないでください。');
    p.setWarningOnly(true);
    sh.setTabColor(sh.getName() === 'はじめに' ? '#e8a33d' : '#8a8f98');
  }
}

function installTriggers_() {
  var ts = ScriptApp.getProjectTriggers();
  for (var i = 0; i < ts.length; i++) ScriptApp.deleteTrigger(ts[i]);
  scheduleAt_('nextDayJob', '21:50');
  scheduleAt_('minCheckJob', '23:00');
  ScriptApp.newTrigger('gmailJob').timeBased().everyMinutes(30).create();
  ScriptApp.newTrigger('watchdog').timeBased().everyDays(1).atHour(3).inTimezone(TZ).create();
}

// 「毎日 21 時台」ではなく「ちょうど 21:50」に動かすため、1 回だけのトリガーを毎回作り直す
function scheduleAt_(fn, hhmm) {
  var ts = ScriptApp.getProjectTriggers();
  for (var i = 0; i < ts.length; i++) if (ts[i].getHandlerFunction() === fn) ScriptApp.deleteTrigger(ts[i]);
  var now = new Date();
  var at = atTime(dateKey(now), hhmm);
  if (at.getTime() <= now.getTime() + 60000) at = atTime(addDays(dateKey(now), 1), hhmm);
  ScriptApp.newTrigger(fn).timeBased().at(at).create();
}

// 毎日 3 時：予約が消えていたら作り直す（実行エラーで途切れたとき用）
function watchdog() {
  var names = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  if (names.indexOf('nextDayJob') < 0) scheduleAt_('nextDayJob', '21:50');
  if (names.indexOf('minCheckJob') < 0) scheduleAt_('minCheckJob', '23:00');
  if (names.indexOf('gmailJob') < 0) ScriptApp.newTrigger('gmailJob').timeBased().everyMinutes(30).create();
}
