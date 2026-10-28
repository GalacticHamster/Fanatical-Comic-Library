// Optional real-DOM checks using an isolated Chrome profile and mock storage/API.
// No signed-in session or remote Fanatical requests are used.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn,execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
import {createRelease} from '../scripts/release.mjs';
const firefox=process.argv.includes('--firefox');
const slowCentral=process.argv.includes('--slow-central');
const themeMode=process.argv.includes('--theme'),themeWidth=process.argv.includes('--tiny')?420:process.argv.includes('--narrow')?560:1200;
const lifecycle=process.argv.includes('--lifecycle');
const hydration=process.argv.includes('--hydration');
const navigation=process.argv.includes('--navigation');
const glPack=navigation?await(await import('../../GalacticLibrary/scripts/release.mjs')).createRelease(undefined,undefined,firefox?'firefox':'chrome'):null;
const packaged=process.argv.includes('--release')?await createRelease(undefined,undefined,firefox?'firefox':'chrome'):null;
const readRuntime=name=>process.env.FAN_TEST_CONTENT_REF&&name==='src/content.js'
  ?execFileSync('git',['show',process.env.FAN_TEST_CONTENT_REF+':'+name],{cwd:root,windowsHide:true,encoding:'utf8',maxBuffer:4*1024*1024})
  :packaged?packaged.files.get(name)?.toString('utf8')??(()=>{throw Error('Absent runtime '+name);})():fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');

