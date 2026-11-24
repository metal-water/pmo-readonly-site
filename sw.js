/* global importScripts, snapshotResponse */
importScripts('./api-snapshot.js');
let unlocked = null;
let sessionKey = null;
let restorePromise = null;
const base = new URL('./', self.location).pathname;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' } });
async function restoreSession() {
  if(unlocked)return;
  if(restorePromise)return restorePromise;
  restorePromise=(async()=>{
    const root=new URL('./',self.location).href;
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows.filter(client=>client.url.split('#')[0]===root||client.url.split('#')[0]===root+'index.html')){
      const channel=new MessageChannel();
      const result=await new Promise(resolve=>{
        const timer=setTimeout(()=>resolve(null),3000);
        channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data);};
        client.postMessage({type:'request-session'},[channel.port2]);
      });
      if(result?.bundle&&result.key){unlocked=result.bundle;sessionKey=result.key;return;}
    }
  })().finally(()=>{restorePromise=null;});
  return restorePromise;
}
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  const type = event.data?.type;
  if (type === 'unlock') { unlocked = event.data.bundle; sessionKey = event.data.key; }
  if (type === 'lock') { unlocked = null; sessionKey = null; }
  event.ports[0]?.postMessage({ unlocked: !!unlocked });
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const relative = url.pathname.startsWith(base) ? decodeURIComponent(url.pathname.slice(base.length)) : '';
  const api = url.pathname.startsWith('/api/') || relative.startsWith('app/api/');
  if (!relative.startsWith('app/') && !api) return;
  event.respondWith((async () => {
    await restoreSession();
    if (!unlocked) return event.request.mode === 'navigate' ? Response.redirect(new URL('./', self.location), 302) : json({ success:false,message:'请先登录解锁只读快照。' },401);
    if (!['GET','HEAD'].includes(event.request.method)) return json({ success:false,message:'这是只读快照，不能保存或修改数据。' },405);
    if (api) {
      const result = snapshotResponse(unlocked, url.href);
      return json(result.body,result.status);
    }
    const asset = unlocked.assets[relative.slice(4) || 'index.html'];
    if (!asset) return new Response('Not found', { status:404 });
    let bytes;
    if (asset.file) {
      const assetUrl=new URL(asset.file,self.location);assetUrl.searchParams.set('v',asset.iv);
      const encrypted = await (await fetch(assetUrl,{cache:'no-store'})).arrayBuffer();
      bytes = await crypto.subtle.decrypt({name:'AES-GCM',iv:Uint8Array.from(atob(asset.iv),char=>char.charCodeAt(0))},sessionKey,encrypted);
    } else bytes = Uint8Array.from(atob(asset.base64), char => char.charCodeAt(0));
    return new Response(bytes, { headers: { 'Content-Type':asset.mime, 'Cache-Control':'no-store' } });
  })());
});
