// Optional real-DOM checks using an isolated Chrome profile and mock storage/API.
// No signed-in session or remote Fanatical requests are used.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
import {createRelease} from '../scripts/release.mjs';
const packaged=process.argv.includes('--release')?await createRelease():null;
const readRuntime=name=>packaged?packaged.files.get(name)?.toString('utf8')??(()=>{throw Error('Absent runtime '+name);})():fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');

const root = fileURLToPath(new URL('../', import.meta.url));
const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'Fanatical-ui-check-'));
const products = ['Comic #10', 'Comic #2', 'External comic', 'New comic'].map((name, index) => ({ _id: `product-12345${index}`, name, slug: `comic-${index}`, type: 'book', regionAvailable: true }));
const bundle = { _id: 'bundle-123456', name: 'Test comics', slug: 'test-comics', bundles: [{ price: { USD: 100 }, games: [products[1], products[3]] }, { price: { USD: 1000 }, games: [products[0], products[2]] }] };
const editionBase = { source: 'fanatical', sourceItemId: 'edition-base-123456', title: 'Space Adventure', mediaType: 'game', externalIds: { steamAppId: '42' }, bundle: { sourceItemId: 'purchased-123456', title: 'Purchased games' } };
const editionBonus = { _id: 'edition-bonus-123456', name: 'Space Adventure Bonus Content', type: 'game', steam: { id: 42 } };
const editionProducts = [
  { _id: 'edition-deluxe-123456', name: 'Space Adventure Deluxe Edition', type: 'game', steam: { id: 42 } },
  { _id: 'edition-ultimate-123456', name: 'Space Adventure Ultimate Edition', type: 'game', steam: { id: 42 }, componentsComplete: true, components: [{ _id: editionBase.sourceItemId, name: editionBase.title, type: 'game', steam: { id: 42 } }, editionBonus] }
];
const editionBundle = { _id: 'edition-bundle-123456', name: 'Test editions', slug: 'test-editions', bundles: [{ price: { USD: 100 }, games: editionProducts }], products: editionProducts, tiers: [{ quantity: 2, price: { USD: 100 } }] };
const contentsUnit = number => ({ series: 'Saga', run: '2020', language: 'en', unitType: 'issue', number: String(number), completeness: 'full' });
const contentsProducts = [[1, 2, 3], [2, 3, 4], [6], [8]].map((numbers, index) => ({ _id: `contents-product-${index}`, name: numbers.length === 1 ? `Saga #${numbers[0]}` : `Saga Collection ${index + 1}`, type: 'book', run: '2020', language: 'en', contents: numbers.map(contentsUnit), contentsComplete: true }));
const contentsBundle = { _id: 'contents-bundle-123456', name: 'Saga bundle', bundles: [{ price: { USD: 100 }, games: contentsProducts.slice(0, 1) }, { price: { USD: 1000 }, games: contentsProducts.slice(1) }], products: contentsProducts, tiers: [{ quantity: 2, price: { USD: 100 } }] };
const mock = `
globalThis.addEventListener('error', event => {fetch('/result?route='+encodeURIComponent(location.pathname),{method:'POST',body:JSON.stringify({ok:false,error:event.message})})});
const listeners = [];
globalThis.values = { fanaticalLibraryItems: [{source:'fanatical',sourceItemId:'product-123450',title:'Comic #10',mediaType:'book',bundle:{sourceItemId:'bundle-123456',title:'Test comics',slug:'test-comics'},purchaseDate:null}],galacticLibraryExtensionId:'b'.repeat(32),fanaticalScannedOrderFingerprints:['a'.repeat(64)] };
if(location.pathname.includes('test-editions')) values.fanaticalLibraryItems=[${JSON.stringify(editionBase)}];
if(location.pathname.includes('test-contents')) values.fanaticalLibraryItems=[{source:'fanatical',sourceItemId:'owned-issue-123456',title:'Saga #1',mediaType:'book',run:'2020',language:'en'}];
if(location.pathname==='/options') values.fanaticalLastScanAttempt={status:'incomplete'};
globalThis.scanFailure = false;
globalThis.centralMode = 'normal';
globalThis.requests = [];
globalThis.chrome = {runtime:{id:'a'.repeat(32),sendMessage:async(first,second)=>{
  const message=second||first; requests.push(message);
  if(message.type==='FANATICAL_STORE'){
    const {createSyncStore}=await import('/src/library-data.mjs');
    globalThis.fixtureStore??=createSyncStore(chrome.storage.local);
    try{return {ok:true,result:await fixtureStore.execute(message.operation,message.args)};}catch(error){return {ok:false,error:error.message};}
  }
  if(message.type==='GET_STATUS')return {ok:true,apiVersion:1,ready:true,capabilities:{mediaTypes:['game','book','audiobook','software'],reviewedContents:true,entitlementReminders:true}};
  if(message.type==='GET_REMINDERS')return {ok:true,apiVersion:1,total:51,nextOffset:message.offset===0?50:null,reminders:Array.from({length:51},(_,n)=>({reminderRef:'opaque-reminder-'+n,itemRef:'opaque-item-'+n,title:'Reminder '+n,provider:'fanatical',mediaType:'game',kind:n===50?'key-expiry':'activation',dueAt:n===50?'2026-10-10T12:00:00Z':null,severity:n===50?'due-soon':'information'})).slice(message.offset,message.offset+message.limit)};
  if(message.type==='PING')return {ok:true,apiVersion:1,appVersion:'0.1.0'};
  if(message.type==='FANATICAL_IMPORT_PURCHASES'){
    await new Promise(resolve=>setTimeout(resolve,100));
    return scanFailure?{ok:false,error:'Scan incomplete; previous purchases and successful scan history were kept.'}:{ok:true,summary:{ordersScanned:1,ordersSkipped:0,addedProducts:1,ownedLeafProducts:1,historyCoverage:'No pagination metadata: silent server truncation cannot be independently ruled out.'}};
  }
  if(message.type==='MATCH_ITEMS'&&centralMode==='fanatical')return {ok:true,apiVersion:1,results:message.items.map(item=>({requestId:item.requestId,matches:item.title==='External comic'?[{provider:'fanatical',title:item.title,ownership:'owned',relationship:'same-edition'}]:[]}))};
  if(message.type==='MATCH_ITEMS'&&centralMode==='reject')return {ok:false,apiVersion:1};
  if(message.type==='MATCH_ITEMS'&&centralMode==='legacy')return {ok:true,apiVersion:1,results:message.items.map(item=>({requestId:item.requestId,matches:[]}))};
  if(message.type==='MATCH_ITEMS'&&location.pathname.includes('test-contents'))return {ok:true,apiVersion:1,results:message.items.map(item=>{
    const evidence={provider:'kindle',title:'Saga Complete Collection',ownership:'owned',relationship:'contains',itemRef:'opaque-saga',reason:'Reviewed full issues',confidence:1,evidence:{source:'Reviewed publisher contents',checkedAt:'2026-08-01'},verifiedAt:'2026-08-01'};
    const entries=item.contents||[];const covered=entries.filter(entry=>['2','5'].includes(entry.number)).map(entry=>({...entry,evidence:[evidence]}));
    const uncertain={provider:'kindle',title:'Saga #8',ownership:'unknown',relationship:'same-work',itemRef:'opaque-uncertain',reason:'Title candidate; ownership needs confirmation',evidence:{source:'Kindle import',checkedAt:null}};
    return {requestId:item.requestId,matches:[],possibleMatches:item.title==='Saga #8'?[uncertain]:[],partialMatches:covered.length?[evidence]:[],coverage:entries.length?{total:entries.length,owned:covered.length,complete:covered.length===entries.length,scopeUncertain:false,covered,possibleCovered:[],missing:entries.filter(entry=>!['2','5'].includes(entry.number))}:null};
  })};
  if(message.type==='MATCH_ITEMS')return {ok:true,apiVersion:1,results:message.items.map(item=>({requestId:item.requestId,matches:item.title==='External comic'?[{provider:'humble',title:'External comic',ownership:'owned',relationship:'same-edition',evidence:{source:'Reviewed same-edition relationship',checkedAt:null}}]:[]}))};
  if(message.type==='FANATICAL_GET_PUBLIC_BUNDLE')return {ok:true,bundle:message.path.includes('test-contents')?(message.path.includes('pick-and-mix')?${JSON.stringify(contentsBundle)}:${JSON.stringify({ ...contentsBundle, products: undefined, tiers: undefined })}):message.path.includes('test-editions')?${JSON.stringify(editionBundle)}:message.path.includes('pick-and-mix')?${JSON.stringify({ ...bundle, products, tiers: [{ quantity: 2, price: { USD: 100 } }] })}:${JSON.stringify(bundle)}};
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
  const badge=document.querySelector('.fanatical-library-owned-elsewhere-badge');
  assert(badge.tagName==='BUTTON','Badge is not keyboard accessible');badge.click();
  const inspector=document.querySelector('#fanatical-library-evidence');
  assert(inspector?.open&&inspector.textContent.includes('Offered: External comic'),'Evidence inspector did not open');
  assert(inspector.textContent.includes('unknown'),'Unknown freshness was not disclosed');
  inspector.querySelector('button').click();await wait();assert(!document.querySelector('#fanatical-library-evidence'),'Evidence inspector did not close');
  assert(document.activeElement===badge,'Closing inspector did not restore focus');
  const minimize=document.querySelector('.fanatical-library-summary-minimize');minimize.click();
  assert(document.querySelector('.fanatical-library-summary-minimized'),'Summary did not minimize');
  document.querySelector('.fanatical-library-summary-expand').click();
  assert(!document.querySelector('.fanatical-library-summary-minimized'),'Summary did not expand');
  if(!location.pathname.includes('pick-and-mix')) assert(document.querySelector('.fanatical-library-buy-recommendation')?.textContent.endsWith('$1.00'),'Higher owned-only tier replaced the cheapest complete-new tier');
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
  if(!location.pathname.includes('pick-and-mix')) assert(document.querySelector('.fanatical-library-buy-recommendation')?.textContent.endsWith('$10.00'),'Recommendation did not increase when the higher tier gained a confirmed-new item');
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
  assert($('#history-note').textContent.includes('Last scan incomplete'),'Incomplete coverage warning missing');
  assert($('#fanatical-extension-id').textContent==='a'.repeat(32),'Own extension ID missing');
  $('#test-galactic').click();await wait();
  assert($('#galactic-status').textContent.includes('Connected')&&$('#galactic-status').textContent.includes('reviewed contents supported')&&$('#galactic-status').textContent.includes('software'),'Galactic capability test failed');
  $('#load-reminders').click();await wait();assert($('#reminder-list').children.length===50&&$('#reminder-list').textContent.includes('deadline not reported'),'First reminder page or unknown deadline missing');$('#reminder-next').click();await wait();assert($('#reminder-list').children.length===1&&$('#reminder-list').textContent.includes('2026-10-10'),'Reported expiry or second page missing');$('#reminder-previous').click();await wait();assert($('#reminder-list').children.length===50,'Previous reminder page missing');
  $('#show-diagnostics').click();await wait();assert(values.fanaticalShowDiagnostics===true,'Diagnostics setting not saved');
  $('#wishlist-title').value='Manual wish';$('#wishlist-media').value='book';$('#wishlist-weight').value='7';$('#add-wish').click();await wait();assert(values.fanaticalWishlistItems?.[0].weight===7,'Manual wish was not saved');
  $('#export').click();await wait();
  const backup=JSON.parse(await exportedBlob.text());assert(backup.items.length===1&&!backup.orderFingerprints&&backup.schemaVersion===3&&backup.wishlistItems[0].weight===7,'Backup omitted wishlist or leaked scan authority');
  const upload=async text=>{const transfer=new DataTransfer();transfer.items.add(new File([text],'backup.json',{type:'application/json'}));$('#import-file').files=transfer.files;$('#import-file').dispatchEvent(new Event('change'));for(let attempt=0;attempt<8;attempt++){await wait();if(!$('#import-file').disabled)return;}throw new Error('File import did not finish')};
  $('#export-catalog').click();await wait();const catalog=JSON.parse(await exportedBlob.text());assert(catalog.format==='fanatical-title-catalog'&&!catalog.items[0].bundle&&!catalog.items[0].purchaseDate,'Catalog retained purchase evidence');await upload(JSON.stringify(catalog));assert(values.fanaticalLibraryItems.length===1&&$('#import-status').textContent.includes('failed'),'Catalog was accepted as ownership backup');
  await upload('invalid JSON');assert(values.fanaticalLibraryItems.length===1,'Invalid JSON changed library');
  confirmAnswer=false;await upload(JSON.stringify({schemaVersion:1,items:[]}));assert(values.fanaticalLibraryItems.length===1,'Cancelled restore changed library');
  confirmAnswer=true;backup.items[0].title='Restored comic';await upload(JSON.stringify(backup));
  assert(values.fanaticalLibraryItems[0].title==='Restored comic','Backup did not restore: '+$('#import-status').textContent);
  assert(values.fanaticalScannedOrderFingerprints.length===0&&values.fanaticalImportSummary===null,'Backup retained scan authority');
  assert(values.fanaticalLastScanAttempt===null&&!$('#history-note').textContent.includes('incomplete'),'Restore retained stale failed-scan warning');
  assert($('#library-preview li').textContent.includes('Restored comic'),'Preview did not refresh');
  assert(values.fanaticalShowDiagnostics&&values.galacticLibraryExtensionId,'Restore removed settings');
  $('#remove-galactic').click();await wait();assert(!values.galacticLibraryExtensionId&&!$('#galactic-id').value,'Galactic removal failed');assert(!$('#reminder-list').children.length,'Unlink retained central reminders');
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
const editionChecks = `${common}
try {
  await wait();
  assert(document.querySelectorAll('.fanatical-library-possible-badge').length===1,'Deluxe package was not Possible');
  assert(document.querySelector('.fanatical-library-partial-badge')?.textContent==='Partial (1/2)','Ultimate package was not verified Partial');
  const notes=[...document.querySelectorAll('.fanatical-library-card-edition-note')];
  assert(notes.length===2&&notes.every(note=>note.textContent.includes('owned: Space Adventure')),'Owned title missing from card captions');
  assert(notes.some(note=>note.textContent.includes('Different edition/package'))&&notes.some(note=>note.textContent.includes('Partial package (1/2 components)')),'Package differences missing from captions');
  const rows=[...document.querySelectorAll('.fanatical-library-title-list li')];
  assert(rows.length===2&&rows.every(row=>row.textContent.includes('owned "Space Adventure"')),'Review summary did not show owned title');
  assert(!document.querySelector('.fanatical-library-buy-recommendation'),'Review-only items counted as confirmed-new');
  const filter=document.querySelector('.fanatical-library-bundle-filter input');filter.click();await wait();
  assert([...document.querySelectorAll('article')].every(card=>card.getBoundingClientRect().height>0),'Possible/Partial packages were hidden');
  filter.click();await wait();
  await chrome.storage.local.set({fanaticalLibraryItems:[${JSON.stringify(editionBase)}, {source:'fanatical',sourceItemId:'edition-bonus-123456',title:'Space Adventure Bonus Content',mediaType:'game'}, {source:'fanatical',sourceItemId:'edition-deluxe-123456',title:'Space Adventure Deluxe Edition',mediaType:'game'}]});await wait();
  assert(document.querySelectorAll('.fanatical-library-owned-badge').length===2,'Verified complete ownership did not replace review badges');
  assert(document.querySelectorAll('.fanatical-library-card-edition-note').length===0,'Stale edition warnings remained after ownership changed');
  finish({ok:true,scenario:'edition/package identity, component coverage and visible review details',route:location.pathname});
}catch(error){finish({ok:false,error:error.message})}
`;
const orderChecks = `${common}
try {
  await wait();
  const panel=document.querySelector('#fanatical-library-importer');
  assert(panel,'Orders importer missing');
  const quick=panel.querySelector('[data-import-mode="new"]');const full=panel.querySelector('[data-import-mode="all"]');const status=panel.querySelector('output');
  quick.click();await new Promise(resolve=>setTimeout(resolve,20));
  assert(quick.disabled&&full.disabled,'Scan controls were not disabled while fetching');
  await wait();assert(status.textContent.includes('Quick scan checked 1 new order'),'Quick scan result missing');
  assert(status.textContent.includes('silent server truncation'),'Unknown coverage was not exposed');
  assert(!quick.disabled&&!full.disabled,'Scan controls did not recover');
  scanFailure=true;full.click();await wait();
  assert(status.textContent.includes('Scan incomplete')&&status.textContent.includes('previous purchases'),'Failed coverage warning missing');
  assert(!quick.disabled&&!full.disabled,'Failed scan left controls disabled');
  scanFailure=false;full.click();await wait();
  assert(status.textContent.includes('Full scan checked 1 order'),'Successful rescan did not replace error');
  finish({ok:true,scenario:'Orders importer coverage, failed scan and control recovery'});
}catch(error){finish({ok:false,error:error.message})}
`;
const contentsChecks = `${common}
try {
  await wait();
  const content=()=>document.querySelector('.fanatical-library-contents');
  assert(content()?.textContent.includes('4 additional · 2 covered · 0 uncertain'),'Distinct bundle unit counts are wrong');
  assert(document.querySelectorAll('.fanatical-library-partial-badge').length===2,'Central and local union coverage did not resolve Partial');
  const sent=requests.filter(message=>message.type==='MATCH_ITEMS').flatMap(message=>message.items);
  assert(sent.some(item=>item.title==='Saga Collection 1'&&item.contents.length===3&&item.excludeProviders.includes('fanatical')),'Live parser did not send explicit contents');
  if(location.pathname.includes('pick-and-mix')) {
    assert(content().textContent.includes('Selected items: 0 distinct additional units'),'Pool counted as selection');
    const card=[...document.querySelectorAll('article')].find(card=>card.textContent.includes('Saga Collection 1'));card.classList.add('selected');card.click();await wait();
    assert(content().textContent.includes('Selected items: 1 distinct additional units'),'Selection did not update additional-unit counts');
  } else assert(content().textContent.includes('$1.00 tier: 1 distinct additional units')&&content().textContent.includes('$10.00 tier: 4 distinct additional units'),'Cumulative tier unit counts are wrong');
  const planning=()=>document.querySelector('.fanatical-library-planning');planning().open=true;await wait();planning().querySelector('details').open=true;
  const wishRow=planning().querySelector('li[data-product-id="contents-product-2"]');wishRow.querySelector('input').value='5';[...wishRow.querySelectorAll('button')].find(button=>button.textContent==='Add wish').click();await wait();
  assert(values.fanaticalWishlistItems?.length===1&&values.fanaticalWishlistItems[0].weight===5,'Bundle wishlist did not persist');
  const goal=planning().querySelector('[aria-label="Purchase planning goal"]');goal.value='wishlist';goal.dispatchEvent(new Event('change'));assert(planning().textContent.includes('5 wishlist points'),'Wishlist weights did not affect plan value');
  if(location.pathname.includes('pick-and-mix')){assert(planning().querySelector('.fanatical-library-plan-result').textContent.includes('No priced tier'),'Uncertain fillers entered Pick and Mix implicitly');planning().querySelector('label input[type="checkbox"]').click();assert(planning().querySelector('.fanatical-library-plan-result').textContent.includes('$1.00'),'Explicit uncertainty did not produce an available complete Pick and Mix selection');}else assert(planning().querySelector('.fanatical-library-plan-result').textContent.includes('$10.00'),'Wishlist goal did not choose the cheapest containing tier');
  assert(document.querySelectorAll('.fanatical-library-partial-badge').length===2,'Planning changed ownership badges');
  document.querySelector('.fanatical-library-partial-badge').click();
  const inspector=document.querySelector('#fanatical-library-evidence');
  assert(inspector?.textContent.includes('Reviewed publisher contents')&&inspector.textContent.includes('2026-08-01'),'Central contents evidence/freshness missing from inspector');
  inspector.querySelector('button').click();await wait();
  const reading=()=>document.querySelector('.fanatical-library-reading');
  assert(reading()?.textContent.includes('issue 5: Covered · not offered here'),'Central ownership of an intervening issue was missed');
  assert(reading().textContent.includes('issue 7: Not confirmed covered · not offered here'),'Reading gap outside the offer was not surfaced');
  const reminders=()=>document.querySelector('.fanatical-library-reminders');
  assert(reminders()?.textContent.includes('unknown ownership')&&reminders().textContent.includes('Observation date unavailable'),'Central ownership/freshness reminders missing');
  centralMode='legacy';reminders().querySelector('button').click();await wait();
  assert(content()?.textContent.includes('0 additional'),'Legacy title lookup falsely established unit absence');
  assert(reading().textContent.includes('issue 7: Not checked'),'Missing central contents capability falsely established a reading gap');
  centralMode='reject';reminders().querySelector('button').click();await wait();
  assert(document.querySelectorAll('.fanatical-library-unchecked-badge').length===3,'Failed lookups were presented as New');
  assert(!document.querySelector('.fanatical-library-buy-recommendation'),'Failed lookups produced a buy recommendation');
  centralMode='normal';reminders().querySelector('button').click();await wait();
  assert(content().textContent.includes('4 additional · 2 covered · 0 uncertain'),'Successful retry did not restore central coverage');
  finish({ok:true,scenario:'central contents union, distinct unit value, tier/selection counts',route:location.pathname});
}catch(error){finish({ok:false,error:error.message})}
`;
const cards = (kind, items = products) => items.map(product => `<div class="three-column-row"><article class="${kind}"><div class="cover-container"><img alt="${product.name}"><h2 class="card-product-name">${product.name}</h2></div></article></div>`).join('');
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
  if (url === '/edition-check.js') return send('text/javascript', editionChecks);
  if (url === '/order-check.js') return send('text/javascript', orderChecks);
  if (url === '/contents-check.js') return send('text/javascript', contentsChecks);
  if (url.startsWith('/src/') && /^\/src\/[a-z-]+\.(?:js|mjs|css)$/u.test(url)) {
    return send(url.endsWith('.css') ? 'text/css' : 'text/javascript', readRuntime(url.slice(1)));
  }
  if (url === '/options') {
    const html = readRuntime('src/options.html').replace('<head>', '<head><base href="/src/">').replace('<script src="shared.js">', '<script src="/mock.js"></script><script src="shared.js">').replace('</body>', '<script type="module" src="/options-check.js"></script></body>');
    return send('text/html', html);
  }
  if (url === '/en/orders') return send('text/html', '<!doctype html><html><head><link rel="stylesheet" href="/src/content.css"></head><body><main>Mock orders</main><script src="/mock.js"></script><script src="/src/shared.js"></script><script src="/src/planning.js"></script><script src="/src/planning-ui.js"></script><script src="/src/content.js"></script><script type="module" src="/order-check.js"></script></body></html>');
  if (url === '/en/bundle/test-comics' || url === '/en/bundle/books' || url === '/en/pick-and-mix/test-mix' || url.endsWith('/test-editions') || url.endsWith('/test-contents')) {
    const isCatalogue = url.endsWith('/books');
    const isEdition = url.endsWith('/test-editions');
    const isContents = url.endsWith('/test-contents');
    return send('text/html', `<!doctype html><html><head><link rel="stylesheet" href="/src/content.css"><style>.fan-grid-container{display:grid;grid-template-columns:repeat(3,240px);gap:20px}.fanatical-library-pick-mix-reflow{grid-column:1/-1}article{min-height:160px}.cover-container{min-height:120px}</style></head><body><main>${isCatalogue ? `<ul class="HitCardsRow row">${catalogue}</ul>` : `<section class="tier"><div class="fan-grid-container">${cards(url.includes('pick-and-mix') ? 'PickAndMixCard' : 'bundle-product-card', isContents ? contentsProducts : isEdition ? editionProducts : products)}</div></section>`}</main><script src="/mock.js"></script><script src="/src/shared.js"></script><script src="/src/planning.js"></script><script src="/src/planning-ui.js"></script><script src="/src/content.js"></script><script type="module" src="/${isCatalogue ? 'catalogue' : isContents ? 'contents' : isEdition ? 'edition' : 'bundle'}-check.js"></script></body></html>`);
  }
  response.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const allRoutes = ['/options', '/en/bundle/test-comics', '/en/pick-and-mix/test-mix', '/en/bundle/books', '/en/bundle/test-editions', '/en/pick-and-mix/test-editions', '/en/orders', '/en/bundle/test-contents', '/en/pick-and-mix/test-contents'];
  const selectedRoutes=process.argv.slice(2).filter(arg=>arg!=='--release');const routes=selectedRoutes.length?selectedRoutes:allRoutes;
  if (routes.some(route => !allRoutes.includes(route))) throw new Error('Unknown browser fixture route');
  for (const [index, route] of routes.entries()) {
    let stopped=Promise.resolve();
    const result = await new Promise((resolve, reject) => {
      const child = spawn(chromePath, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${path.join(profileRoot, String(index))}`, `http://127.0.0.1:${server.address().port}${route}`], { windowsHide: true });
      stopped=new Promise(resolve=>child.once('exit',resolve));
      child.stdout.resume(); child.stderr.resume();
      const timeout = setTimeout(() => { pendingResults.delete(route); child.kill(); reject(new Error(`Browser check timed out: ${route}`)); }, 25000);
      pendingResults.set(route, result => { clearTimeout(timeout); pendingResults.delete(route); child.kill(); resolve(result); });
      child.on('error', error => { clearTimeout(timeout); pendingResults.delete(route); reject(error); });
    });
    await Promise.race([stopped,pause(3000)]);
    console.log(JSON.stringify({...result,packaged:Boolean(packaged)}));
    if (!result.ok) process.exitCode = 1;
  }
} finally { await new Promise(resolve=>server.close(resolve));const target=path.resolve(profileRoot),base=path.resolve(os.tmpdir());if(!target.startsWith(base+path.sep)||!target.slice(base.length+1).startsWith('Fanatical-ui-check-'))throw Error('Unsafe browser cleanup.');fs.rmSync(target,{recursive:true,force:true,maxRetries:5,retryDelay:200}); }
