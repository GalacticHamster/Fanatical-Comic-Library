import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { backupRestoreState, createLibraryBackup, parseLibraryBackup, createSyncStore, createTitleCatalog } from '../src/library-data.mjs';
import '../src/shared.js';

const code = fs.readFileSync(new URL('../src/options.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/u, '');
const item = (title, id = 'product-123456') => ({ source: 'fanatical', sourceItemId: id, title, mediaType: 'game', bundle: { sourceItemId: 'bundle-123456', title: 'Test bundle' }, purchaseDate: null });

async function optionsHarness(initial = {}) {
  const stored = structuredClone(initial); const writes = []; const messages = []; const nodes = new Map();
  const element = () => ({ textContent: '', value: '', checked: false, disabled: false, files: [], children: [], listeners: {}, addEventListener(type, handler) { this.listeners[type] = handler; }, replaceChildren(...children) { this.children = children; }, append(...children) {this.children.push(...children);}, setAttribute(name,value) {this[name]=value;}, click() {} });
  const get = (selector) => { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); };
  const config = { confirm: true, response: { ok: true, apiVersion: 1, appVersion: '0.1.0' }, failure: false };
  const context = vm.createContext({
    document: { querySelector: get, createElement: element },
    chrome: { runtime: { id: 'a'.repeat(32), async sendMessage(id, message) { messages.push({ id, message }); if (config.failure) throw new Error('PRIVATE transport failure'); return config.respond ? config.respond(message) : config.response; } }, storage: { local: {
      async get(defaults) { return { ...defaults, ...stored }; },
      async set(value) { writes.push(structuredClone(value)); Object.assign(stored, structuredClone(value)); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; }
    } }, tabs: { create() {} } },
    confirm: () => config.confirm, LibraryTitleSort:globalThis.LibraryTitleSort, LibraryAccountProfiles:globalThis.LibraryAccountProfiles, FanaticalLibrary: globalThis.FanaticalLibrary,
    backupRestoreState, createLibraryBackup, parseLibraryBackup, createTitleCatalog, Blob, URL, setTimeout, clearTimeout
  });
  const store=createSyncStore(context.chrome.storage.local);const oldSend=context.chrome.runtime.sendMessage;
  context.chrome.runtime.sendMessage=async (...args)=>{const message=args[0];if(message?.type!=='FANATICAL_STORE')return oldSend(...args);try{return {ok:true,result:await store.execute(message.operation,message.args)};}catch(error){return {ok:false,error:error.message};}};
  await vm.runInContext(code, context);
  return { stored, writes, messages, get, config, async click(selector) { await get(selector).listeners.click(); }, async upload(value, raw = false) {
    const contents = raw ? value : JSON.stringify(value);
    get('#import-file').files = [{ size: contents.length, text: async () => contents }];
    await get('#import-file').listeners.change();
  } };
}

test('options preview is bounded, naturally ordered, and displays bundle provenance safely', async () => {
  const ui = await optionsHarness({ fanaticalLibraryItems: [item('Comic #10'), item('Comic #2'), ...Array.from({ length: 50 }, (_, index) => item(`Z ${index}`))] });
  assert.equal(ui.get('#library-preview').children.length, 50);
  assert.deepEqual(ui.get('#library-preview').children.slice(0, 2).map((row) => row.textContent), ['Comic #2 — Test bundle', 'Comic #10 — Test bundle']);
  assert.match(ui.get('#preview-note').textContent, /50 of 52/);
  assert.equal(ui.get('#fanatical-extension-id').textContent, 'a'.repeat(32));
});

test('invalid or cancelled backup import never changes storage', async () => {
  const ui = await optionsHarness({ fanaticalLibraryItems: [item('Keep me')] });
  await ui.upload('not JSON', true); assert.equal(ui.writes.length, 0);
  await ui.upload({ schemaVersion: 2, items: [] }); assert.equal(ui.writes.length, 0);
  ui.config.confirm = false;
  await ui.upload({ schemaVersion: 1, items: [item('Replacement')] });
  assert.equal(ui.writes.length, 0);
  assert.match(ui.get('#import-status').textContent, /cancelled/);
  assert.equal(ui.get('#import-file').disabled, false);
});

test('confirmed restore updates the preview and resets scan history while preserving settings', async () => {
  const ui = await optionsHarness({ fanaticalLibraryItems: [item('Old')], fanaticalImportSummary: { scanMode: 'quick' }, fanaticalScannedOrderFingerprints: ['a'.repeat(64)], fanaticalLastScanAttempt: { status: 'incomplete' }, galacticLibraryExtensionId: 'b'.repeat(32), fanaticalShowDiagnostics: true });
  await ui.upload({ schemaVersion: 1, items: [item('Restored')], orderFingerprints: ['b'.repeat(64)], summary: { importedAt: 'not trusted' } });
  assert.equal(ui.writes.length, 1);
  assert.equal(ui.stored.fanaticalLibraryItems[0].title, 'Restored');
  assert.deepEqual(ui.stored.fanaticalScannedOrderFingerprints, []);
  assert.equal(ui.stored.fanaticalImportSummary, null);
  assert.equal(ui.stored.fanaticalLastScanAttempt, null);
  assert.equal(ui.stored.galacticLibraryExtensionId, 'b'.repeat(32));
  assert.equal(ui.stored.fanaticalShowDiagnostics, true);
  assert.equal(ui.get('#library-preview').children[0].textContent, 'Restored — Test bundle');
});

test('options disclose incomplete coverage while retaining the last successful scan and library preview', async () => {
  const ui = await optionsHarness({ fanaticalLibraryItems: [item('Kept')], fanaticalLastScanAttempt: { status: 'incomplete' },
    fanaticalImportSummary: { scanMode: 'full', addedProducts: 1, ordersScanned: 1, importedAt: '2026-10-01T12:00:00Z', historyCoverage: 'Validated 1 listed order.' } });
  assert.match(ui.get('#history-note').textContent, /Last scan incomplete/);
  assert.match(ui.get('#history-note').textContent, /Validated 1 listed order/);
  assert.match(ui.get('#last-import').textContent, /Last full scan/);
  assert.match(ui.get('#library-preview').children[0].textContent, /Kept/);
  await ui.click('#reset');
  assert.equal('fanaticalLastScanAttempt' in ui.stored, false);
  assert.equal(ui.get('#history-note').textContent.includes('incomplete'), false);
});

test('scan request diagnostics are opt-in', async () => {
  const summary = { historyCoverage: 'Validated 25 pages.', coverage: { retries: 2, concurrency: 3 } };
  const plain = await optionsHarness({ fanaticalImportSummary: summary });
  assert.equal(plain.get('#history-note').textContent.includes('retries'), false);
  const diagnostic = await optionsHarness({ fanaticalImportSummary: summary, fanaticalShowDiagnostics: true });
  assert.match(diagnostic.get('#history-note').textContent, /2 retries; at most 3 concurrent/);
});

test('Galactic test validates IDs and API compatibility without saving or transferring library data', async () => {
  const ui = await optionsHarness();
  ui.get('#galactic-id').value = 'invalid'; await ui.click('#test-galactic'); assert.equal(ui.messages.length, 0);
  ui.get('#galactic-id').value = 'b'.repeat(32); await ui.click('#test-galactic');
  assert.equal(JSON.stringify(ui.messages), JSON.stringify([{ id: 'b'.repeat(32), message: { type: 'PING' } }, { id: 'b'.repeat(32), message: { type: 'GET_STATUS' } }]));
  assert.match(ui.get('#galactic-status').textContent, /Connected/); assert.equal(ui.writes.length, 0);
  ui.config.response.apiVersion = 2; await ui.click('#test-galactic'); assert.match(ui.get('#galactic-status').textContent, /Could not connect/);
  ui.config.failure = true; await ui.click('#test-galactic');
  assert.equal(ui.get('#galactic-status').textContent.includes('PRIVATE'), false);
  assert.equal(ui.get('#test-galactic').disabled, false);
});

test('save/remove Galactic link and diagnostics switch persist only their intended settings', async () => {
  const ui = await optionsHarness({ fanaticalLibraryItems: [item('Kept')] });
  ui.get('#galactic-id').value = 'b'.repeat(32); await ui.click('#save-galactic');
  assert.equal(ui.stored.galacticLibraryExtensionId, 'b'.repeat(32));
  await ui.click('#remove-galactic'); assert.equal('galacticLibraryExtensionId' in ui.stored, false);
  assert.equal(ui.get('#galactic-id').value, '');
  ui.get('#show-diagnostics').checked = true; await ui.get('#show-diagnostics').listeners.change();
  assert.equal(ui.stored.fanaticalShowDiagnostics, true);
  assert.equal(ui.stored.fanaticalLibraryItems[0].title, 'Kept');
});


test('wishlist controls preserve ownership, enforce weights and make every page/search result reachable',async()=>{
  const ui=await optionsHarness({fanaticalLibraryItems:[item('Owned')],fanaticalWishlistItems:Array.from({length:61},(_,n)=>({title:'Wish '+n,mediaType:'book',weight:1}))});assert.equal(ui.get('#wishlist-list').children.length,50);await ui.click('#wishlist-next');assert.equal(ui.get('#wishlist-list').children.length,11);ui.get('#wishlist-search').value='Wish 60';ui.get('#wishlist-search').listeners.input();assert.equal(ui.get('#wishlist-list').children.length,1);assert(ui.get('#wishlist-list').children[0].children[0].textContent.includes('Wish 60'));ui.get('#wishlist-title').value='Preferred';ui.get('#wishlist-media').value='game';ui.get('#wishlist-weight').value='5';await ui.click('#add-wish');assert.equal(ui.stored.fanaticalWishlistItems.length,62);assert.equal(ui.stored.fanaticalLibraryItems[0].title,'Owned');ui.get('#wishlist-weight').value='0';ui.get('#wishlist-title').value='Invalid';await ui.click('#add-wish');assert.equal(ui.stored.fanaticalWishlistItems.length,62);assert.match(ui.get('#wishlist-status').textContent,/weight/);
});

test('reminder view supports pages, filters, unavailable capability and pairing resets without writing ownership',async()=>{
  const ui=await optionsHarness({fanaticalLibraryItems:[item('Keep')],galacticLibraryExtensionId:'b'.repeat(32)});const reminders=Array.from({length:51},(_,n)=>({reminderRef:'opaque-'+n,itemRef:'item-'+n,title:'Reminder '+n,provider:'fanatical',mediaType:'game',kind:'activation',dueAt:null,severity:'information'}));ui.config.respond=message=>message.type==='GET_STATUS'?{ok:true,apiVersion:1,capabilities:{entitlementReminders:true}}:{ok:true,apiVersion:1,total:51,nextOffset:message.offset===0?50:null,reminders:reminders.slice(message.offset,message.offset+50)};
  ui.get('#reminder-provider').value='fanatical';await ui.click('#load-reminders');assert.equal(ui.get('#reminder-list').children.length,50);assert.match(ui.get('#reminder-list').children[0].textContent,/deadline not reported/);await ui.click('#reminder-next');assert.equal(ui.get('#reminder-list').children.length,1);assert.match(ui.get('#reminder-status').textContent,/51-51/);await ui.click('#reminder-previous');assert.equal(ui.get('#reminder-list').children.length,50);assert.equal(ui.writes.length,0);assert.equal(ui.stored.fanaticalLibraryItems[0].title,'Keep');ui.get('#reminder-provider').listeners.change();assert.equal(ui.get('#reminder-list').children.length,0);
  ui.config.respond=()=>({ok:true,apiVersion:1});await ui.click('#load-reminders');assert.match(ui.get('#reminder-status').textContent,/not checked.*does not advertise/);assert.equal(ui.get('#reminder-next').disabled,true);
});
test('late reminder responses cannot repopulate a removed Galactic link',async()=>{
  const ui=await optionsHarness({galacticLibraryExtensionId:'b'.repeat(32)});let release;const pending=new Promise(resolve=>release=resolve);ui.config.respond=message=>message.type==='GET_STATUS'?{ok:true,apiVersion:1,capabilities:{entitlementReminders:true}}:pending;
  const load=ui.click('#load-reminders');await new Promise(resolve=>setTimeout(resolve,5));await ui.click('#remove-galactic');release({ok:true,apiVersion:1,total:0,nextOffset:null,reminders:[]});await load;assert.equal(ui.get('#reminder-list').children.length,0);assert.match(ui.get('#reminder-status').textContent,/have not been checked/);assert.equal(ui.get('#load-reminders').disabled,false);
});


test('wishlist priority editing and restore are validated, confirmed and independent of ownership',async()=>{
  const ui=await optionsHarness({fanaticalLibraryItems:[item('Owned')],fanaticalWishlistItems:[{title:'Keep wish',mediaType:'book',weight:1}]});
  const before=structuredClone(ui.stored.fanaticalLibraryItems),priority=ui.get('#wishlist-list').children[0].children[1];priority.value='9';await priority.listeners.change();assert.equal(ui.stored.fanaticalWishlistItems[0].weight,9);
  const input=ui.get('#wishlist-file'),upload=async list=>{input.files=[{size:100,text:async()=>JSON.stringify({wishlist:list})}];await input.listeners.change();};
  await upload([{title:'Bad wish',mediaType:'book',weight:0}]);assert.equal(ui.stored.fanaticalWishlistItems[0].weight,9);assert.match(ui.get('#wishlist-status').textContent,/failed/);
  ui.config.confirm=false;await upload([{title:'Replacement',mediaType:'game',weight:2}]);assert.equal(ui.stored.fanaticalWishlistItems[0].title,'Keep wish');
  ui.config.confirm=true;await upload([{title:'Replacement',mediaType:'game',weight:2}]);assert.equal(ui.stored.fanaticalWishlistItems[0].title,'Replacement');assert.deepEqual(ui.stored.fanaticalLibraryItems,before);
});
