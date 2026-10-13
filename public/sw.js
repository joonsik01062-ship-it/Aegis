// 이지스 서비스 워커: 앱이 뒤에 있을 때 알림을 띄우고, 알림을 누르면 앱으로 돌아오게 한다.
// 화면 파일은 캐시하지 않는다. (배포하면 모두에게 바로 최신 버전이 보이도록)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow('/');
    })
  );
});
