// iPhone のショートカット「手帳アラーム」を呼び出して、時計アプリにアラームを作る
// 入力は「06:00」のような時刻の文字だけ。ショートカットの作り方は docs/SETUP_ALARM.md
export function shortcutUrl(name, hhmm) {
  return 'shortcuts://run-shortcut?name=' + encodeURIComponent(name || '手帳アラーム') + '&input=text&text=' + encodeURIComponent(hhmm);
}

export function isIOS() {
  return typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent || '');
}
