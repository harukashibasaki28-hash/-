// Service Worker：アプリ本体をキャッシュして、オフラインでも開けるようにする
// 通信できるときは常に最新を取りに行くので、VERSION は大きな変更のときだけ変えればよい
const VERSION = 'techo-v1-0001';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'config/defaults.json', 'config/rules.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'src/app.js', 'src/actions.js', 'src/ui/styles.css',
  'src/core/dates.js', 'src/core/tasks.js', 'src/core/sleep.js', 'src/core/timer.js', 'src/core/carryover.js',
  'src/core/stats.js', 'src/core/study.js', 'src/core/srs.js', 'src/core/estimates.js', 'src/core/scheduler.js',
  'src/core/planSheet.js', 'src/core/dayBuild.js', 'src/core/dateExtract.js', 'src/core/legacy.js',
  'src/model/importExport.js', 'src/model/records.js',
  'src/store/localDb.js', 'src/store/store.js', 'src/store/sync.js',
  'src/analysis/index.js', 'src/analysis/metrics.js', 'src/analysis/ruleEngine.js',
  'src/notify/notifier.js', 'src/notify/ics.js', 'src/notify/shortcuts.js',
  'src/ui/util.js', 'src/ui/chart.js', 'src/ui/today.js', 'src/ui/timeline.js', 'src/ui/review.js',
  'src/ui/study.js', 'src/ui/hourensou.js', 'src/ui/log.js', 'src/ui/settings.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// 同じサイトのファイルだけ：ネットにつながればそれを使い（最新）、だめならキャッシュ
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => (list[0] ? list[0].focus() : self.clients.openWindow('./#today'))));
});
