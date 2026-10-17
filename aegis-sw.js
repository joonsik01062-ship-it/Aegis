// 보안: 이 앱의 파일(같은 주소)만 다룬다. 뉴스·지도·날씨 같은 바깥 요청(내 위치가 들어갈 수 있음)은 건드리지도 저장하지도 않는다.
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{
  const r=e.request;
  if(r.method!=='GET')return;
  const u=new URL(r.url);
  if(u.origin!==self.location.origin)return;
  e.respondWith(fetch(r).then(res=>{if(res.ok&&res.type==='basic'){const c=res.clone();caches.open('aegis').then(k=>k.put(r,c)).catch(()=>{})}return res}).catch(()=>caches.match(r)))});