const root = fileURLToPath(new URL('../', import.meta.url));
let browserPath=process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';
if(firefox){const candidates=[process.env.FIREFOX_BIN,'C:/Program Files/Mozilla Firefox/firefox.exe'];if(process.platform==='win32'){try{const root=execFileSync('powershell.exe',['-NoProfile','-Command','(Get-AppxPackage -Name Mozilla.Firefox).InstallLocation'],{windowsHide:true,encoding:'utf8'}).trim();if(root)candidates.push(path.join(root,'VFS/ProgramFiles/Firefox Package Root/firefox.exe'));}catch{}}browserPath=candidates.filter(Boolean).find(file=>fs.existsSync(file));if(!browserPath)throw Error('Set FIREFOX_BIN to run Firefox checks.');}
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
const presentationChecks=fs.readFileSync(new URL('./presentation-parity-checks.js',import.meta.url),'utf8');
const advancedChecks=presentationChecks+fs.readFileSync(new URL('./advanced-parity-checks.js',import.meta.url),'utf8');
const mock = `
globalThis.addEventListener('error', event => {fetch('/result?route='+encodeURIComponent(location.pathname),{method:'POST',body:JSON.stringify({ok:false,error:event.message})})});
const listeners = [];
globalThis.values = { fanaticalLibraryItems: [{source:'fanatical',sourceItemId:'product-123450',title:'Comic #10',mediaType:'book',bundle:{sourceItemId:'bundle-123456',title:'Test comics',slug:'test-comics'},purchaseDate:null}],galacticLibraryExtensionId:'b'.repeat(32),fanaticalScannedOrderFingerprints:['a'.repeat(64)] };
if(location.pathname.endsWith('test-empty')){values.fanaticalLibraryItems=[];values.galacticLibraryExtensionId='';}
if(location.pathname.includes('test-editions')) values.fanaticalLibraryItems=[${JSON.stringify(editionBase)},{...${JSON.stringify(editionBase)},sourceItemId:'edition-gold-123456',title:'Space Adventure Gold Edition'}];
if(location.pathname.includes('test-contents')) values.fanaticalLibraryItems=[{source:'fanatical',sourceItemId:'owned-issue-123456',title:'Saga #1',mediaType:'book',run:'2020',language:'en'}];
if(location.pathname.includes('test-contents')) values.fanaticalWishlistItems=JSON.parse(sessionStorage.getItem('fixture-wishlist')||'null')||[{sourceItemId:'contents-product-2',title:'Saga #6',mediaType:'book',weight:7}];
if(location.pathname==='/options') values.fanaticalLastScanAttempt={status:'incomplete'};
values.fanaticalSummaryPreferences=JSON.parse(sessionStorage.getItem('fixture-summary')||'null')||{};
globalThis.scanFailure = false;
globalThis.scanScenario = 'new';
globalThis.centralMode = 'normal';
globalThis.centralDelayMs = ${slowCentral?4500:0};
if(${slowCentral})values.fanaticalSummaryPreferences={minimized:true,position:'top-left'};
globalThis.requests = [];
globalThis.chrome = {runtime:{getManifest:()=>({name:'Fanatical Library'}),onMessage:{addListener(){}},id:'a'.repeat(32),sendMessage:async(first,second)=>{
  const message=second||first; requests.push(message);
  if(message.type==='MATCH_ITEMS'&&centralDelayMs)await new Promise(resolve=>setTimeout(resolve,centralDelayMs));
  if(message.type==='FANATICAL_STORE'){
    const {createSyncStore}=await import('/src/library-data.mjs');
    globalThis.fixtureStore??=createSyncStore(chrome.storage.local);
    try{return {ok:true,result:await fixtureStore.execute(message.operation,message.args)};}catch(error){return {ok:false,error:error.message};}
  }
  if(message.type==='GET_STATUS')return {ok:true,apiVersion:1,ready:true,capabilities:{mediaTypes:['game','book','audiobook','software'],reviewedContents:true,entitlementReminders:true}};
  if(message.type==='GET_REMINDERS')return {ok:true,apiVersion:1,total:51,nextOffset:message.offset===0?50:null,reminders:Array.from({length:51},(_,n)=>({reminderRef:'opaque-reminder-'+n,itemRef:'opaque-item-'+n,title:'Reminder '+n,provider:'fanatical',mediaType:'game',kind:n===50?'key-expiry':'activation',dueAt:n===50?'2026-10-10T12:00:00Z':null,severity:n===50?'due-soon':'information'})).slice(message.offset,message.offset+message.limit)};
  if(message.type==='PING'&&centralMode==='absent')throw Error('Could not establish connection. Receiving end does not exist.');
  if(message.type==='PING')return {ok:true,apiVersion:1,appVersion:'0.1.0'};
  if(message.type==='FANATICAL_IMPORT_PURCHASES'){
    const scope={fullScan:message.fullScan,scanHistoryMissing:scanScenario==='restore',total:scanScenario==='empty'?0:1,skipped:scanScenario==='empty'?26:0};
    window.postMessage({type:'FANATICAL_IMPORT_PROGRESS',progressId:message.progressId,progress:{phase:'plan',...scope}},location.origin);
    window.postMessage({type:'FANATICAL_IMPORT_PROGRESS',progressId:'wrong-scan',progress:{phase:'plan',...scope,total:999}},location.origin);
    window.postMessage({type:'FANATICAL_IMPORT_PROGRESS',progressId:message.progressId,progress:{phase:'plan',...scope,total:-1}},location.origin);
    await new Promise(resolve=>setTimeout(resolve,100));
    setTimeout(()=>window.postMessage({type:'FANATICAL_IMPORT_PROGRESS',progressId:message.progressId,progress:{phase:'list',page:999}},location.origin),20);
    return scanFailure?{ok:false,error:'Scan incomplete; previous purchases and successful scan history were kept.'}:{ok:true,summary:{scanMode:message.fullScan?'full':'quick',scanHistoryMissing:scope.scanHistoryMissing,ordersScanned:scope.total,ordersSkipped:scope.skipped,addedProducts:scanScenario==='new'?1:0,ownedLeafProducts:1,historyCoverage:'No pagination metadata: silent server truncation cannot be independently ruled out.'}};
  }
  if(message.type==='MATCH_ITEMS'&&centralMode==='none')return {ok:true,apiVersion:1,results:message.items.map(item=>({requestId:item.requestId,matches:[],possibleMatches:[],partialMatches:[],coverage:null}))};
  if(message.type==='MATCH_ITEMS'&&centralMode==='fanatical')return {ok:true,apiVersion:1,results:message.items.map(item=>({requestId:item.requestId,matches:item.title==='External comic'?[{provider:'fanatical',title:item.title,ownership:'owned',relationship:'same-edition'}]:[]}))};
  if(message.type==='MATCH_ITEMS'&&centralMode==='reject')return {ok:false,apiVersion:1};
  if(message.type==='MATCH_ITEMS'&&centralMode==='legacy')return {ok:true,apiVersion:1,results:message.items.map(item=>({requestId:item.requestId,matches:[]}))};
  if(message.type==='MATCH_ITEMS'&&location.pathname.includes('test-contents'))return {ok:true,apiVersion:1,results:message.items.filter(item=>centralMode!=='partial'||item.title!=='Saga #8').map(item=>{
    const evidence={provider:'kindle',title:'Saga Complete Collection',ownership:'owned',relationship:'contains',itemRef:'opaque-saga',reason:'Reviewed full issues',confidence:1,evidence:{source:'Reviewed publisher contents',checkedAt:'2026-08-01'},verifiedAt:'2026-08-01'};
    const entries=item.contents||[];const covered=entries.filter(entry=>['2','5'].includes(entry.number)).map(entry=>({...entry,evidence:[evidence]}));
    const uncertain={provider:'kindle',title:'Saga #8',ownership:'unknown',relationship:'same-work',itemRef:'opaque-uncertain',reason:'Title candidate; ownership needs confirmation',evidence:{source:'Kindle import',checkedAt:null}};
    return {requestId:item.requestId,matches:[],possibleMatches:item.title==='Saga #8'?[uncertain]:[],partialMatches:covered.length?[evidence]:[],coverage:entries.length?{total:entries.length,owned:covered.length,complete:covered.length===entries.length,scopeUncertain:false,covered,possibleCovered:[],missing:entries.filter(entry=>!['2','5'].includes(entry.number))}:null};
  })};
  if(message.type==='MATCH_ITEMS')return {ok:true,apiVersion:1,results:message.items.map(item=>({requestId:item.requestId,matches:item.title==='External comic'?[{provider:'humble',title:'External comic',ownership:'owned',relationship:'same-edition',evidence:{source:'Reviewed same-edition relationship',checkedAt:null}}]:[]}))};
  if(message.type==='FANATICAL_GET_PUBLIC_BUNDLE'&&message.path.includes('test-empty'))return {ok:true,bundle:{_id:'empty-bundle-123456',name:'Empty bundle',bundles:[]}};
  if(message.type==='FANATICAL_GET_PUBLIC_BUNDLE')return {ok:true,bundle:message.path.includes('test-contents')?(message.path.includes('pick-and-mix')?${JSON.stringify(contentsBundle)}:${JSON.stringify({ ...contentsBundle, products: undefined, tiers: undefined })}):message.path.includes('test-editions')?${JSON.stringify(editionBundle)}:message.path.includes('pick-and-mix')?${JSON.stringify({ ...bundle, products, tiers: [{ quantity: 2, price: { USD: 100 } }] })}:${JSON.stringify(bundle)}};
}},storage:{local:{get:async defaults=>{if(defaults==null)return structuredClone(values);if(typeof defaults==='string')return defaults in values?{[defaults]:structuredClone(values[defaults])}:{};if(Array.isArray(defaults))return Object.fromEntries(defaults.filter(key=>key in values).map(key=>[key,structuredClone(values[key])]));return structuredClone({...defaults,...Object.fromEntries(Object.keys(defaults).filter(key=>key in values).map(key=>[key,values[key]]))});},set:async changes=>{Object.assign(values,changes);if(changes.fanaticalSummaryPreferences)sessionStorage.setItem('fixture-summary',JSON.stringify(changes.fanaticalSummaryPreferences));if('fanaticalWishlistItems' in changes)sessionStorage.setItem('fixture-wishlist',JSON.stringify(changes.fanaticalWishlistItems)); const events={};for(const key in changes)events[key]={newValue:changes[key]};listeners.forEach(listener=>listener(events,'local'));},remove:async keys=>{const changes={};for(const key of Array.isArray(keys)?keys:[keys]){delete values[key];changes[key]={newValue:undefined};}listeners.forEach(listener=>listener(changes,'local'));}},onChanged:{addListener:listener=>listeners.push(listener)}},tabs:{create(){}}};
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
const assertBadgesVisible=()=>{const panel=document.querySelector('[data-fanatical-library-summary]'),oldVisibility=panel?.style.visibility;if(panel)panel.style.visibility='hidden';try{for(const badge of document.querySelectorAll('[data-fanatical-library-for]')){
  const host=badge.parentElement,card=host.closest('article'),css=getComputedStyle(badge),outline=getComputedStyle(host),b=badge.getBoundingClientRect(),h=host.getBoundingClientRect();
  if(!h.width||!h.height)continue;
  assert(css.position==='absolute','Provider button CSS moved the ownership badge into normal flow');
  assert(b.top>=h.top&&b.bottom<=h.bottom&&b.left>=h.left&&b.right<=h.right,'Ownership badge is clipped outside the cover');
  assert(outline.outlineStyle==='solid'&&parseFloat(outline.outlineWidth)>=2,'Ownership status is missing its cover border');
  assert(b.top-h.top<(card?.querySelector(':scope > .new-to-bundle-label')?45:15),'Ownership badge is not at the top of the cover');
  if(card?.querySelector(':scope > .new-to-bundle-label'))assert(b.top-h.top>=35,'Ownership badge overlaps the native New to bundle label');
  assert(document.elementFromPoint(b.left+Math.min(10,b.width/2),b.top+b.height/2)===badge||b.top>=innerHeight,'Ownership badge cannot receive a click above the native card link');
}}finally{if(panel)panel.style.visibility=oldVisibility;}};
const diagnostics=()=>document.querySelector('[data-fanatical-library-diagnostics]');
const finish=result=>{const node=document.createElement('pre');node.id='browser-check-result';node.textContent=JSON.stringify(result);document.body.append(node);fetch('/result?route='+encodeURIComponent(location.pathname),{method:'POST',body:JSON.stringify(result)})};
`;
const bundleChecks = `${common}
try {
  assert(['Book Six','Book Three','Book Two'].sort(globalThis.LibraryTitleSort.compare).join('|')==='Book Two|Book Three|Book Six','Written book numbers sort naturally in the packaged storefront runtime');
  await wait();
  assert(!diagnostics(),'Diagnostics should default off');
  assert(document.querySelectorAll('[data-fanatical-library-for]').length===4,'Missing card badges');
  assertBadgesVisible();
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
  assert(!document.querySelector('.fanatical-library-buy-recommendation'),'Simple contains no purchase recommendation');
  assert(document.querySelector('.fanatical-library-advanced').contains(document.querySelector('.fanatical-library-planning')),'Planning belongs in Advanced');
  assert(!document.querySelector('.fanatical-library-advanced').open,'Advanced defaults closed');
  assert(![...document.querySelectorAll('.fanatical-library-title-list > ol > li')].some(row=>row.querySelector('.fanatical-library-inspect')),'Straightforward rows omit Why');
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
  centralMode='absent';await chrome.storage.local.remove('galacticLibraryExtensionId');for(let n=0;n<100&&document.querySelector('.fanatical-library-owned-elsewhere-badge');n++)await new Promise(resolve=>setTimeout(resolve,30));
  assert(!document.querySelector('.fanatical-library-owned-elsewhere-badge'),'Empty central lookup retained external ownership');
  assert(document.querySelectorAll('.fanatical-library-new-badge').length===3,'External card did not return to local matching');
  assert(!document.querySelector('.fanatical-library-summary-counts').textContent.includes('Check incomplete'),'Unavailable GL must leave local results final');
  if(!location.pathname.includes('pick-and-mix')) assert(document.querySelector('.fanatical-library-tier-list').textContent.includes('new /'),'Simple still reports tier value after ownership changes');
  await chrome.storage.local.set({fanaticalShowDiagnostics:false});await wait();
  assert(!diagnostics(),'Diagnostics did not turn off');
  await chrome.storage.local.set({fanaticalProfileLabel:'personal',fanaticalHistoricalItems:[{profileLabel:'personal',missingSince:'2026-10-02T12:00:00Z',item:{source:'fanatical',sourceItemId:'history-123456',title:'External comic',mediaType:'book',bundle:{title:'Earlier Fanatical bundle'}}}]});await wait();
  const historicalBadge=()=>[...document.querySelectorAll('[data-fanatical-library-for]')].find(button=>button.textContent==='Check ownership');
  assert(historicalBadge(),'Missing history did not render Check ownership');
  assert(document.querySelectorAll('.fanatical-library-new-badge').length===2,'History inflated confirmed-new totals');
  historicalBadge().click();const historyDialog=document.querySelector('#fanatical-library-evidence');assert(historyDialog.textContent.includes('External comic')&&historyDialog.textContent.includes('Earlier Fanatical bundle')&&historyDialog.textContent.includes('not observed'),'Historical inspector omitted title, provenance or uncertainty');historyDialog.querySelector('button').click();
  await chrome.storage.local.set({fanaticalProfileLabel:'different'});await wait();assert(!historicalBadge(),'Foreign-profile history supplied a candidate');
  await chrome.storage.local.set({fanaticalProfileLabel:'personal'});await wait();assert(historicalBadge(),'Same-profile history did not return');
  await chrome.storage.local.set({fanaticalHistoricalItems:[]});await wait();assert(!historicalBadge()&&document.querySelectorAll('.fanatical-library-new-badge').length===3,'Cleared history retained a stale candidate');
  finish({ok:true,scenario:'bundle diagnostics, filtering, Galactic removal'});
}catch(error){finish({ok:false,error:error.message})}
`;
const optionsChecks = `${common}
try {
  await wait();
  const $=selector=>document.querySelector(selector);
  assert($('#library-preview li').textContent.includes('Comic #10'),'Options preview missing');
  $('#summary-position').value='top-right';$('#summary-position').dispatchEvent(new Event('change'));$('#summary-minimized').checked=true;$('#summary-minimized').dispatchEvent(new Event('change'));await wait();assert(values.fanaticalSummaryPreferences.position==='top-right'&&values.fanaticalSummaryPreferences.minimized,'Settings did not persist panel preferences');
  assert($('#history-note').textContent.includes('Last scan incomplete'),'Incomplete coverage warning missing');
  assert($('#fanatical-extension-id').textContent==='a'.repeat(32),'Own extension ID missing');
  $('#test-galactic').click();await wait();
  assert($('#galactic-status').textContent.includes('Connected')&&$('#galactic-status').textContent.includes('reviewed contents supported')&&$('#galactic-status').textContent.includes('software'),'Galactic capability test failed');
  $('#load-reminders').click();await wait();assert($('#reminder-list').children.length===50&&$('#reminder-list').textContent.includes('deadline not reported'),'First reminder page or unknown deadline missing');$('#reminder-next').click();await wait();assert($('#reminder-list').children.length===1&&$('#reminder-list').textContent.includes('2026-10-10'),'Reported expiry or second page missing');$('#reminder-previous').click();await wait();assert($('#reminder-list').children.length===50,'Previous reminder page missing');
  $('#show-diagnostics').click();await wait();assert(values.fanaticalShowDiagnostics===true,'Diagnostics setting not saved');
  $('#wishlist-title').value='Manual wish';$('#wishlist-media').value='book';$('#wishlist-weight').value='7';$('#add-wish').click();await wait();assert(values.fanaticalWishlistItems?.[0].weight===7,'Manual wish was not saved');
  const ownedBeforeWishes=JSON.stringify(values.fanaticalLibraryItems);
  const priority=$('#wishlist-list input');priority.value='9';priority.dispatchEvent(new Event('change'));await wait();assert(values.fanaticalWishlistItems[0].weight===9,'Saved wish priority was not editable');priority.value='7';priority.dispatchEvent(new Event('change'));await wait();
  $('#export-wishlist').click();await wait();const wishes=JSON.parse(await exportedBlob.text());assert(wishes.wishlist[0].weight===7&&!wishes.items,'Standalone wishlist export changed format');
  const wishlistTransfer=new DataTransfer();wishlistTransfer.items.add(new File([JSON.stringify(wishes)],'wishlist.json',{type:'application/json'}));$('#wishlist-file').files=wishlistTransfer.files;$('#wishlist-file').dispatchEvent(new Event('change'));await wait();assert($('#wishlist-status').textContent.startsWith('Restored')&&JSON.stringify(values.fanaticalLibraryItems)===ownedBeforeWishes,'Wishlist restore changed ownership');
  $('#export').click();await wait();
  const backup=JSON.parse(await exportedBlob.text());assert(backup.items.length===1&&!backup.orderFingerprints&&backup.schemaVersion===4&&backup.wishlistItems[0].weight===7,'Backup omitted wishlist or leaked scan authority');
  const upload=async text=>{const transfer=new DataTransfer();transfer.items.add(new File([text],'backup.json',{type:'application/json'}));$('#import-file').files=transfer.files;$('#import-file').dispatchEvent(new Event('change'));for(let attempt=0;attempt<8;attempt++){await wait();if(!$('#import-file').disabled)return;}throw new Error('File import did not finish')};
  $('#export-catalog').click();await wait();const catalog=JSON.parse(await exportedBlob.text());assert(catalog.format==='fanatical-title-catalog'&&!catalog.items[0].bundle&&!catalog.items[0].purchaseDate,'Catalog retained purchase evidence');await upload(JSON.stringify(catalog));assert(values.fanaticalLibraryItems.length===1&&$('#import-status').textContent.includes('failed'),'Catalog was accepted as ownership backup');
  await upload('invalid JSON');assert(values.fanaticalLibraryItems.length===1,'Invalid JSON changed library');
  confirmAnswer=false;await upload(JSON.stringify({schemaVersion:1,items:[]}));assert(values.fanaticalLibraryItems.length===1,'Cancelled restore changed library');
  confirmAnswer=true;backup.items[0].title='Restored comic';await upload(JSON.stringify(backup));
  assert(values.fanaticalLibraryItems[0].title==='Restored comic','Backup did not restore: '+$('#import-status').textContent);
  assert(values.fanaticalScannedOrderFingerprints.length===0&&values.fanaticalImportSummary===null,'Backup retained scan authority');
  assert(values.fanaticalLastScanAttempt===null&&!$('#history-note').textContent.includes('incomplete'),'Restore retained stale failed-scan warning');
  assert($('#library-preview li').textContent.includes('Restored comic'),'Preview did not refresh');
  assert(values.fanaticalShowDiagnostics&&values.galacticLibraryExtensionId,'Restore removed settings');assert(values.fanaticalSummaryPreferences.position==='top-right'&&values.fanaticalSummaryPreferences.minimized,'Restore changed display preferences');
  const profileSeed={format:'fanatical-library-backup',schemaVersion:4,items:[{source:'fanatical',sourceItemId:'personal-profile-item',title:'Personal item',mediaType:'book'}],profileLabel:'personal',profileArchives:[{profileLabel:'work',items:[{source:'fanatical',sourceItemId:'work-profile-item',title:'Work item',mediaType:'book'}],historicalItems:[]}],historicalItems:[],wishlistItems:wishes.wishlist};
  await upload(JSON.stringify(profileSeed));await wait();const accounts=$('#account-profiles'),picker=accounts.querySelector('[data-account-list]');assert(picker.options.length===2,'Saved account picker missing accounts');picker.value='work';picker.dispatchEvent(new Event('change'));accounts.querySelector('[data-account-use]').click();await wait();assert(values.fanaticalProfileLabel==='personal','Account switch skipped confirmation');accounts.querySelector('[data-account-confirm]').checked=true;accounts.querySelector('[data-account-use]').click();await wait();assert(values.fanaticalProfileLabel==='work'&&values.fanaticalLibraryItems[0].title==='Work item','Saved account switch mixed ownership');accounts.querySelector('[data-account-name]').value='business';accounts.querySelector('[data-account-rename]').click();await wait();assert(values.fanaticalProfileLabel==='business'&&values.fanaticalLibraryItems[0].title==='Work item','Rename changed ownership');picker.value='personal';picker.dispatchEvent(new Event('change'));accounts.querySelector('[data-account-confirm]').checked=true;accounts.querySelector('[data-account-use]').click();await wait();assert(values.fanaticalProfileLabel==='personal'&&values.fanaticalLibraryItems[0].title==='Personal item','Switch back did not restore personal ownership');
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
  assertBadgesVisible();
  const notes=[...document.querySelectorAll('.fanatical-library-card-edition-note')];
  assert(notes.length===2&&notes.every(note=>note.textContent.includes('Space Adventure')),'Owned title missing from card captions');
  assert(document.querySelector('.fanatical-library-partial-badge').textContent.includes('1/2'),'Partial fraction remains visible');
  const rows=[...document.querySelectorAll('.fanatical-library-title-list > ol > li')];
  assert(rows.length===2&&rows.every(row=>row.textContent.includes('Space Adventure')),'Review summary did not show owned title');
  assert(rows.every(row=>row.querySelector('button')?.textContent==='Why?'),'Possible rows have a concise Why action');
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
  assert(panel.children.length===3&&panel.querySelector('.library-import-profile details')&&!panel.querySelector('.library-import-profile details').open,'Advanced account controls must start collapsed');
  assert(panel.querySelector('.library-import-footer').contains(panel.querySelector('output')),'Importer status is outside the button footer');
  assert(panel.querySelector('[data-import-mode="new"]').textContent==='Import new purchases'&&panel.querySelector('[data-import-mode="all"]').textContent==='Rescan all purchases','Importer button wording differs');
  const quick=panel.querySelector('[data-import-mode="new"]');const full=panel.querySelector('[data-import-mode="all"]');const status=panel.querySelector('output');
  panel.querySelector('[data-profile-confirm]').checked=true;panel.querySelector('[data-profile-label]').dispatchEvent(new Event('input'));assert(!panel.querySelector('[data-profile-confirm]').checked,'Nickname edit retained stale account confirmation');
  quick.click();await new Promise(resolve=>setTimeout(resolve,20));
  assert(quick.disabled&&full.disabled,'Scan controls were not disabled while fetching');
  assert(status.textContent.startsWith('Found 1 new purchase'),'Valid progress was missing or replaced by an invalid/different-scan message');
  await wait();assert(status.textContent.startsWith('Checked 1 new purchase; imported 1 new item'),'Quick scan result missing');
  assert(status.textContent.includes('silent server truncation'),'Unknown coverage was not exposed');
  assert(!quick.disabled&&!full.disabled,'Scan controls did not recover');
  await new Promise(resolve=>setTimeout(resolve,40));assert(status.textContent.startsWith('Checked 1 new purchase'),'Late progress replaced the completed result');
  scanScenario='empty';quick.click();await wait();
  assert(status.textContent.startsWith('No new purchases; no purchase details to check; skipped 26 unchanged purchases'),'Unchanged library did not distinguish no new purchases');
  scanScenario='restore';quick.click();await wait();
  assert(status.textContent.startsWith('Rechecked 1 purchase because saved scan history was unavailable'),'Restored purchases were incorrectly reported as new');
  scanScenario='new';
  scanFailure=true;full.click();await wait();
  assert(status.textContent.includes('Scan incomplete')&&status.textContent.includes('previous purchases'),'Failed coverage warning missing');
  assert(!quick.disabled&&!full.disabled,'Failed scan left controls disabled');
  scanFailure=false;full.click();await wait();
  assert(status.textContent.startsWith('Rescanned 1 purchase; current snapshot rebuilt'),'Successful rescan did not replace error');
  finish({ok:true,scenario:'Orders importer coverage, failed scan and control recovery'});
}catch(error){finish({ok:false,error:error.message})}
`;
const contentsChecks = `${common}\n${advancedChecks}
try {
  await wait();
  if(sessionStorage.getItem('verify-wishlist-reload')){const summary=document.querySelector('[data-fanatical-library-summary]');assert(summary.classList.contains('fanatical-library-summary-minimized')&&summary.dataset.position==='top-left','Summary size/corner did not survive reload');summary.querySelector('.fanatical-library-summary-expand').click();await wait();assert(values.fanaticalSummaryPreferences.minimized===false,'Reloaded summary could not expand');const panel=document.querySelector('.fanatical-library-planning');panel.open=true;panel.querySelector('details').open=true;const goal=panel.querySelector('[aria-label="Purchase planning goal"]');goal.value='wishlist';goal.dispatchEvent(new Event('change'));assert(panel.textContent.includes('5 wishlist priority points'),'Reload dropped the saved wishlist');assert(panel.querySelector('li[data-product-id="contents-product-2"] input').value==='5','Reload reset saved wishlist weight');finish({ok:true,scenario:'initial/restored/reloaded wishlist and contents planning',route:location.pathname});}else{
  if(!sessionStorage.getItem('verify-wishlist-reload'))await runAdvancedParityChecks(false,assert);
  const content=()=>document.querySelector('.fanatical-library-contents');
  assert(content()?.textContent.includes('4 additional · 2 covered · 0 uncertain'),'Distinct bundle unit counts are wrong');
  assert(document.querySelectorAll('.fanatical-library-partial-badge').length===2,'Central and local union coverage did not resolve Partial');
  assertBadgesVisible();
  const sent=requests.filter(message=>message.type==='MATCH_ITEMS').flatMap(message=>message.items);
  assert(sent.some(item=>item.title==='Saga Collection 1'&&item.contents.length===3&&item.excludeProviders.includes('fanatical')),'Live parser did not send explicit contents');
  if(location.pathname.includes('pick-and-mix')) {
    assert(content().textContent.includes('Selected items: 0 distinct additional units'),'Pool counted as selection');
    const card=[...document.querySelectorAll('article')].find(card=>card.textContent.includes('Saga Collection 1'));card.classList.add('selected');card.click();await wait();
    assert(content().textContent.includes('Selected items: 1 distinct additional units'),'Selection did not update additional-unit counts');
  } else assert(content().textContent.includes('$1.00 tier: 1 distinct additional units')&&content().textContent.includes('$10.00 tier: 4 distinct additional units'),'Cumulative tier unit counts are wrong');
  const planning=()=>document.querySelector('.fanatical-library-planning');planning().open=true;await wait();planning().querySelector('details').open=true;
  const wishRow=planning().querySelector('li[data-product-id="contents-product-2"]');assert(wishRow.querySelector('input').value==='7'&&wishRow.textContent.includes('Save priority'),'Saved wishlist was ignored on initial bundle load');
  const advanced=document.querySelector('.fanatical-library-advanced');advanced.open=true;
  const initialWishes=structuredClone(values.fanaticalWishlistItems);
  await chrome.storage.local.set({fanaticalWishlistItems:[...initialWishes,{...initialWishes[0],sourceItemId:'alternate-product-2',weight:3}]});await wait();
  const duplicateToggle=document.querySelector('[aria-label="Wishlist Saga #6"]');assert(duplicateToggle.checked,'Duplicate compatible wish lost row recognition');duplicateToggle.checked=false;duplicateToggle.dispatchEvent(new Event('change'));await wait();
  assert(values.fanaticalWishlistItems.length===0&&!document.querySelector('.fanatical-library-wish-marker'),'Removing a wish left duplicate manifestations marked');
  await chrome.storage.local.set({fanaticalWishlistItems:initialWishes});await wait();
  const initialGoal=planning().querySelector('[aria-label="Purchase planning goal"]');initialGoal.value='wishlist';initialGoal.dispatchEvent(new Event('change'));assert(planning().textContent.includes('7 wishlist priority points'),'Initial saved wishlist did not affect purchase value');
  globalThis.fixtureStore??= (await import('/src/library-data.mjs')).createSyncStore(chrome.storage.local);const savedBackup=(await fixtureStore.execute('backup'));await fixtureStore.execute('wishlist',['replace',[]]);savedBackup.wishlistItems[0].weight=9;await fixtureStore.execute('restore',[savedBackup]);await wait();assert(planning().textContent.includes('9 wishlist priority points'),'Restored wishlist was ignored by the open bundle');
  assert(document.querySelector('.fanatical-library-advanced').open&&planning().open&&planning().querySelector('details').open,'Wishlist refresh closed active disclosures');
  assert(document.querySelector('.fanatical-library-wishlist-notice').textContent.includes('1 matches')&&document.querySelector('.fanatical-library-wish-marker'),'Wishlist refresh did not update Simple recognition and cards');
  const restoredRow=planning().querySelector('li[data-product-id="contents-product-2"]');restoredRow.querySelector('input').value='5';[...restoredRow.querySelectorAll('button')].find(button=>button.textContent==='Save priority').click();await wait();
  assert(values.fanaticalWishlistItems?.length===1&&values.fanaticalWishlistItems[0].weight===5,'Bundle wishlist did not persist');
  const goal=planning().querySelector('[aria-label="Purchase planning goal"]');goal.value='wishlist';goal.dispatchEvent(new Event('change'));assert(planning().textContent.includes('5 wishlist priority points'),'Wishlist weights did not affect plan value');
  if(location.pathname.includes('pick-and-mix')){assert(planning().querySelector('.fanatical-library-plan-result').textContent.includes('No priced tier'),'Uncertain fillers entered Pick and Mix implicitly');planning().querySelector('label input[type="checkbox"]').click();assert(planning().querySelector('.fanatical-library-plan-result').textContent.includes('$1.00'),'Explicit uncertainty did not produce an available complete Pick and Mix selection');}else assert(planning().querySelector('.fanatical-library-plan-result').textContent.includes('$10.00'),'Wishlist goal did not choose the cheapest containing tier');
  assert(document.querySelectorAll('.fanatical-library-partial-badge').length===2,'Planning changed ownership badges');
  document.querySelector('.fanatical-library-partial-badge').click();
  const inspector=document.querySelector('#fanatical-library-evidence');
  assert(inspector?.textContent.includes('Reviewed publisher contents')&&inspector.textContent.includes('2026-08-01'),'Central contents evidence/freshness missing from inspector');
  inspector.querySelector('button').click();await wait();
  const reading=()=>document.querySelector('.fanatical-library-reading');
  const openUnits=async()=>{for(const section of reading().querySelectorAll('details'))section.open=true;await wait();};
  await openUnits();
  assert(reading()?.textContent.includes('issue 5: Covered · not offered here'),'Central ownership of an intervening issue was missed');
  assert(reading().textContent.includes('issue 7: Not confirmed covered · not offered here'),'Reading gap outside the offer was not surfaced');
  const reminders=()=>document.querySelector('.fanatical-library-reminders');
  for(const section of reminders().querySelectorAll('details'))section.open=true;await wait();
  assert(reminders()?.textContent.includes('unknown ownership')&&reminders().textContent.includes('Observation date unavailable'),'Central ownership/freshness reminders missing');
  const matchedSince=start=>requests.slice(start).filter(message=>message.type==='MATCH_ITEMS').flatMap(message=>message.items);
  centralMode='partial';const beforeRefresh=requests.length;reminders().querySelector('button').click();await wait();
  assert(matchedSince(beforeRefresh).some(item=>item.title==='Saga Collection 1'),'Refresh reused a successful central result');
  assert(document.querySelectorAll('.fanatical-library-partial-badge').length===2&&document.querySelector('.fanatical-library-unchecked-badge'),'Mixed central failure lost valid local/successful coverage');
  centralMode='normal';const beforeRetry=requests.length;document.querySelector('.fanatical-library-retry-galactic').click();await wait();
  assert(matchedSince(beforeRetry).length===1&&matchedSince(beforeRetry)[0].title==='Saga #8','Retry did not retain successful evidence');
  assert(!document.querySelector('.fanatical-library-unchecked-badge'),'Retry did not recover the missing lookup');
  centralMode='legacy';reminders().querySelector('button').click();await wait();
  await openUnits();
  assert(content()?.textContent.includes('0 additional'),'Legacy title lookup falsely established unit absence');
  assert(reading().textContent.includes('issue 7: Check incomplete'),'Missing central contents capability falsely established a reading gap');
  centralMode='reject';reminders().querySelector('button').click();await wait();
  assert(document.querySelectorAll('.fanatical-library-unchecked-badge').length===3,'Failed lookups were presented as New');
  assertBadgesVisible();
  assert(!document.querySelector('.fanatical-library-buy-recommendation'),'Failed lookups produced a buy recommendation');
  centralMode='normal';reminders().querySelector('button').click();await wait();
  assert(content().textContent.includes('4 additional · 2 covered · 0 uncertain'),'Successful retry did not restore central coverage');
  const recordsBefore=JSON.stringify(values.fanaticalLibraryItems),position=document.querySelector('[aria-label="Bundle summary position"]');position.value='top-left';position.dispatchEvent(new Event('change'));document.querySelector('.fanatical-library-summary-minimize').click();await wait();assert(values.fanaticalSummaryPreferences.minimized&&values.fanaticalSummaryPreferences.position==='top-left','Summary preferences did not save');assert(document.querySelector('[data-fanatical-library-summary]').dataset.position==='top-left'&&JSON.stringify(values.fanaticalLibraryItems)===recordsBefore,'Panel position changed ownership or failed to apply');sessionStorage.setItem('verify-wishlist-reload','true');location.reload();
  }
}catch(error){finish({ok:false,error:error.message})}
`;
const cards = (kind, items = products) => items.map((product,index) => `<div class="three-column-row"><article class="${kind} faux-block-link">${kind==='PickAndMixCard'&&index===0?'<span class="new-to-bundle-label">New to bundle</span>':''}<div class="cover-container"><img alt="${product.name}"></div><h2 class="card-product-name">${product.name}</h2></article></div>`).join('');
const slowCentralChecks=common+fs.readFileSync(new URL('./slow-central-checks.js',import.meta.url),'utf8');
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
  if(url==='/hydration-fixture.js')return send('text/javascript',fs.readFileSync(new URL('./hydration-fixture.js',import.meta.url),'utf8'));
  if(url==='/hydration-check.js')return send('text/javascript',common+fs.readFileSync(new URL('./hydration-checks.js',import.meta.url),'utf8'));
  if (url === '/lifecycle-fixture.js') return send('text/javascript',fs.readFileSync(new URL('./lifecycle-fixture.js',import.meta.url),'utf8'));
  if(url==='/theme-check.js')return send('text/javascript',fs.readFileSync(new URL('./theme-overlay-checks.js',import.meta.url),'utf8'));
  if (url === '/lifecycle-check.js') return send('text/javascript',common+presentationChecks+fs.readFileSync(new URL('./lifecycle-checks.js',import.meta.url),'utf8'));
  if(url.startsWith('/gl/'))return send('text/javascript',glPack.files.get(url.slice(4))?.toString('utf8')??'');
  if(url==='/navigation-fixture.js')return send('text/javascript','globalThis.navigationCards='+JSON.stringify(cards('bundle-product-card'))+';'+fs.readFileSync(new URL('./navigation-fixture.js',import.meta.url),'utf8'));
  if(url==='/navigation-check.js')return send('text/javascript',fs.readFileSync(new URL('./navigation-checks.js',import.meta.url),'utf8'));
  if (url === '/mock.js') return send('text/javascript', mock);
  if (url === '/options-check.js') return send('text/javascript', optionsChecks);
  if (url === '/bundle-check.js') return send('text/javascript', bundleChecks);
  if (url === '/empty-check.js') return send('text/javascript', common+`try{await wait();assert(document.querySelector('.fanatical-library-summary-counts').textContent.includes('New 0'),'Empty summary has incorrect counts');assert(document.querySelector('.fanatical-library-advanced')&&!document.querySelector('.fanatical-library-advanced').open&&document.querySelector('[data-section=galactic]'),'Automatic GL connection details stay collapsed for an empty bundle');finish({ok:true,scenario:'no applicable Advanced subsection'});}catch(error){finish({ok:false,error:error.message});}`);
  if (url === '/slow-central-check.js') return send('text/javascript', slowCentralChecks);
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
  if (url === '/en/orders') return send('text/html', `<!doctype html><html><head><link rel="stylesheet" href="/src/theme.css"><link rel="stylesheet" href="/src/content.css"><link rel="stylesheet" href="/src/theme-overlays.css"></head><body><main>Mock orders</main><script src="/mock.js"></script>${navigation?'<script src="/navigation-fixture.js"></script>':''}<script src="/src/theme.js"></script><script src="/src/shared.js"></script><script src="/src/planning.js"></script><script src="/src/planning-ui.js"></script><script src="/src/content.js"></script>${navigation?'<script src="/gl/src/providers/floating-panel.js"></script><script src="/gl/src/providers/fanatical.js"></script><script src="/gl/src/providers/fanatical-content.js"></script><script type="module" src="/navigation-check.js"></script>':'<script type="module" src="/order-check.js"></script>'}</body></html>`);
  if(url==='/en/bundle/test-empty')return send('text/html','<!doctype html><html><head><link rel="stylesheet" href="/src/theme.css"><link rel="stylesheet" href="/src/content.css"><link rel="stylesheet" href="/src/theme-overlays.css"></head><body><script src="/mock.js"></script><script src="/src/theme.js"></script><script src="/src/shared.js"></script><script src="/src/planning.js"></script><script src="/src/planning-ui.js"></script><script src="/src/content.js"></script><script type="module" src="/empty-check.js"></script></body></html>');
  if (url === '/en/bundle/test-comics' || url === '/en/bundle/books' || url === '/en/pick-and-mix/test-mix' || url.endsWith('/test-editions') || url.endsWith('/test-contents')) {
    const isCatalogue = url.endsWith('/books');
    const isEdition = url.endsWith('/test-editions');
    const isContents = url.endsWith('/test-contents');
    return send('text/html', `<!doctype html><html><head><link rel="stylesheet" href="/src/theme.css"><link rel="stylesheet" href="/src/content.css"><link rel="stylesheet" href="/src/theme-overlays.css"><style>${themeMode?".fan-grid-container{grid-template-columns:repeat(auto-fit,minmax(160px,1fr))!important}main{max-width:100%;overflow:hidden}":""}.fan-grid-container{display:grid;grid-template-columns:repeat(3,240px);gap:20px}.fanatical-library-pick-mix-reflow{grid-column:1/-1}article{min-height:350px;position:relative}.cover-container{height:310px;overflow:hidden;position:relative}.cover-container img{display:block;width:100%;height:310px}.faux-block-link a,.faux-block-link abbr[title],.faux-block-link button{position:relative;z-index:3}.new-to-bundle-label{position:absolute;top:0;left:0;z-index:3;height:32px}</style></head><body><main>${isCatalogue ? `<ul class="HitCardsRow row">${catalogue}</ul>` : `<section class="tier"><div class="fan-grid-container">${cards(url.includes('pick-and-mix') ? 'PickAndMixCard' : 'bundle-product-card', isContents ? contentsProducts : isEdition ? editionProducts : products)}</div></section>`}</main><script src="/mock.js"></script>${lifecycle?'<script src="/lifecycle-fixture.js"></script>':''}${hydration?'<script src="/hydration-fixture.js"></script>':''}<script src="/src/theme.js"></script><script src="/src/shared.js"></script><script src="/src/planning.js"></script><script src="/src/planning-ui.js"></script><script src="/src/content.js"></script><script type="module" src="/${hydration ? 'hydration' : themeMode ? 'theme' : lifecycle ? 'lifecycle' : isCatalogue ? 'catalogue' : isContents ? 'contents' : isEdition ? 'edition' : slowCentral ? 'slow-central' : 'bundle'}-check.js"></script></body></html>`);
  }
  response.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const allRoutes = ['/options', '/en/bundle/test-comics', '/en/pick-and-mix/test-mix', '/en/bundle/books', '/en/bundle/test-editions', '/en/pick-and-mix/test-editions', '/en/orders', '/en/bundle/test-contents', '/en/pick-and-mix/test-contents','/en/bundle/test-empty'];
  const selectedRoutes=process.argv.slice(2).filter(arg=>!['--release','--firefox','--slow-central','--lifecycle','--hydration','--navigation','--theme','--narrow','--tiny'].includes(arg));const routes=selectedRoutes.length?selectedRoutes:hydration?['/en/bundle/test-comics','/en/bundle/test-contents','/en/bundle/test-editions','/en/pick-and-mix/test-mix']:navigation?['/en/orders']:themeMode?['/en/bundle/test-comics','/en/bundle/test-contents']:lifecycle?['/en/bundle/test-contents','/en/bundle/test-editions']:slowCentral?['/en/bundle/test-comics','/en/pick-and-mix/test-mix']:allRoutes;
  if (routes.some(route => !allRoutes.includes(route))) throw new Error('Unknown browser fixture route');
  for (const [index, route] of routes.entries()) {
    let stopped=Promise.resolve();
    const result = await new Promise((resolve, reject) => {
      const profile=path.join(profileRoot,String(index));fs.mkdirSync(profile);const url=`http://127.0.0.1:${server.address().port}${route}`;
      const args=firefox?['--headless','--no-remote','--profile',profile,url]:['--headless',`--window-size=${themeWidth},1000`,'--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,url];
      const child = spawn(browserPath,args, { env:{...process.env,...(firefox?{MOZ_HEADLESS_WIDTH:String(themeWidth),MOZ_HEADLESS_HEIGHT:'1000'}:{})},windowsHide: true });
      stopped=new Promise(resolve=>child.once('exit',resolve));
      child.stdout.resume(); child.stderr.resume();
      const timeout = setTimeout(() => { pendingResults.delete(route); child.kill(); reject(new Error(`Browser check timed out: ${route}`)); }, 25000);
      pendingResults.set(route, result => { clearTimeout(timeout); pendingResults.delete(route); child.kill(); resolve(result); });
      child.on('error', error => { clearTimeout(timeout); pendingResults.delete(route); reject(error); });
    });
    await Promise.race([stopped,pause(3000)]);
    console.log(JSON.stringify({...result,browser:firefox?'Firefox':'Chrome',packaged:Boolean(packaged)}));
    if (!result.ok) process.exitCode = 1;
  }
} finally { await new Promise(resolve=>server.close(resolve));const target=path.resolve(profileRoot),base=path.resolve(os.tmpdir());if(!target.startsWith(base+path.sep)||!target.slice(base.length+1).startsWith('Fanatical-ui-check-'))throw Error('Unsafe browser cleanup.');fs.rmSync(target,{recursive:true,force:true,maxRetries:5,retryDelay:200}); }
