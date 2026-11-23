// ===== 手帳API（Google Apps Script）=====
// アプリ（GitHub Pages）から呼ばれる窓口。合言葉（キー）が一致したときだけ読み書きする。

var TZ = 'Asia/Tokyo';
var APP_LABEL = '手帳済';

function doGet() {
  // データは返さない（動作確認用）
  return ContentService.createTextOutput('手帳API は動いています。').setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  var res;
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!checkKey_(body.key)) return json_({ ok: false, error: 'unauthorized' });
    switch (body.action) {
      case 'ping': res = { ok: true, now: toIso(new Date()) }; break;
      case 'sync': res = handleSync(body); break;
      case 'calendar': res = handleCalendar(body); break;
      default: res = { ok: false, error: 'unknown action' };
    }
  } catch (err) {
    console.error(err && err.stack || err);
    res = { ok: false, error: String(err && err.message || err) };
  }
  return json_(res);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// キーの確認。間違いが 10 分に 30 回を超えたら、しばらくすべて拒否する
function checkKey_(key) {
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('authFails') || 0);
  if (fails > 30) return false;
  var real = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (!real || typeof key !== 'string' || key.length !== real.length) { cache.put('authFails', String(fails + 1), 600); return false; }
  var diff = 0;
  for (var i = 0; i < real.length; i++) diff |= real.charCodeAt(i) ^ key.charCodeAt(i);
  if (diff !== 0) { cache.put('authFails', String(fails + 1), 600); return false; }
  return true;
}

function todayKey_() { return dateKey(new Date()); }
