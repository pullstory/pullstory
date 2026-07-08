const CACHE_NAME = 'pullstory-app-v2';
const CORE = ['./', './index.html', './manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = req.url;

  // Firebase/Google/gstatic: 항상 네트워크 우선
  if (url.includes('firebase') || url.includes('googleapis.com') || url.includes('gstatic')) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // HTML 문서/네비게이션: 네트워크 우선 (앱 업데이트 즉시 반영, 오프라인 시 캐시)
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 기타 정적 자산(아이콘 등): 캐시 우선
  event.respondWith(caches.match(req).then(r => r || fetch(req)));
});
