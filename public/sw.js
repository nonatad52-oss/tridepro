self.addEventListener('install', (e) => {
    self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
    // Estratégia de bypass para requisições do Supabase Realtime funcionarem offline
    e.respondWith(fetch(e.request));
});
