// The build prepends the immutable RELEASE inventory. Cache only those public bytes.
const cachePrefix = RELEASE.cachePrefix || 'idle-slayer-companion-public-';
const cacheName = cachePrefix + RELEASE.version;
const allowed = new Map(RELEASE.assets.map((asset) => [new URL(asset.file, self.registration.scope).href, asset]));
const startURL = new URL('index.html', self.registration.scope).href;
const sectionPaths = new Set(['overview', 'ascension', 'achievements', 'crafting', 'quests', 'bestiary', 'divinities']);
const navigationEntries = new Map([[new URL(self.registration.scope).pathname, startURL], [new URL(startURL).pathname, startURL]]);
for (const section of sectionPaths) {
 const entry = new URL(section + '/index.html', self.registration.scope).href;
 navigationEntries.set(new URL(section + '/', self.registration.scope).pathname, entry);
 navigationEntries.set(new URL(entry).pathname, entry);
}
const recoveryHTML = `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Companion files unavailable</title><body><h1>Reconnect to reopen your companion</h1><p>The saved app files are unavailable. Connect to the internet and close other companion windows before repairing. Browser-stored progress is separate and will be kept.</p><button id="repair">Repair app files and reload</button><p id="note" role="status"></p><script>
document.getElementById('repair').onclick=async()=>{
 const note=document.getElementById('note');
 if(!navigator.onLine){note.textContent='Connect to the internet before repairing.';return;}
 try{
  const registration=await navigator.serviceWorker.getRegistration();
  if(registration?.active){
   const allowed=await new Promise((resolve,reject)=>{const channel=new MessageChannel();const timer=setTimeout(()=>reject(new Error()),8000);channel.port1.onmessage=(event)=>{clearTimeout(timer);channel.port1.close();resolve(event.data.accepted)};registration.active.postMessage({type:'CHECK_WINDOWS'},[channel.port2]);});
   if(!allowed){note.textContent='Close other Idle Slayer Companion windows, then try again.';return;}
   if(!await registration.unregister())throw new Error();
  }
  location.reload();
 }catch{note.textContent='Repair could not start. Reconnect and try again. Do not clear browser data if you want to keep saved progress.';}
};
</script></body></html>`;
async function reportWorkerFailure(error, phase, url = '') {
 try {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) if (client.url.startsWith(self.registration.scope)) client.postMessage({ type: 'REPORTING_FAILURE', error, message: error instanceof Error ? error.message : String(error), phase, url, version: RELEASE.version });
 } catch { /* Reporting cannot break offline recovery. */ }
}
async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(cacheName);
      // A failed or racing deployment cannot publish a partly populated cache.
      for (const [url, asset] of allowed) {
        const response = await fetch(url, { cache: 'no-store', credentials: 'omit', redirect: 'error' });
        if (!response.ok || response.type === 'opaque' || await sha256(await response.clone().arrayBuffer()) !== asset.sha256) throw new Error('Incomplete release: ' + asset.file + ' HTTP ' + response.status);
        await cache.put(url, response);
      }
    } catch (error) { await reportWorkerFailure(error, 'install'); await caches.delete(cacheName); throw error; }
  })());
});
self.addEventListener('activate', (event) => {
  // No skipWaiting or clients.claim: the browser waits for every old controlled
  // window to close before activation and removal of its complete release cache.
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith(cachePrefix) && name !== cacheName) await caches.delete(name);
  })());
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'CHECK_READY') event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    event.ports[0]?.postMessage({ ready: keys.length === allowed.size, version: RELEASE.version });
  })());
  if (event.data?.type === 'CHECK_WINDOWS') event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const appWindows = windows.filter((client) => new URL(client.url).origin === self.location.origin && new URL(client.url).pathname.startsWith(new URL(self.registration.scope).pathname));
    if (!event.source || appWindows.some((client) => client.id !== event.source.id)) { event.ports[0]?.postMessage({ accepted: false }); return; }
    event.ports[0]?.postMessage({ accepted: true });
  })());
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const navigationEntry = request.mode === 'navigate' ? navigationEntries.get(url.pathname) : undefined;
  const navigation = Boolean(navigationEntry);
  // Only navigation to reviewed static sections may ignore a query. Never store that URL,
  // fragments, file/Blob imports, transfer data, external analytics or POSTs.
  const key = navigationEntry ?? request.url;
  if (!allowed.has(key)) return;
  event.respondWith((async () => {
    const cached = await (await caches.open(cacheName)).match(key);
    if (cached) return cached;
    await reportWorkerFailure(new Error('Cached app file missing'), 'cache-miss', key);
    // Do not fetch newer bytes into an older running release after eviction.
    if (navigation) return new Response(recoveryHTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    return new Response('This app file is unavailable. Reconnect and reopen your companion.', { status: 503 });
  })());
});
