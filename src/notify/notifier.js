// 通知（アプリを開いている間）。閉じている間の通知は、アラーム（ショートカット／.ics）・カレンダー・メールで行う
export function notifySupported() { return typeof Notification !== 'undefined'; }

export async function requestPermission() {
  if (!notifySupported()) return 'unsupported';
  if (Notification.permission === 'default') return Notification.requestPermission();
  return Notification.permission;
}

export async function notify(title, body, fallback) {
  try {
    if (notifySupported() && Notification.permission === 'granted') {
      const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
      if (reg && reg.showNotification) { await reg.showNotification(title, { body, icon: 'icons/icon-192.png', tag: title }); return true; }
      new Notification(title, { body });
      return true;
    }
  } catch (e) { /* 失敗したら画面内表示 */ }
  if (fallback) fallback(title, body);
  return false;
}
