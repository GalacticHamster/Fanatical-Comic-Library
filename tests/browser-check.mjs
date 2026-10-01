// Optional real-DOM checks using an isolated Chrome profile and mock storage/API.
// No signed-in session or remote Fanatical requests are used.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'Fanatical-ui-check-'));
const products = ['Comic #10', 'Comic #2', 'External comic', 'New comic'].map((name, index) => ({ _id: `product-12345${index}`, name, slug: `comic-${index}`, type: 'book', regionAvailable: true }));
const bundle = { _id: 'bundle-123456', name: 'Test comics', slug: 'test-comics', bundles: [{ price: { USD: 100 }, games: products }] };
const mock = `
globalThis.addEventListener('error', event => {fetch('/result?route='+encodeURIComponent(location.pathname),{method:'POST',body:JSON.stringify({ok:false,error:event.message})})});
const listeners = [];
globalThis.values = { fanaticalLibraryItems: [{source:'fanatical',sourceItemId:'product-123450',title:'Comic #10',mediaType:'book',bundle:{sourceItemId:'bundle-123456',title:'Test comics',slug:'test-comics'},purchaseDate:null}],galacticLibraryExtensionId:'b'.repeat(32),fanaticalScannedOrderFingerprints:['a'.repeat(64)] };
globalThis.requests = [];
globalThis.chrome = {runtime:{id:'a'.repeat(32),sendMessage:async(first,second)=>{
  const message=second||first; requests.push(message);
  if(message.type==='PING')return {ok:true,apiVersion:1,appVersion:'0.1.0'};
  if(message.type==='MATCH_ITEMS')return {ok:true,apiVersion:1,results:message.items.map(item=>({requestId:item.requestId,matches:item.title==='External comic'?[{provider:'humble',ownership:'owned'}]:[]}))};
  if(message.type==='FANATICAL_GET_PUBLIC_BUNDLE')return {ok:true,bundle:message.path.includes('pick-and-mix')?${JSON.stringify({ ...bundle, products, tiers: [{ quantity: 2, price: { USD: 100 } }] })}:${JSON.stringify(bundle)}};
}},storage:{local:{get:async defaults=>({...defaults,...values}),set:async changes=>{Object.assign(values,changes); const events={};for(const key in changes)events[key]={newValue:changes[key]};listeners.forEach(listener=>listener(events,'local'));},remove:async key=>{delete values[key];listeners.forEach(listener=>listener({[key]:{newValue:undefined}},'local'));}},onChanged:{addListener:listener=>listeners.push(listener)}},tabs:{create(){}}};
globalThis.confirmAnswer = true;
globalThis.confirm = () => confirmAnswer;
globalThis.exportedBlob = null;
const createObjectURL = URL.createObjectURL.bind(URL);
URL.createObjectURL = blob => { exportedBlob=blob; return createObjectURL(blob); };
HTMLAnchorElement.prototype.click = function() {};
`;
const common = `
const wait=()=>new Promise(resolve=>setTimeout(resolve,350));
const assert=(condition,message)=>{if(!condition)throw new Error(message)};
const diagnostics=()=>document.querySelector('[data-fanatical-library-diagnostics]');
const finish=result=>{const node=document.createElement('pre');node.id='browser-check-result';node.textContent=JSON.stringify(result);document.body.append(node);fetch('/result?route='+encodeURIComponent(location.pathname),{method:'POST',body:JSON.stringify(result)})};
`;
const bundleChecks = `${common}
try {
  await wait();
  assert(!diagnostics(),'Diagnostics should default off');
  assert(document.querySelectorAll('[data-fanatical-library-for]').length===4,'Missing card badges');
  assert([...document.querySelectorAll('.card-product-name')].map(node=>node.textContent).join('|')==='Comic #2|Comic #10|External comic|New comic','Natural sorting changed');
  assert(document.querySelector('.fanatical-library-owned-elsewhere-badge'),'Missing external match');
  await chrome.storage.local.set({fanaticalShowDiagnostics:true});await wait();
  assert(diagnostics()?.textContent.includes('4 products parsed; 4 distinct cards found'),'Missing bundle counts');
  assert(diagnostics().textContent.includes('exact Galactic Library match'),'Missing external match reason');
  diagnostics().open=true;
  const count=requests.length;
  document.querySelector('article').append(document.createElement('span'));await wait();
  assert(requests.length===count,'Unrelated DOM change restarted comparison');
  assert(diagnostics().open,'Diagnostics collapsed unexpectedly');
  const filter=document.querySelector('.fanatical-library-bundle-filter input');
  const visibleCards=()=>[...document.querySelectorAll('article')].filter(card=>card.getBoundingClientRect().height>0);
  filter.click();await wait();assert(visibleCards().length===2,'Owned cards not hidden');
  filter.click();await wait();assert(visibleCards().length===4,'Owned cards not restored');
  assert(document.querySelectorAll('[data-fanatical-library-for]').length===4,'Badges changed after filter toggles');
  await chrome.storage.local.remove('galacticLibraryExtensionId');await wait();
  assert(!document.querySelector('.fanatical-library-owned-elsewhere-badge'),'Removing Galactic link retained external ownership');
  assert(document.querySelectorAll('.fanatical-library-new-badge').length===3,'External card did not return to local matching');
  await chrome.storage.local.set({fanaticalShowDiagnostics:false});await wait();
  assert(!diagnostics(),'Diagnostics did not turn off');
  finish({ok:true,scenario:'bundle diagnostics, filtering, Galactic removal'});
}catch(error){finish({ok:false,error:error.message})}
`;
const optionsChecks = `${common}
try {
  await wait();
  const $=selector=>document.querySelector(selector);
  assert($('#library-preview li').textContent.includes('Comic #10'),'Options preview missing');
  assert($('#fanatical-extension-id').textContent==='a'.repeat(32),'Own extension ID missing');
  $('#test-galactic').click();await wait();
  assert($('#galactic-status').textContent.includes('Connected'),'Galactic PING failed');
  $('#show-diagnostics').click();await wait();assert(values.fanaticalShowDiagnostics===true,'Diagnostics setting not saved');
  $('#export').click();await wait();
  const backup=JSON.parse(await exportedBlob.text());assert(backup.items.length===1&&!backup.orderFingerprints,'Export leaked skip history');
  const upload=async text=>{const transfer=new DataTransfer();transfer.items.add(new File([text],'backup.json',{type:'application/json'}));$('#import-file').files=transfer.files;$('#import-file').dispatchEvent(new Event('change'));for(let attempt=0;attempt<8;attempt++){await wait();if(!$('#import-file').disabled)return;}throw new Error('File import did not finish')};
  await upload('invalid JSON');assert(values.fanaticalLibraryItems.length===1,'Invalid JSON changed library');
  confirmAnswer=false;await upload(JSON.stringify({schemaVersion:1,items:[]}));assert(values.fanaticalLibraryItems.length===1,'Cancelled restore changed library');
  confirmAnswer=true;backup.items[0].title='Restored comic';await upload(JSON.stringify(backup));
  assert(values.fanaticalLibraryItems[0].title==='Restored comic','Backup did not restore: '+$('#import-status').textContent);
  assert(values.fanaticalScannedOrderFingerprints.length===0&&values.fanaticalImportSummary===null,'Backup retained scan authority');
  assert($('#library-preview li').textContent.includes('Restored comic'),'Preview did not refresh');
  assert(values.fanaticalShowDiagnostics&&values.galacticLibraryExtensionId,'Restore removed settings');
  $('#remove-galactic').click();await wait();assert(!values.galacticLibraryExtensionId&&!$('#galactic-id').value,'Galactic removal failed');
  finish({ok:true,scenario:'options preview, export/restore, Galactic controls, diagnostics setting'});
}catch(error){finish({ok:false,error:error.message})}
`;
const catalogueChecks = `${common}
try {
  await wait();assert(!diagnostics(),'Catalogue diagnostics should default off');
  await chrome.storage.local.set({fanaticalShowDiagnostics:true});await wait();
  assert(diagnostics()?.textContent.includes('3 offer cards detected'),'Missing catalogue counts');
  assert(diagnostics().textContent.includes('unknown expiry: 1'),'Missing unknown expiry count');
  const input=document.querySelector('[data-catalogue-filter="endingSoon"]');input.click();await wait();
  assert(diagnostics().textContent.includes('Filtered cards: 2'),'Wrong diagnostic filter count');
  const slots=[...document.querySelectorAll('.HitCardContainer')];assert(slots.filter(slot=>getComputedStyle(slot).display!=='none').length===1,'Seven-day filter changed');
  input.click();await wait();assert(slots.every(slot=>getComputedStyle(slot).display!=='none'),'Catalogue cards not restored');
  await chrome.storage.local.set({fanaticalShowDiagnostics:false});await wait();assert(!diagnostics(),'Catalogue diagnostics did not turn off');
  assert(!requests.some(message=>message.type==='FANATICAL_GET_PUBLIC_BUNDLE'),'Category requested bundle API');
  finish({ok:true,scenario:'catalogue diagnostics, expiry readings, filter restore'});
}catch(error){finish({ok:false,error:error.message})}
`;
const cards = (kind) => products.map(product => `<div class="three-column-row"><article class="${kind}"><div class="cover-container"><img alt="${product.name}"><h2 class="card-product-name">${product.name}</h2></div></article></div>`).join('');
const catalogue = [2, 10, null].map((days, index) => `<li class="HitCardContainer"><article class="HitCard"><a href="https://www.fanatical.com/en/bundle/test-${index}"><img alt="Test ${index}"><h2>Test ${index}</h2></a>${days === null ? '' : `<div class="CountdownTimer__clock">${days} Days Left</div>`}</article></li>`).join('');
const pendingResults = new Map();
const server = http.createServer((request, response) => {
  const url = request.url.split('?')[0];
  if (url === '/result' && request.method === 'POST') {
    const route = new URL(request.url, 'http://localhost').searchParams.get('route');
    let body = ''; request.on('data', chunk => { body += chunk; });
    request.on('end', () => { response.writeHead(204).end(); pendingResults.get(route)?.(JSON.parse(body)); }); return;
  }
  const send = (type, contents) => { response.writeHead(200, { 'content-type': `${type}; charset=utf-8` }); response.end(contents); };
  if (url === '/mock.js') return send('text/javascript', mock);
  if (url === '/options-check.js') return send('text/javascript', optionsChecks);
  if (url === '/bundle-check.js') return send('text/javascript', bundleChecks);
  if (url === '/catalogue-check.js') return send('text/javascript', catalogueChecks);
  if (url.startsWith('/src/') && /^\/src\/[a-z-]+\.(?:js|mjs|css)$/u.test(url)) {
    return send(url.endsWith('.css') ? 'text/css' : 'text/javascript', fs.readFileSync(path.join(root, url.slice(1)), 'utf8'));
  }
  if (url === '/options') {
    const html = fs.readFileSync(path.join(root, 'src/options.html'), 'utf8').replace('<head>', '<head><base href="/src/">').replace('<script src="shared.js">', '<script src="/mock.js"></script><script src="shared.js">').replace('</body>', '<script type="module" src="/options-check.js"></script></body>');
    return send('text/html', html);
  }
  if (url === '/en/bundle/test-comics' || url === '/en/bundle/books' || url === '/en/pick-and-mix/test-mix') {
    const isCatalogue = url.endsWith('/books');
    return send('text/html', `<!doctype html><html><head><link rel="stylesheet" href="/src/content.css"><style>.fan-grid-container{display:grid;grid-template-columns:repeat(3,240px);gap:20px}.fanatical-library-pick-mix-reflow{grid-column:1/-1}article{min-height:160px}.cover-container{min-height:120px}</style></head><body><main>${isCatalogue ? `<ul class="HitCardsRow row">${catalogue}</ul>` : `<section class="tier"><div class="fan-grid-container">${cards(url.includes('pick-and-mix') ? 'PickAndMixCard' : 'bundle-product-card')}</div></section>`}</main><script src="/mock.js"></script><script src="/src/shared.js"></script><script src="/src/content.js"></script><script type="module" src="/${isCatalogue ? 'catalogue' : 'bundle'}-check.js"></script></body></html>`);
  }
  response.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  for (const [index, route] of ['/options', '/en/bundle/test-comics', '/en/pick-and-mix/test-mix', '/en/bundle/books'].entries()) {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(chromePath, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${path.join(profileRoot, String(index))}`, `http://127.0.0.1:${server.address().port}${route}`], { windowsHide: true });
      child.stdout.resume(); child.stderr.resume();
      const timeout = setTimeout(() => { pendingResults.delete(route); child.kill(); reject(new Error(`Browser check timed out: ${route}`)); }, 25000);
      pendingResults.set(route, result => { clearTimeout(timeout); pendingResults.delete(route); child.kill(); resolve(result); });
      child.on('error', error => { clearTimeout(timeout); pendingResults.delete(route); reject(error); });
    });
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  }
} finally { server.close(); }
