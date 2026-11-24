const $ = id => document.getElementById(id);
let bundle = null;
let worker = null;
let downloadKey = null;
let sourcePromise = null;
navigator.serviceWorker?.addEventListener('message',event=>{
  if(event.data?.type==='request-session')event.ports[0]?.postMessage(bundle&&downloadKey?{bundle,key:downloadKey}:{bundle:null});
});
const fromBase64 = value => Uint8Array.from(atob(value),char=>char.charCodeAt(0));
async function tell(type, payload = {}) {
  const channel=new MessageChannel();
  const response=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('页面缓存初始化超时，请刷新重试。')),10000);channel.port1.onmessage=event=>{clearTimeout(timer);resolve(event.data);};});
  worker.postMessage({type,...payload},[channel.port2]);return response;
}
async function initializeWorker(){
  if(!window.isSecureContext || !('serviceWorker' in navigator))throw new Error('请使用 HTTPS 和新版 Chrome / Edge 打开。');
  const wrapperVersion=new URL(import.meta.url).searchParams.get('v')||'1';
  const registration=await navigator.serviceWorker.register('./sw.js?v='+wrapperVersion,{scope:'./',updateViaCache:'none'});
  await navigator.serviceWorker.ready;
  worker=registration.active;
  if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
}
function download(name,bytes,type='application/octet-stream'){
  const url=URL.createObjectURL(new Blob([bytes],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function renderFiles(){
  const query=$('file-search').value.toLowerCase();$('file-list').replaceChildren();
  bundle.sourceFiles.filter(file=>file.path.toLowerCase().includes(query)).forEach(file=>{const button=document.createElement('button');button.textContent=file.path;button.onclick=async()=>{
    $('file-name').textContent=file.path;
    $('file-content').textContent='正在读取代码…';
    try{if(!sourcePromise)sourcePromise=(async()=>{const bytes=await (await fetch('./'+bundle.sourceText.file+'?v='+encodeURIComponent(bundle.sourceText.iv),{cache:'no-store'})).arrayBuffer();const packed=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(bundle.sourceText.iv)},downloadKey,bytes);return JSON.parse(await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).text());})();
      const files=await sourcePromise;const source=files.find(item=>item.path===file.path);$('file-content').textContent=source.text===undefined?'此文件为二进制文件，可下载完整代码包后打开。':source.text;
    }catch(error){sourcePromise=null;$('file-content').textContent=error.message;}
  };$('file-list').append(button);});
}
function renderRows(){
  const table=bundle.database.tables[Number($('table-select').value)];
  const query=$('row-search').value.toLowerCase();const rows=table.rows.filter(row=>!query||JSON.stringify(row).toLowerCase().includes(query));
  $('table-count').textContent=`${table.rows.length} 条原始记录；匹配 ${rows.length} 条。`;const head=document.createElement('tr');
  table.columns.forEach(column=>{const cell=document.createElement('th');cell.textContent=`${column.name}\n${column.type}`;head.append(cell);});
  const thead=document.createElement('thead');thead.append(head);const tbody=document.createElement('tbody');
  rows.forEach(row=>{const tr=document.createElement('tr');row.forEach(value=>{const td=document.createElement('td');td.textContent=value===null?'NULL':String(value);tr.append(td);});tbody.append(tr);});
  $('data-table').replaceChildren(thead,tbody);
}
function openWorkspace(){
  $('summary').textContent=`v${bundle.version} · ${new Date(bundle.snapshotAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})} · ${bundle.projectCount} 项目 · ${bundle.database.tables.length} 表`;
  $('login').hidden=true;$('workspace').hidden=false;$('app-frame').src='./app/index.html#/projects';
  bundle.database.tables.forEach((table,index)=>{const option=document.createElement('option');option.value=index;option.textContent=`${table.name} (${table.rows.length})`;$('table-select').append(option);});
  renderFiles();renderRows();$('download-note').textContent=`代码文件 ${bundle.sourceFiles.length} 个，数据库记录 ${bundle.database.tables.reduce((n,t)=>n+t.rows.length,0)} 条。`;
  for(const item of bundle.downloads){const button=document.createElement('button');button.textContent=`下载 ${item.name}`;button.onclick=async()=>{
    button.disabled=true;button.textContent='正在下载并解锁…';
    try{const response=await fetch('./'+item.file+'?v='+encodeURIComponent(item.iv),{cache:'no-store'});if(!response.ok)throw new Error('下载失败，请重试。');
      const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(item.iv)},downloadKey,await response.arrayBuffer());
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
      if(digest!==item.sha256)throw new Error('备份校验未通过，请重试。');download(item.name,bytes);
    }catch(error){alert(error.message);}finally{button.disabled=false;button.textContent=`下载 ${item.name}`;}
  };$('download-list').append(button);}
}
$('login-form').onsubmit=async event=>{
  event.preventDefault();$('login-button').disabled=true;$('login-note').textContent='正在解锁完整快照…';
  try{
    const envelope=await (await fetch('./payload.json',{cache:'no-store'})).json();
    if($('username').value.trim()!==envelope.username)throw new Error('账号或访问口令不正确。');
    const passwordKey=await crypto.subtle.importKey('raw',new TextEncoder().encode($('password').value),'PBKDF2',false,['deriveKey']);
    const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:fromBase64(envelope.salt),iterations:envelope.iterations,hash:'SHA-256'},passwordKey,{name:'AES-GCM',length:256},false,['decrypt']);
    let packed;try{packed=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(envelope.iv)},key,fromBase64(envelope.ciphertext));}catch{throw new Error('账号或访问口令不正确，或快照文件损坏。');}
    downloadKey=key;
    const stream=new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'));
    bundle=JSON.parse(await new Response(stream).text());
    await initializeWorker();await tell('unlock',{bundle,key});$('password').value='';openWorkspace();
  }catch(error){bundle=null;downloadKey=null;$('login-note').textContent=error.message;}finally{$('login-button').disabled=false;}
};
document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{
  document.querySelectorAll('[data-tab]').forEach(item=>item.classList.toggle('active',item===button));
  for(const tab of ['app','source','database','downloads'])$(tab+'-panel').hidden=tab!==button.dataset.tab;
});
$('file-search').oninput=renderFiles;$('row-search').oninput=renderRows;$('table-select').onchange=()=>{$('row-search').value='';renderRows();};
$('logout').onclick=async()=>{await tell('lock');bundle=null;downloadKey=null;sourcePromise=null;$('app-frame').src='about:blank';location.reload();};
