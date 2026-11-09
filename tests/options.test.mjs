import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { localKeyReminders, backupRestoreState, createLibraryBackup, parseLibraryBackup, createSyncStore, createTitleCatalog } from '../src/library-data.mjs';
import '../src/shared.js';

const code = fs.readFileSync(new URL('../src/options.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/u, '');
const item = (title, id = 'product-123456') => ({ source: 'fanatical', sourceItemId: id, title, mediaType: 'game', bundle: { sourceItemId: 'bundle-123456', title: 'Test bundle' }, purchaseDate: null });

async function optionsHarness(initial = {}) {
  const stored = structuredClone(initial); const writes = []; const messages = []; const nodes = new Map();const storageListeners=[];
  let accountChanged;
  const sessionData = new Map();
  const sessionStorage = {
    getItem(key) { return sessionData.get(key) ?? null; },
    setItem(key, value) { sessionData.set(key, String(value)); },
    removeItem(key) { sessionData.delete(key); },
    clear() { sessionData.clear(); }
  };
  const element = () => ({ textContent: '', value: '', checked: false, disabled: false, files: [], children: [], listeners: {}, addEventListener(type, handler) { this.listeners[type] = handler; }, replaceChildren(...children) { this.children = children; }, append(...children) {this.children.push(...children);}, setAttribute(name,value) {this[name]=value;}, click() {} });
  const get = (selector) => { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); };
  const config = { confirm: true, response: { ok: true, apiVersion: 1, appVersion: '0.1.0' }, failure: false };
  const context = vm.createContext({
    document: { querySelector: get, createElement: element },
    sessionStorage,
    chrome: { runtime: { id: 'a'.repeat(32), async sendMessage(id, message) { messages.push({ id, message }); if (config.failure) throw new Error('PRIVATE transport failure'); return config.respond ? config.respond(message) : config.response; } }, storage: {onChanged:{addListener:fn=>storageListeners.push(fn)}, local: {
      async get(defaults) { return { ...defaults, ...stored }; },
      async set(value) { writes.push(structuredClone(value)); Object.assign(stored, structuredClone(value)); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; }
    } }, tabs: { create() {} } },
    confirm: () => config.confirm, LibraryTitleSort:globalThis.LibraryTitleSort, LibraryAccountProfiles:{mount(host,options){accountChanged=options.onActiveChange;return {refresh:async()=>{}};}}, FanaticalLibrary: globalThis.FanaticalLibrary,
    localKeyReminders, backupRestoreState, createLibraryBackup, parseLibraryBackup, createTitleCatalog, Blob, URL, setTimeout, clearTimeout, Intl
  });
  const store=createSyncStore(context.chrome.storage.local);const oldSend=context.chrome.runtime.sendMessage;
  context.chrome.runtime.sendMessage=async (...args)=>{const message=args[0];if(message?.type!=='FANATICAL_STORE')return oldSend(...args);try{return {ok:true,result:await store.execute(message.operation,message.args)};}catch(error){return {ok:false,error:error.message};}};
  await vm.runInContext(code, context);
  return { stored, writes, messages, get, config, context, sessionData,
    accountChanged:()=>accountChanged(),
    changeStorage:(changes,area='local')=>Promise.all(storageListeners.map(fn=>fn(changes,area))),
    async click(selector) { await get(selector).listeners.click?.(); },
    async input(selector, val) { const el = get(selector); el.value = val; await el.listeners.input?.(); },
    async change(selector, val) { const el = get(selector); if (val !== undefined) el.value = val; await el.listeners.change?.(); },
    async upload(value, raw = false) {
      const contents = raw ? value : JSON.stringify(value);
      get('#import-file').files = [{ size: contents.length, text: async () => contents }];
      await get('#import-file').listeners.change();
    }
  };
}

test('already-open Library refreshes committed partial purchases coherently without overwriting settings drafts',async()=>{
 const ui=await optionsHarness();assert.match(ui.get('#library-count').textContent,/0 unique items/);ui.get('#galactic-id').value='unsaved setting';ui.get('#summary-position').value='bottom-left';
 const items=Array.from({length:24},(_,i)=>item('Synthetic '+i,'product-'+String(i).padStart(6,'0')));
 Object.assign(ui.stored,{fanaticalLibraryItems:items,fanaticalProfileLabel:'Default account',fanaticalProfileArchives:[],fanaticalLastScanAttempt:{status:'partial',verifiedPurchasesSaved:3,unresolvedOrders:3,discoveryComplete:false},fanaticalImportSummary:null});
 await ui.changeStorage({fanaticalLibraryItems:{newValue:items}},'sync');assert.match(ui.get('#library-count').textContent,/0 unique items/);
 await ui.changeStorage({fanaticalLibraryItems:{newValue:items},fanaticalProfileLabel:{newValue:'Default account'}});
 assert.match(ui.get('#library-count').textContent,/Default account.*24 unique items/);assert.match(ui.get('#history-note').textContent,/3 verified purchases saved; 3 purchases unresolved/);assert.match(ui.get('#history-note').textContent,/No complete order-history/);assert.equal(ui.get('#galactic-id').value,'unsaved setting');assert.equal(ui.get('#summary-position').value,'bottom-left');assert.equal(ui.writes.length,0);
 await ui.accountChanged();assert.equal(ui.get('#galactic-id').value,'unsaved setting');assert.equal(ui.get('#summary-position').value,'bottom-left');
 Object.assign(ui.stored,{fanaticalLibraryItems:[],fanaticalProfileLabel:'Separate account'});await ui.changeStorage({fanaticalLibraryItems:{newValue:[]},fanaticalProfileLabel:{newValue:'Separate account'}});assert.match(ui.get('#library-count').textContent,/Separate account.*0 unique items/);
});

test('options preview is bounded, naturally ordered, and displays bundle provenance safely', async () => {
  const ui = await optionsHarness({ fanaticalLibraryItems: [item('Comic #10'), item('Comic #2'), ...Array.from({ length: 50 }, (_, index) => item(`Z ${index}`))] });
  assert.equal(ui.get('#library-preview').children.length, 50);
  assert.deepEqual(ui.get('#library-preview').children.slice(0, 2).map((row) => row.textContent), ['Comic #2 — in 1 bundle', 'Comic #10 — in 1 bundle']);
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
  assert.equal(ui.get('#library-preview').children[0].textContent, 'Restored — in 1 bundle');
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
test('dated unrevealed observations display locally and centrally without implying redemption; profile changes clear stale results',async()=>{
 const product={...item('Steam game'),purchaseOrigins:[{purchaseRef:'a'.repeat(64),bundle:{sourceItemId:'bundle-123456',title:'Bundle'},keyStatus:'unrevealed',keyCheckedAt:'2026-11-09T12:00:00.000Z'}]},ui=await optionsHarness({fanaticalLibraryItems:[product],galacticLibraryExtensionId:'b'.repeat(32)});assert.match(ui.get('#local-key-status').textContent,/1 active purchase reminder/);
 ui.config.respond=message=>message.type==='GET_STATUS'?{ok:true,apiVersion:1,capabilities:{entitlementReminders:true}}:{ok:true,apiVersion:1,total:1,nextOffset:null,reminders:[{reminderRef:'opaque-reminder',itemRef:'opaque-item',title:'Steam game',provider:'fanatical',mediaType:'game',kind:'activation',dueAt:null,severity:'information',keyStatus:'unrevealed',keyCheckedAt:'2026-11-09T12:00:00.000Z'}]};ui.get('#reminder-provider').value='fanatical';await ui.click('#load-reminders');assert.match(ui.get('#reminder-list').children[0].textContent,/Key reported unrevealed/);assert.match(ui.get('#reminder-list').children[0].textContent,/Activation on Steam is not verified/);await ui.changeStorage({fanaticalProfileLabel:{newValue:'Other'}});assert.equal(ui.get('#reminder-list').children.length,0);assert.equal(ui.writes.length,0);
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

test('options library search filters items by title case-insensitively', async () => {
  const ui = await optionsHarness({
    fanaticalLibraryItems: [
      { ...item('Alpha Game'), mediaType: 'game' },
      { ...item('Beta Guide'), mediaType: 'book' },
      { ...item('Gamma Tool'), mediaType: 'software' }
    ]
  });

  assert.equal(ui.get('#library-preview').children.length, 3);
  await ui.input('#library-search', 'beta');
  assert.equal(ui.get('#library-preview').children.length, 1);
  assert.equal(ui.get('#library-preview').children[0].textContent, 'Beta Guide — in 1 bundle');
  assert.match(ui.get('#preview-note').textContent, /Showing 1 of 1 items \(filtered from 3\)/);

  await ui.input('#library-search', 'NOMATCH');
  assert.equal(ui.get('#library-preview').children.length, 0);
  assert.match(ui.get('#preview-note').textContent, /No items match your search or filter criteria/);

  await ui.input('#library-search', '');
  assert.equal(ui.get('#library-preview').children.length, 3);
});

test('options library media filter isolates books, games, software, and audiobooks', async () => {
  const ui = await optionsHarness({
    fanaticalLibraryItems: [
      { ...item('Game One'), mediaType: 'game' },
      { ...item('Book One'), mediaType: 'book' },
      { ...item('Software One'), mediaType: 'software' },
      { ...item('Audiobook One'), mediaType: 'audiobook' }
    ]
  });

  assert.equal(ui.get('#library-preview').children.length, 4);

  await ui.change('#library-filter-media', 'game');
  assert.equal(ui.get('#library-preview').children.length, 1);
  assert.match(ui.get('#library-preview').children[0].textContent, /Game One/);

  await ui.change('#library-filter-media', 'book');
  assert.equal(ui.get('#library-preview').children.length, 1);
  assert.match(ui.get('#library-preview').children[0].textContent, /Book One/);

  await ui.change('#library-filter-media', 'software');
  assert.equal(ui.get('#library-preview').children.length, 1);
  assert.match(ui.get('#library-preview').children[0].textContent, /Software One/);

  await ui.change('#library-filter-media', 'audiobook');
  assert.equal(ui.get('#library-preview').children.length, 1);
  assert.match(ui.get('#library-preview').children[0].textContent, /Audiobook One/);

  await ui.change('#library-filter-media', '');
  assert.equal(ui.get('#library-preview').children.length, 4);
});

test('options library metadata filter isolates dated, bundle, steam, drm-free, and multi-origin items', async () => {
  const ui = await optionsHarness({
    fanaticalLibraryItems: [
      { ...item('Dated Item'), purchaseDate: '2026-05-01' },
      { ...item('Standalone Item'), bundle: null },
      { ...item('Steam DRM Item'), drm: 'steam' },
      { ...item('DRM Free Item'), drm: 'drm-free' },
      { ...item('Multi Origin Item'), purchaseOrigins: [{ orderId: 'o1' }, { orderId: 'o2' }] }
    ]
  });

  await ui.change('#library-filter-metadata', 'dated');
  assert.equal(ui.get('#library-preview').children.length, 1);
  assert.equal(ui.get('#library-preview').children[0].textContent, 'Dated Item — in 1 bundle');
  assert.match(ui.get('#library-preview').children[0].children[0].children[1].children[0].textContent, /2026-05-01/);

  await ui.change('#library-filter-metadata', 'bundle');
  assert.equal(ui.get('#library-preview').children.length, 4);

  await ui.change('#library-filter-metadata', 'steam');
  assert.equal(ui.get('#library-preview').children.length, 1);
  assert.match(ui.get('#library-preview').children[0].textContent, /Steam DRM Item/);

  await ui.change('#library-filter-metadata', 'drm-free');
  assert.equal(ui.get('#library-preview').children.length, 1);
  assert.match(ui.get('#library-preview').children[0].textContent, /DRM Free Item/);

  await ui.change('#library-filter-metadata', 'multi-origin');
  assert.equal(ui.get('#library-preview').children.length, 1);
  assert.equal(ui.get('#library-preview').children[0].textContent, 'Multi Origin Item — in 1 bundle');
  assert.equal(ui.get('#library-preview').children[0].children[0].children[1].children.length, 2);
});

test('options library sorting supports title A-Z, title Z-A, date newest, and date oldest', async () => {
  const ui = await optionsHarness({
    fanaticalLibraryItems: [
      { ...item('Beta Game'), purchaseDate: '2026-01-15' },
      { ...item('Alpha Game'), purchaseDate: '2026-08-20' },
      { ...item('Gamma Game'), purchaseDate: null }
    ]
  });

  // Default: title-asc
  assert.deepEqual(
    ui.get('#library-preview').children.map((r) => r.textContent.split(' — ')[0]),
    ['Alpha Game', 'Beta Game', 'Gamma Game']
  );

  // title-desc
  await ui.change('#library-sort', 'title-desc');
  assert.deepEqual(
    ui.get('#library-preview').children.map((r) => r.textContent.split(' — ')[0]),
    ['Gamma Game', 'Beta Game', 'Alpha Game']
  );
  assert.match(ui.get('#preview-note').textContent, /reverse alphabetically/);

  // date-desc (newest first, undated at end)
  await ui.change('#library-sort', 'date-desc');
  assert.deepEqual(
    ui.get('#library-preview').children.map((r) => r.textContent.split(' — ')[0]),
    ['Alpha Game', 'Beta Game', 'Gamma Game']
  );
  assert.match(ui.get('#preview-note').textContent, /by purchase date \(newest\)/);

  // date-asc (oldest first, undated at end)
  await ui.change('#library-sort', 'date-asc');
  assert.deepEqual(
    ui.get('#library-preview').children.map((r) => r.textContent.split(' — ')[0]),
    ['Beta Game', 'Alpha Game', 'Gamma Game']
  );
  assert.match(ui.get('#preview-note').textContent, /by purchase date \(oldest\)/);
});

test('options library pagination handles selectable page sizes, previous/next, and out-of-bounds clamping', async () => {
  const items = Array.from({ length: 55 }, (_, i) => item(`Product ${String(i).padStart(2, '0')}`, `prod-${i}`));
  const ui = await optionsHarness({ fanaticalLibraryItems: items });

  // Default: 50 items per page
  assert.equal(ui.get('#library-preview').children.length, 50);
  assert.equal(ui.get('#library-previous').disabled, true);
  assert.equal(ui.get('#library-next').disabled, false);
  assert.match(ui.get('#preview-note').textContent, /Showing 50 of 55 items \(page 1 of 2\)/);

  await ui.click('#library-next');
  assert.equal(ui.get('#library-preview').children.length, 5);
  assert.equal(ui.get('#library-previous').disabled, false);
  assert.equal(ui.get('#library-next').disabled, true);
  assert.match(ui.get('#preview-note').textContent, /Showing 5 of 55 items \(page 2 of 2\)/);

  await ui.click('#library-previous');
  assert.equal(ui.get('#library-preview').children.length, 50);

  // Change page size to 20
  await ui.change('#library-page-size', '20');
  assert.equal(ui.get('#library-preview').children.length, 20);
  assert.match(ui.get('#preview-note').textContent, /Showing 20 of 55 items \(page 1 of 3\)/);

  // Change page size to 100
  await ui.change('#library-page-size', '100');
  assert.equal(ui.get('#library-preview').children.length, 55);
  assert.equal(ui.get('#library-previous').disabled, true);
  assert.equal(ui.get('#library-next').disabled, true);
});

test('options library browser preserves state in sessionStorage and restores upon re-render', async () => {
  const ui = await optionsHarness({
    fanaticalLibraryItems: [
      item('Alpha One'),
      item('Beta Two'),
      item('Gamma Three')
    ]
  });

  await ui.input('#library-search', 'Two');
  await ui.change('#library-sort', 'title-desc');
  await ui.change('#library-page-size', '20');

  // Verify sessionStorage has saved the state
  const rawSession = ui.sessionData.get('fan_library_browser_state');
  assert(rawSession);
  const parsed = JSON.parse(rawSession);
  assert.equal(parsed.search, 'Two');
  assert.equal(parsed.sort, 'title-desc');
  assert.equal(parsed.pageSize, 20);

  // Re-render via LibraryBrowser.render
  ui.context.LibraryBrowser.render();
  assert.equal(ui.get('#library-preview').children.length, 1);
  assert.equal(ui.get('#library-search').value, 'Two');
  assert.equal(ui.get('#library-sort').value, 'title-desc');
  assert.equal(ui.get('#library-page-size').value, '20');
});

test('exact duplicate library items consolidate into one row with expandable provenance details', async () => {
  const ui = await optionsHarness({
    fanaticalLibraryItems: [
      {
        source: 'fanatical',
        sourceItemId: 'product-game-1',
        title: 'Exact Game',
        mediaType: 'game',
        bundle: { sourceItemId: 'bundle-1', title: 'First Bundle' },
        purchaseDate: '2026-01-15T00:00:00Z',
        purchaseOrigins: [{
          bundle: { sourceItemId: 'bundle-1', title: 'First Bundle' },
          purchaseDate: '2026-01-15T00:00:00Z',
          purchaseRef: 'a'.repeat(64),
          quantity: 1,
          drm: ['steam']
        }],
        drm: ['steam']
      },
      {
        source: 'fanatical',
        sourceItemId: 'product-game-1',
        title: 'Exact Game',
        mediaType: 'game',
        bundle: { sourceItemId: 'bundle-2', title: 'Second Bundle' },
        purchaseDate: '2026-06-20T00:00:00Z',
        purchaseOrigins: [{
          bundle: { sourceItemId: 'bundle-2', title: 'Second Bundle' },
          purchaseDate: '2026-06-20T00:00:00Z',
          purchaseRef: 'b'.repeat(64),
          quantity: 2,
          drm: ['steam']
        }],
        drm: ['steam']
      }
    ]
  });

  const preview = ui.get('#library-preview');
  // Both purchases consolidate into 1 exact library row
  assert.equal(preview.children.length, 1);
  const row = preview.children[0];
  assert.equal(row.textContent, 'Exact Game — in 2 bundles');

  // Expandable details element
  assert.equal(row.children.length, 1);
  const details = row.children[0];
  assert.equal(details.className, 'library-item-details');
  const summary = details.children[0];
  assert.equal(summary.className, 'library-item-summary');
  assert.equal(summary.textContent, 'Exact Game — in 2 bundles');

  // Provenance list shows both individual purchases ordered newest first
  const list = details.children[1];
  assert.equal(list.className, 'library-provenance-list');
  assert.equal(list.children.length, 2);
  assert.match(list.children[0].textContent, /Bundle: Second Bundle · Purchased: 2026-06-20 · Qty: 2 · Ref: b{16}… · DRM: steam/);
  assert.match(list.children[1].textContent, /Bundle: First Bundle · Purchased: 2026-01-15 · Ref: a{16}… · DRM: steam/);
});

test('distinct bundle counting preserves repeated purchases from the same bundle', async () => {
  const ui = await optionsHarness({
    fanaticalLibraryItems: [
      {
        source: 'fanatical',
        sourceItemId: 'p-1',
        title: 'Saga Vol. 1',
        mediaType: 'book',
        bundle: { title: 'Comic Legends Bundle' },
        purchaseDate: '2022-03-01T00:00:00Z',
        purchaseRef: 'a'.repeat(64),
        quantity: 1
      },
      {
        source: 'fanatical',
        sourceItemId: 'p-1',
        title: 'Saga Vol. 1',
        mediaType: 'book',
        bundle: { title: 'Comic Legends Bundle' },
        purchaseDate: '2024-08-15T00:00:00Z',
        purchaseRef: 'b'.repeat(64),
        quantity: 1
      }
    ]
  });

  const preview = ui.get('#library-preview');
  assert.equal(preview.children.length, 1);
  const row = preview.children[0];
  // Since both purchases are from the same bundle, count is 1 bundle
  assert.equal(row.textContent, 'Saga Vol. 1 — in 1 bundle');

  // Both individual purchases remain accessible in expanded details
  const details = row.children[0];
  const list = details.children[1];
  assert.equal(list.children.length, 2);
  assert.match(list.children[0].textContent, /Purchased: 2024-08-15/);
  assert.match(list.children[1].textContent, /Purchased: 2022-03-01/);
});

test('purchase history sorting orders purchases newest first with undated records last', async () => {
  const ui = await optionsHarness({
    fanaticalLibraryItems: [
      {
        source: 'fanatical',
        sourceItemId: 'p-multi',
        title: 'Saga Vol. 1',
        mediaType: 'book',
        purchaseOrigins: [
          { bundle: { title: 'Bundle 2022 A' }, purchaseDate: '2022-01-10T00:00:00Z', purchaseRef: 'ref-1' },
          { bundle: { title: 'Bundle 2025' }, purchaseDate: '2025-06-01T00:00:00Z', purchaseRef: 'ref-2' },
          { bundle: { title: 'Bundle 2022 B' }, purchaseDate: '2022-09-15T00:00:00Z', purchaseRef: 'ref-3' },
          { bundle: { title: 'Bundle 2023' }, purchaseDate: '2023-11-20T00:00:00Z', purchaseRef: 'ref-4' },
          { bundle: { title: 'Undated Bundle' }, purchaseDate: null, purchaseRef: 'ref-5' }
        ]
      }
    ]
  });

  const preview = ui.get('#library-preview');
  assert.equal(preview.children.length, 1);
  const row = preview.children[0];
  assert.equal(row.textContent, 'Saga Vol. 1 — in 5 bundles');

  const list = row.children[0].children[1];
  assert.equal(list.children.length, 5);
  // Newest first: 2025, 2023, 2022-09, 2022-01, undated last
  assert.match(list.children[0].textContent, /Bundle: Bundle 2025 · Purchased: 2025-06-01/);
  assert.match(list.children[1].textContent, /Bundle: Bundle 2023 · Purchased: 2023-11-20/);
  assert.match(list.children[2].textContent, /Bundle: Bundle 2022 B · Purchased: 2022-09-15/);
  assert.match(list.children[3].textContent, /Bundle: Bundle 2022 A · Purchased: 2022-01-10/);
  assert.match(list.children[4].textContent, /Bundle: Undated Bundle/);
  assert.doesNotMatch(list.children[4].textContent, /Purchased:/);
});

test('different editions, versions, and volumes remain separate and are not consolidated', async () => {
  const ui = await optionsHarness({
    fanaticalLibraryItems: [
      { source: 'fanatical', sourceItemId: 'p-1', title: 'Hero Comic', edition: 'Standard Edition', mediaType: 'book', bundle: { title: 'Bundle A' }, purchaseDate: null },
      { source: 'fanatical', sourceItemId: 'p-2', title: 'Hero Comic', edition: 'Deluxe Edition', mediaType: 'book', bundle: { title: 'Bundle B' }, purchaseDate: null },
      { source: 'fanatical', sourceItemId: 'p-3', title: 'Saga Series', volume: '1', mediaType: 'book', bundle: { title: 'Bundle C' }, purchaseDate: null },
      { source: 'fanatical', sourceItemId: 'p-4', title: 'Saga Series', volume: '2', mediaType: 'book', bundle: { title: 'Bundle D' }, purchaseDate: null },
      { source: 'fanatical', sourceItemId: 'p-5', title: 'Adventure Game', mediaType: 'game', bundle: { title: 'Bundle E' }, purchaseDate: null },
      { source: 'fanatical', sourceItemId: 'p-6', title: 'Adventure Game', mediaType: 'book', bundle: { title: 'Bundle F' }, purchaseDate: null }
    ]
  });

  const preview = ui.get('#library-preview');
  // Different editions, volumes, and media types must remain distinct items
  assert.equal(preview.children.length, 6);
  const note = ui.get('#preview-note').textContent;
  assert.match(note, /Showing 6 of 6 items/);
});

test('incomplete or missing provenance is handled gracefully', async () => {
  const ui = await optionsHarness({
    fanaticalLibraryItems: [
      { source: 'fanatical', sourceItemId: 'p-manual', title: 'Manual Book Without Provenance', mediaType: 'book' },
      { source: 'fanatical', sourceItemId: 'p-partial', title: 'Item With Partial Provenance', mediaType: 'game', bundle: { title: '' }, purchaseDate: null }
    ]
  });

  const preview = ui.get('#library-preview');
  assert.equal(preview.children.length, 2);

  const manualRow = preview.children.find((r) => r.textContent.includes('Manual Book Without Provenance'));
  assert(manualRow);
  assert.equal(manualRow.textContent, 'Manual Book Without Provenance — manual entry');
  const manualDetails = manualRow.children[0];
  assert.equal(manualDetails.className, 'library-item-details');
  assert.equal(manualDetails.children[0].textContent, 'Manual Book Without Provenance — manual entry');
  assert.equal(manualDetails.children[1].textContent, 'No bundle or purchase record stored.');
});

test('src/ui.css configures library-preview with 4.25rem padding-left to prevent clipping 3-5 digit item numbers', () => {
  const css = fs.readFileSync(new URL('../src/ui.css', import.meta.url), 'utf8');
  assert.match(css, /#library-preview\s*\{[^}]*padding-left:\s*4\.25rem/);
});

test('expanded purchase history displays primary bundle title and secondary metadata line', async () => {
  const ui = await optionsHarness({
    fanaticalLibraryItems: [
      {
        source: 'fanatical',
        sourceItemId: 'p-polish',
        title: 'Polished Game',
        mediaType: 'game',
        bundle: { title: 'Strategy Bundle 2026' },
        purchaseDate: '2026-05-12T00:00:00Z',
        purchaseRef: 'fan-order-1234567890abcdef',
        quantity: 2,
        drm: ['steam']
      }
    ]
  });

  const preview = ui.get('#library-preview');
  const row = preview.children[0];
  const details = row.children[0];
  const list = details.children[1];
  assert.equal(list.children.length, 1);
  const provItem = list.children[0];
  assert.equal(provItem.className, 'library-provenance-item');

  const primary = provItem.children.find((c) => c.className === 'library-provenance-primary');
  assert(primary, 'should have primary line');
  assert.equal(primary.textContent, 'Bundle: Strategy Bundle 2026');

  const secondary = provItem.children.find((c) => c.className === 'library-provenance-secondary');
  assert(secondary, 'should have secondary line');
  assert.equal(secondary.textContent, 'Purchased: 2026-05-12 · Qty: 2 · Ref: fan-order-123456… · DRM: steam');
});

test('src/ui.css configures tabular numbers and comfortable disclosure spacing', () => {
  const css = fs.readFileSync(new URL('../src/ui.css', import.meta.url), 'utf8');
  assert.match(css, /#library-preview\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  assert.match(css, /#library-preview\s+li::marker\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  assert.match(css, /\.library-item-summary\s*\{[^}]*margin-left:\s*0\.35rem/);
  assert.match(css, /\.library-item-summary\s*\{[^}]*padding:\s*0\.15rem\s+0\s+0\.15rem\s+0\.35rem/);
  assert.match(css, /\.library-provenance-primary\s*\{/);
  assert.match(css, /\.library-provenance-secondary\s*\{/);
});

test('FAN-only local reminder controls need no GL and stale rendered buttons cannot target another account',async()=>{
 const account='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',product={...item('Local Steam game'),purchaseOrigins:[{purchaseRef:'a'.repeat(64),bundle:{sourceItemId:'bundle-123456',title:'Bundle'},keyStatus:'unrevealed',keyCheckedAt:'2026-11-09T12:00:00.000Z',quantity:1}]};
 const ui=await optionsHarness({fanaticalAccountId:account,fanaticalLibraryItems:[product],fanaticalProfileLabel:'A'});ui.config.failure=true;assert.equal(ui.get('#local-reminder-list').children.length,1);const stale=ui.get('#local-reminder-list').children[0].children[1];const calls=ui.messages.length;await stale.listeners.click();assert.equal(ui.get('#local-reminder-list').children.length,0,ui.get('#local-reminder-action-status').textContent);assert.equal(ui.messages.length,calls);assert.equal(ui.stored.fanaticalLibraryItems[0].mediaType,'game');
 await ui.change('#local-reminder-filter','hidden');await ui.get('#local-reminder-list').children[0].children[1].listeners.click();assert.equal(ui.stored.fanaticalLibraryItems[0].purchaseOrigins[0].keyReview.action,'active');await ui.change('#local-reminder-filter','pending');const oldButton=ui.get('#local-reminder-list').children[0].children[1];
 ui.stored.fanaticalAccountId=other;ui.stored.fanaticalLibraryItems=[product];await ui.changeStorage({fanaticalAccountId:{newValue:other},fanaticalLibraryItems:{newValue:[product]}});await oldButton.listeners.click();assert.match(ui.get('#local-reminder-action-status').textContent,/account changed/);assert.equal(ui.stored.fanaticalLibraryItems[0].purchaseOrigins[0].keyReview,undefined);
});
test('local reminder list is paginated and separates unknown evidence from actionable unrevealed keys',async()=>{
 const products=Array.from({length:52},(_,i)=>({...item('Game '+i,'product-'+String(i).padStart(6,'0')),purchaseOrigins:[{purchaseRef:'a'.repeat(64),bundle:{sourceItemId:'bundle-123456',title:'Bundle'},keyStatus:i===51?'unknown':'unrevealed',keyCheckedAt:'2026-11-09T12:00:00.000Z'}]}));const ui=await optionsHarness({fanaticalLibraryItems:products});assert.equal(ui.get('#local-reminder-list').children.length,50);await ui.click('#local-reminder-next');assert.equal(ui.get('#local-reminder-list').children.length,1);await ui.change('#local-reminder-filter','unknown');assert.equal(ui.get('#local-reminder-list').children.length,1);assert.match(ui.get('#local-reminder-list').children[0].children[0].textContent,/status unknown/);
});
