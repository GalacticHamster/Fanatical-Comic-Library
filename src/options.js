import { backupRestoreState, createLibraryBackup, parseLibraryBackup, createTitleCatalog } from './library-data.mjs';

(async function options() {
  async function mutate(operation,...args){const result=await chrome.runtime.sendMessage({type:'FANATICAL_STORE',operation,args});if(!result?.ok)throw new Error(result?.error??'Library storage is unavailable.');return result.result;}
  const $ = (selector) => document.querySelector(selector);
  const linkSaved = 'Link saved. In Galactic Library, allow the Fanatical Library extension ID shown above.';
  let libraryBusy = false,wishlist=[],wishlistPage=0;
  function renderWishlist(){
    const filtered=wishlist.filter(item=>item.title.toLowerCase().includes($("#wishlist-search").value.toLowerCase())).sort((a,b)=>b.weight-a.weight||a.title.localeCompare(b.title));wishlistPage=Math.min(wishlistPage,Math.max(0,Math.ceil(filtered.length/50)-1));$("#wishlist-count").textContent=`${filtered.length} wishes; page ${wishlistPage+1} of ${Math.max(1,Math.ceil(filtered.length/50))}.`;$("#wishlist-previous").disabled=wishlistPage===0;$("#wishlist-next").disabled=(wishlistPage+1)*50>=filtered.length;
    $("#wishlist-list").replaceChildren(...filtered.slice(wishlistPage*50,wishlistPage*50+50).map(item=>{const row=document.createElement("li"),remove=document.createElement("button");row.textContent=`${item.title} (${item.mediaType}); weight ${item.weight} `;remove.type="button";remove.textContent="Remove wish";remove.addEventListener("click",async()=>{try{wishlist=await mutate("wishlist","remove",FanaticalLibrary.wishlistKey(item));renderWishlist();}catch(error){$("#wishlist-status").textContent=error.message;}});row.append(remove);return row;}));
  }

  let reminderGeneration=0,reminderNext=null,reminderHistory=[];
  function resetReminders(){reminderGeneration++;reminderNext=null;reminderHistory=[];$('#reminder-list').replaceChildren();$('#reminder-status').textContent='Reminders have not been checked.';$('#reminder-previous').disabled=$('#reminder-next').disabled=true;$('#load-reminders').disabled=false;}
  async function loadReminders(offset=0,history=[]){
    const generation=++reminderGeneration,provider=$('#reminder-provider').value;$('#load-reminders').disabled=$('#reminder-previous').disabled=$('#reminder-next').disabled=true;$('#reminder-status').textContent='Loading central reminders...';$('#reminder-list').replaceChildren();
    try{
      const {galacticLibraryExtensionId:id=''}=await chrome.storage.local.get({galacticLibraryExtensionId:''});if(!FanaticalLibrary.isExtensionId(id))throw Error('Save a Galactic Library link first.');
      const page=await FanaticalLibrary.loadCentralReminders(message=>chrome.runtime.sendMessage(id,message),{provider,offset,limit:50});
      const current=await chrome.storage.local.get({galacticLibraryExtensionId:''});if(generation!==reminderGeneration||current.galacticLibraryExtensionId!==id)return;
      reminderNext=page.nextOffset;reminderHistory=history;$('#reminder-status').textContent=page.total&&page.reminders.length?`${page.total} reported reminders; showing ${offset+1}-${offset+page.reminders.length}.`:'No current reminders reported by Galactic Library. This is not proof of activation or permanent ownership.';
      const labels={activation:'Activation needs confirmation','key-expiry':'Key expiry','key-unavailable':'Key unavailable','access-expiry':'Access expiry','temporary-access':'Temporary access; expiry unknown'};
      $('#reminder-list').replaceChildren(...page.reminders.map(row=>{const li=document.createElement('li');li.textContent=`${row.title} (${row.provider}): ${labels[row.kind]}; ${row.dueAt||'deadline not reported'}; ${row.severity}.`;if(row.source==='humble-companion')li.textContent+=' Humble companion report; review in Humble or Galactic Library.';return li;}));
      $('#reminder-previous').disabled=!history.length;$('#reminder-next').disabled=reminderNext===null;
    }catch(error){if(generation!==reminderGeneration)return;reminderNext=null;reminderHistory=[];$('#reminder-status').textContent='Reminders not checked: '+error.message;}
    finally{if(generation===reminderGeneration)$('#load-reminders').disabled=false;}
  }
  $('#load-reminders').addEventListener('click',()=>loadReminders());
  $('#reminder-provider').addEventListener('change',resetReminders);
  $('#reminder-next').addEventListener('click',()=>loadReminders(reminderNext,[...reminderHistory,reminderNext-50]));
  $('#reminder-previous').addEventListener('click',()=>loadReminders(reminderHistory.at(-1),reminderHistory.slice(0,-1)));
  $('#review-reminders').addEventListener('click',async()=>{try{const response=await chrome.runtime.sendMessage({type:'FANATICAL_OPEN_GALACTIC_REVIEW'});if(!response?.ok)throw Error('Save and check your Galactic Library link first.');}catch{$('#reminder-status').textContent='Could not open Galactic Library. Save and check the link first.';}});
  chrome.storage.onChanged?.addListener((changes,area)=>{if(area==='local'&&changes.galacticLibraryExtensionId)resetReminders();});

  function setLibraryBusy(busy) {
    libraryBusy = busy;
    for (const selector of ['#import-file', '#export', '#export-catalog', '#reset']) $(selector).disabled = busy;
  }

  async function refresh() {
    const {
      fanaticalImportSummary: summary = null,
      fanaticalLibraryItems: items = [],
      galacticLibraryExtensionId: extensionId = '',
      fanaticalShowDiagnostics: diagnostics = false,
      fanaticalLastScanAttempt: attempt = null
    } = await chrome.storage.local.get({ fanaticalImportSummary: null, fanaticalLibraryItems: [], galacticLibraryExtensionId: '', fanaticalShowDiagnostics: false, fanaticalLastScanAttempt: null });
    $('#last-import').textContent = summary
      ? `Last ${summary.scanMode === 'full' ? 'full' : 'quick'} scan: ${summary.addedProducts} item${summary.addedProducts === 1 ? '' : 's'} added; ${summary.ordersScanned} order${summary.ordersScanned === 1 ? '' : 's'} scanned${summary.ordersSkipped ? ` and ${summary.ordersSkipped} already-scanned order${summary.ordersSkipped === 1 ? '' : 's'} skipped` : ''} on ${new Date(summary.importedAt).toLocaleString()}.`
      : 'No Fanatical import has run yet.';
    const scope=await chrome.storage.local.get({fanaticalProfileLabel:'',fanaticalProfileArchives:[],fanaticalHistoricalItems:[]});
    $('#library-count').textContent = `Active profile: ${scope.fanaticalProfileLabel||'unassigned'}. ${scope.fanaticalProfileArchives.length} other profile archives (backup only). ${items.length} unique item${items.length === 1 ? '' : 's'} stored locally.`;
    const missing=scope.fanaticalHistoricalItems.filter(entry=>entry.profileLabel===scope.fanaticalProfileLabel).length;
    if(missing) $('#library-count').textContent += ' '+missing+' previously recorded products are missing from the current snapshot; these warn as Check ownership and do not prove ownership.';
    $('#history-note').textContent = `${attempt?.status === 'incomplete' ? 'Last scan incomplete: complete order-history coverage could not be confirmed. Previous purchases and the last successful scan were kept. ' : ''}${summary?.historyCoverage ?? 'No order-history coverage has been checked yet.'}`;
    if (diagnostics && summary?.coverage) $('#history-note').textContent += ` ${summary.coverage.retries} retries; at most ${summary.coverage.concurrency} concurrent detail requests.`;
    $('#galactic-id').value = extensionId;
    $('#galactic-status').textContent = extensionId ? linkSaved : 'No Galactic Library link configured.';
    $('#fanatical-extension-id').textContent = chrome.runtime.id;
    $('#show-diagnostics').checked = Boolean(diagnostics);
    const wishes=await chrome.storage.local.get({fanaticalWishlistItems:[]});wishlist=FanaticalLibrary.normalizeWishlist(wishes.fanaticalWishlistItems);renderWishlist();
    const counts = new Map();
    for (const item of items) counts.set(item.mediaType || 'other', (counts.get(item.mediaType || 'other') || 0) + 1);
    if (counts.size) $('#library-count').textContent += ` ${[...counts].sort().map(([kind, total]) => `${total} ${kind}`).join(', ')}.`;
    const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    $('#library-preview').replaceChildren(...[...items].sort((a, b) => collator.compare(a.title, b.title)).slice(0, 50).map((item) => {
      const row = document.createElement('li'); row.textContent = item.bundle?.title ? `${item.title} — ${item.bundle.title}` : item.title; if(item.purchaseOrigins?.length>1)row.textContent+=` (${item.purchaseOrigins.length} purchase origins)`; return row;
    }));
    $('#preview-note').textContent = items.length ? `Showing ${Math.min(50, items.length)} of ${items.length} items, alphabetically.` : 'Your library is empty. Import purchases or restore a backup to see a preview.';
  }

  $('#import-file').addEventListener('change', async () => {
    const input = $('#import-file'); const file = input.files[0]; if (!file || libraryBusy) return;
    setLibraryBusy(true);
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('Choose a backup smaller than 50 MB.');
      let parsed;
      try { parsed = JSON.parse(await file.text()); } catch { throw new Error('The selected file is not valid JSON.'); }
      const items = parseLibraryBackup(parsed);
      if (!confirm(`Replace your current Fanatical library with ${items.length} unique items from this backup and reset scan history? Export your current library first if you want to keep it.`)) {
        $('#import-status').textContent = 'Restore cancelled. Your library is unchanged.'; return;
      }
      await mutate('restore',parsed);
      await refresh();
      $('#import-status').textContent = `Restored ${items.length} unique items. Scan history reset; your next quick scan will recheck all completed orders.`;
    } catch (error) { $('#import-status').textContent = `Import failed: ${error.message}`; }
    finally { input.value = ''; setLibraryBusy(false); }
  });

  $('#save-galactic').addEventListener('click', async () => {
    const id = $('#galactic-id').value.trim(); const status = $('#galactic-status');
    if (!FanaticalLibrary.isExtensionId(id)) { status.textContent = 'Enter a valid Chrome or Firefox extension ID.'; return; }
    try {
      await mutate('patch',{galacticLibraryExtensionId:id});
      status.textContent = linkSaved;resetReminders();
    } catch { status.textContent = 'Could not save the Galactic Library link.'; }
  });

  $('#test-galactic').addEventListener('click', async () => {
    const id = $('#galactic-id').value.trim(); const button = $('#test-galactic'); const status = $('#galactic-status');
    if (!FanaticalLibrary.isExtensionId(id)) { status.textContent = 'Enter a valid Chrome or Firefox extension ID.'; return; }
    button.disabled = true; status.textContent = 'Testing Galactic Library link…';
    try{
      const capabilities=await FanaticalLibrary.testGalacticLink(message=>chrome.runtime.sendMessage(id,message));
      status.textContent=`Connected to Galactic Library${capabilities.appVersion?' '+capabilities.appVersion:''}. ${capabilities.advertised?'Media: '+(capabilities.mediaTypes.join(', ')||'none')+'; reviewed contents '+(capabilities.reviewedContents?'supported':'unavailable')+'; entitlement reminders '+(capabilities.entitlementReminders?'supported':'unavailable')+'.':'Capabilities not advertised; newer features remain unconfirmed.'}`;
    }catch(error){status.textContent='Could not connect: '+error.message+' Check the extension ID, enable Galactic Library, and allow the Fanatical Library extension ID shown above.';}finally{button.disabled=false;}

  });

  $('#remove-galactic').addEventListener('click', async () => {
    try {
      await mutate('unlink');
      $('#galactic-id').value = ''; $('#galactic-status').textContent = 'Galactic Library link removed.';resetReminders();
    } catch { $('#galactic-status').textContent = 'Could not remove the Galactic Library link.'; }
  });

  $('#show-diagnostics').addEventListener('change', async () => {
    const input = $('#show-diagnostics');
    try { await mutate('patch',{fanaticalShowDiagnostics:input.checked}); }
    catch { input.checked = !input.checked; $('#local-status').textContent = 'Could not save the diagnostics setting.'; }
  });

  $('#add-wish').addEventListener('click',async()=>{try{wishlist=await mutate('wishlist','add',[{title:$('#wishlist-title').value,mediaType:$('#wishlist-media').value,weight:Number($('#wishlist-weight').value)}]);$('#wishlist-status').textContent='Wish saved. Ownership was not changed.';$('#wishlist-title').value='';renderWishlist();}catch(error){$('#wishlist-status').textContent=error.message;}});
  $('#clear-wishlist').addEventListener('click',async()=>{if(!confirm('Clear your local wishlist?'))return;try{wishlist=await mutate('wishlist','replace',[]);renderWishlist();}catch(error){$('#wishlist-status').textContent=error.message;}});
  $('#wishlist-search').addEventListener('input',()=>{wishlistPage=0;renderWishlist();});$('#wishlist-previous').addEventListener('click',()=>{wishlistPage--;renderWishlist();});$('#wishlist-next').addEventListener('click',()=>{wishlistPage++;renderWishlist();});

  $('#open-orders').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.fanatical.com/en/orders' });
  });

  $('#export').addEventListener('click', async () => {
    if (libraryBusy) return;
    setLibraryBusy(true);
    try {
      const backup=await mutate('backup');
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'fanatical-library-export.json'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0);
      $('#local-status').textContent = `Exported ${backup.items.length} local ownership records.`;
    } catch { $('#local-status').textContent = 'Could not export the library.'; }
    finally { setLibraryBusy(false); }
  });

  $('#export-catalog').addEventListener('click',async()=>{
    if(libraryBusy)return;setLibraryBusy(true);
    try{const saved=await chrome.storage.local.get({fanaticalLibraryItems:[]}),catalog=createTitleCatalog(saved.fanaticalLibraryItems),link=document.createElement('a');link.href=URL.createObjectURL(new Blob([JSON.stringify(catalog,null,2)],{type:'application/json'}));link.download='fanatical-title-catalog.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),0);$('#local-status').textContent='Exported catalog titles and identity metadata only; this is not a recoverable ownership backup.';}catch{$('#local-status').textContent='Could not export the title catalog.';}finally{setLibraryBusy(false);}
  });

  $('#reset').addEventListener('click', async () => {
    if (libraryBusy) return;
    if (!confirm('Clear every locally stored Fanatical title, scan history, and import summary?')) return;
    setLibraryBusy(true);
    try {
      await mutate('clear');
      $('#local-status').textContent = 'Library and scan history cleared.';
      await refresh();
    } catch { $('#local-status').textContent = 'Could not clear the library.'; }
    finally { setLibraryBusy(false); }
  });

  try { await refresh(); } catch { $('#local-status').textContent = 'Could not load local library settings. Reload this page and try again.'; }
}());
