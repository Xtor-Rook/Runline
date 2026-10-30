const CACHE='runline-v1.5.1-shell-1';
const APP_SHELL=[
  './',
  './index.html',
  './app.js?v=1.5.1',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.min.js'
];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin){
    if(url.hostname==='cdn.jsdelivr.net'){
      event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;})));
    }
    return;
  }

  if(event.request.mode==='navigate'){
    event.respondWith(
      fetch(event.request)
        .then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put('./index.html',copy));return response;})
        .catch(()=>caches.match('./index.html'))
    );
    return;
  }

  const isFreshAsset=url.pathname.endsWith('/app.js') || url.pathname.endsWith('/manifest.webmanifest');
  if(isFreshAsset){
    event.respondWith(
      fetch(event.request)
        .then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;})
        .catch(()=>caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{
      const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;
    }))
  );
});
