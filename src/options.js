import { backupRestoreState, createLibraryBackup, parseLibraryBackup, createTitleCatalog } from './library-data.mjs';

(async function options() {
  async function mutate(operation,...args){const result=await chrome.runtime.sendMessage({type:'FANATICAL_STORE',operation,args});if(!result?.ok)throw new Error(result?.error??'Library storage is unavailable.');return result.result;}
  const $ = (selector) => document.querySelector(selector);
  const linkSaved = 'Override saved. For development builds, allow this extension in Galactic Library Advanced settings, then check the connection.';
  let libraryBusy = false,wishlist=[],wishlistPage=0;
  function renderWishlist(){
    const filtered=wishlist.filter(item=>item.title.toLowerCase().includes($("#wishlist-search").value.toLowerCase())).sort((a,b)=>b.weight-a.weight||globalThis.LibraryTitleSort.compare(a.title,b.title));wishlistPage=Math.min(wishlistPage,Math.max(0,Math.ceil(filtered.length/50)-1));$("#wishlist-count").textContent=`${filtered.length} wishes; page ${wishlistPage+1} of ${Math.max(1,Math.ceil(filtered.length/50))}.`;$("#wishlist-previous").disabled=wishlistPage===0;$("#wishlist-next").disabled=(wishlistPage+1)*50>=filtered.length;
    $("#wishlist-list").replaceChildren(...filtered.slice(wishlistPage*50,wishlistPage*50+50).map(item=>{
      const row=document.createElement('li'),title=document.createElement('span'),priority=document.createElement('input'),remove=document.createElement('button');
      title.className='wish-title';title.textContent=`${item.title} (${item.mediaType})`;
      priority.type='number';priority.min='1';priority.max='100';priority.step='1';priority.value=String(item.weight);priority.title=`Priority for ${item.title}`;priority.setAttribute('aria-label',priority.title);
      priority.addEventListener('change',async()=>{try{wishlist=await mutate('wishlist','add',[{...item,weight:Number(priority.value)}]);renderWishlist();$('#wishlist-status').textContent='Wishlist priority saved. Ownership was not changed.';}catch(error){$('#wishlist-status').textContent=error.message;renderWishlist();}});
      remove.type='button';remove.textContent='Remove';remove.addEventListener('click',async()=>{try{wishlist=await mutate('wishlist','remove',FanaticalLibrary.wishlistKey(item));renderWishlist();}catch(error){$('#wishlist-status').textContent=error.message;}});
      row.append(title,priority,remove);return row;
    }));
  }

  let reminderGeneration=0,reminderNext=null,reminderHistory=[];
  function resetReminders(){reminderGeneration++;reminderNext=null;reminderHistory=[];$('#reminder-list').replaceChildren();$('#reminder-status').textContent='Reminders have not been checked.';$('#reminder-previous').disabled=$('#reminder-next').disabled=true;$('#load-reminders').disabled=false;}
  async function loadReminders(offset=0,history=[]){
    const generation=++reminderGeneration,provider=$('#reminder-provider').value;$('#load-reminders').disabled=$('#reminder-previous').disabled=$('#reminder-next').disabled=true;$('#reminder-status').textContent='Loading central reminders...';$('#reminder-list').replaceChildren();
    try{
      const stored=await chrome.storage.local.get({galacticLibraryExtensionId:''}),id=FanaticalLibrary.resolveGalacticId(stored.galacticLibraryExtensionId,chrome.runtime);if(!FanaticalLibrary.isExtensionId(id))throw Error('Save a Galactic Library link first.');
      const page=await FanaticalLibrary.loadCentralReminders(message=>chrome.runtime.sendMessage(id,message),{provider,offset,limit:50});
      const current=await chrome.storage.local.get({galacticLibraryExtensionId:''});if(generation!==reminderGeneration||FanaticalLibrary.resolveGalacticId(current.galacticLibraryExtensionId,chrome.runtime)!==id)return;
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

  const STORAGE_KEY = 'fan_library_browser_state';
  const defaultLibraryState = {
    search: '',
    media: '',
    metadata: '',
    sort: 'title-asc',
    pageSize: 50,
    page: 0
  };

  function loadLibraryState() {
    try {
      if (typeof sessionStorage !== 'undefined') {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (raw) return { ...defaultLibraryState, ...JSON.parse(raw) };
      }
    } catch {}
    return { ...defaultLibraryState };
  }

  function saveLibraryState(state) {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      }
    } catch {}
  }

  const libraryBrowserState = loadLibraryState();

  function getItemPurchaseDate(item) {
    if (!item || typeof item !== 'object') return null;
    const raw = item.purchaseDate || item.purchasedAt
      || (Array.isArray(item.purchaseOrigins) && item.purchaseOrigins[0]?.purchaseDate)
      || (Array.isArray(item.provenance) && (item.provenance[0]?.purchasedAt || item.provenance[0]?.purchaseDate));
    if (!raw) return null;
    const time = Date.parse(raw);
    return Number.isFinite(time) ? time : null;
  }

  function formatPurchaseDate(timestamp) {
    if (!timestamp) return '';
    try {
      return new Date(timestamp).toISOString().slice(0, 10);
    } catch {
      return '';
    }
  }

  function filterAndSortLibrary(items, { search = '', media = '', metadata = '', sort = 'title-asc' } = {}) {
    const collator = globalThis.LibraryTitleSort || new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    let result = Array.isArray(items) ? [...items] : [];

    if (search && search.trim()) {
      const term = search.trim().toLowerCase();
      result = result.filter((item) => {
        const title = typeof item === 'string' ? item : (item.title || '');
        return title.toLowerCase().includes(term);
      });
    }

    if (media) {
      const targetMedia = media.toLowerCase();
      result = result.filter((item) => {
        const kind = typeof item === 'string' ? 'game' : (item.mediaType || item.kind || 'game');
        return kind.toLowerCase() === targetMedia;
      });
    }

    if (metadata) {
      result = result.filter((item) => {
        if (metadata === 'dated') return getItemPurchaseDate(item) !== null;
        if (metadata === 'bundle') return Boolean(typeof item === 'object' && (item.bundle?.title || item.sourceBundle));
        if (metadata === 'steam') return typeof item === 'object' && (item.drm === 'steam' || Boolean(item.steamAppId) || Boolean(item.steamAppIds?.length) || (Array.isArray(item.keys) && item.keys.some(k => k.type === 'steam')));
        if (metadata === 'drm-free') return typeof item === 'object' && (item.drm === 'drm-free' || item.drm === 'none' || Boolean(item.drmFree) || Boolean(item.downloads?.length));
        if (metadata === 'multi-origin') return typeof item === 'object' && Array.isArray(item.purchaseOrigins) && item.purchaseOrigins.length > 1;
        return true;
      });
    }

    result.sort((a, b) => {
      const titleA = typeof a === 'string' ? a : (a.title || '');
      const titleB = typeof b === 'string' ? b : (b.title || '');

      if (sort === 'title-desc') {
        return collator.compare(titleB, titleA);
      }
      if (sort === 'date-desc') {
        const dateA = getItemPurchaseDate(a);
        const dateB = getItemPurchaseDate(b);
        if (dateA !== null && dateB !== null) {
          if (dateB !== dateA) return dateB - dateA;
          return collator.compare(titleA, titleB);
        }
        if (dateA !== null) return -1;
        if (dateB !== null) return 1;
        return collator.compare(titleA, titleB);
      }
      if (sort === 'date-asc') {
        const dateA = getItemPurchaseDate(a);
        const dateB = getItemPurchaseDate(b);
        if (dateA !== null && dateB !== null) {
          if (dateA !== dateB) return dateA - dateB;
          return collator.compare(titleA, titleB);
        }
        if (dateA !== null) return -1;
        if (dateB !== null) return 1;
        return collator.compare(titleA, titleB);
      }
      return collator.compare(titleA, titleB);
    });

    return result;
  }

  function renderLibraryRow(item) {
    const row = document.createElement('li');
    const bundle = typeof item === 'object' ? (item.bundle?.title || item.sourceBundle || '') : '';
    const title = typeof item === 'string' ? item : (item.title || '');
    let text = bundle ? `${title} — ${bundle}` : title;
    if (item.purchaseOrigins?.length > 1) {
      text += ` (${item.purchaseOrigins.length} purchase origins)`;
    }
    const date = getItemPurchaseDate(item);
    const dateStr = formatPurchaseDate(date);
    if (dateStr) text += ` · ${dateStr}`;
    row.textContent = text;
    return row;
  }

  let latestLibraryItems = [];

  function renderLibraryBrowser(items = latestLibraryItems) {
    latestLibraryItems = Array.isArray(items) ? items : [];
    const preview = $('#library-preview');
    if (!preview) return;

    const librarySearch = $('#library-search');
    const libraryFilterMedia = $('#library-filter-media');
    const libraryFilterMetadata = $('#library-filter-metadata');
    const librarySort = $('#library-sort');
    const libraryPageSize = $('#library-page-size');
    const libraryPrevious = $('#library-previous');
    const libraryNext = $('#library-next');

    if (librarySearch && librarySearch.value !== libraryBrowserState.search) librarySearch.value = libraryBrowserState.search;
    if (libraryFilterMedia && libraryFilterMedia.value !== libraryBrowserState.media) libraryFilterMedia.value = libraryBrowserState.media;
    if (libraryFilterMetadata && libraryFilterMetadata.value !== libraryBrowserState.metadata) libraryFilterMetadata.value = libraryBrowserState.metadata;
    if (librarySort && librarySort.value !== libraryBrowserState.sort) librarySort.value = libraryBrowserState.sort;
    if (libraryPageSize && Number(libraryPageSize.value) !== libraryBrowserState.pageSize) libraryPageSize.value = String(libraryBrowserState.pageSize);

    const processed = filterAndSortLibrary(latestLibraryItems, {
      search: libraryBrowserState.search,
      media: libraryBrowserState.media,
      metadata: libraryBrowserState.metadata,
      sort: libraryBrowserState.sort
    });

    const pageSize = libraryBrowserState.pageSize || 50;
    const totalPages = Math.max(1, Math.ceil(processed.length / pageSize));
    libraryBrowserState.page = Math.max(0, Math.min(libraryBrowserState.page, totalPages - 1));
    saveLibraryState(libraryBrowserState);

    const start = libraryBrowserState.page * pageSize;
    const pageItems = processed.slice(start, start + pageSize);

    preview.start = start + 1;
    preview.replaceChildren(...pageItems.map(renderLibraryRow));

    if (libraryPrevious) libraryPrevious.disabled = libraryBrowserState.page === 0;
    if (libraryNext) libraryNext.disabled = (libraryBrowserState.page + 1) * pageSize >= processed.length;

    const note = $('#preview-note');
    if (note) {
      if (!latestLibraryItems.length) {
        note.textContent = 'Your library is empty. Import purchases or restore a backup to see a preview.';
      } else if (!processed.length) {
        note.textContent = `No items match your search or filter criteria (0 of ${latestLibraryItems.length} items).`;
      } else {
        const pageInfo = totalPages > 1 ? ` (page ${libraryBrowserState.page + 1} of ${totalPages})` : '';
        const filterInfo = processed.length !== latestLibraryItems.length ? ` (filtered from ${latestLibraryItems.length})` : '';
        const sortLabel = libraryBrowserState.sort === 'date-desc' ? 'by purchase date (newest)'
          : libraryBrowserState.sort === 'date-asc' ? 'by purchase date (oldest)'
          : libraryBrowserState.sort === 'title-desc' ? 'reverse alphabetically'
          : 'alphabetically';
        note.textContent = `Showing ${pageItems.length} of ${processed.length} items${filterInfo}${pageInfo}, ${sortLabel}.`;
      }
    }
  }

  $('#library-search')?.addEventListener('input', () => {
    libraryBrowserState.page = 0;
    libraryBrowserState.search = $('#library-search').value;
    saveLibraryState(libraryBrowserState);
    renderLibraryBrowser();
  });
  $('#library-filter-media')?.addEventListener('change', () => {
    libraryBrowserState.page = 0;
    libraryBrowserState.media = $('#library-filter-media').value;
    saveLibraryState(libraryBrowserState);
    renderLibraryBrowser();
  });
  $('#library-filter-metadata')?.addEventListener('change', () => {
    libraryBrowserState.page = 0;
    libraryBrowserState.metadata = $('#library-filter-metadata').value;
    saveLibraryState(libraryBrowserState);
    renderLibraryBrowser();
  });
  $('#library-sort')?.addEventListener('change', () => {
    libraryBrowserState.page = 0;
    libraryBrowserState.sort = $('#library-sort').value;
    saveLibraryState(libraryBrowserState);
    renderLibraryBrowser();
  });
  $('#library-page-size')?.addEventListener('change', () => {
    libraryBrowserState.page = 0;
    libraryBrowserState.pageSize = Number($('#library-page-size').value) || 50;
    saveLibraryState(libraryBrowserState);
    renderLibraryBrowser();
  });
  $('#library-previous')?.addEventListener('click', () => {
    libraryBrowserState.page--;
    saveLibraryState(libraryBrowserState);
    renderLibraryBrowser();
  });
  $('#library-next')?.addEventListener('click', () => {
    libraryBrowserState.page++;
    saveLibraryState(libraryBrowserState);
    renderLibraryBrowser();
  });

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
    $('#library-count').textContent = `Active account nickname: ${scope.fanaticalProfileLabel||'Not yet named'}. ${scope.fanaticalProfileArchives.length} other saved accounts (selectable above; excluded from active matching). ${items.length} unique item${items.length === 1 ? '' : 's'} stored locally.`;
    const missing=scope.fanaticalHistoricalItems.filter(entry=>entry.profileLabel===scope.fanaticalProfileLabel).length;
    if(missing) $('#library-count').textContent += ' '+missing+' previously recorded products are missing from the current snapshot; these warn as Check ownership and do not prove ownership.';
    $('#history-note').textContent = `${attempt?.status === 'incomplete' ? 'Last scan incomplete: complete order-history coverage could not be confirmed. Previous purchases and the last successful scan were kept. ' : ''}${summary?.historyCoverage ?? 'No order-history coverage has been checked yet.'}`;
    if (diagnostics && summary?.coverage) $('#history-note').textContent += ` ${summary.coverage.retries} retries; at most ${summary.coverage.concurrency} concurrent detail requests.`;
    $('#galactic-id').value = extensionId;
    $('#builtin-galactic-id').textContent=FanaticalLibrary.builtinGalacticId(chrome.runtime);
    $('#galactic-status').textContent = extensionId ? 'Saved override retained. Connection not yet verified; check the connection.' : 'Automatic Galactic Library pairing ready. Connection not yet verified; check the connection.';
    $('#fanatical-extension-id').textContent = chrome.runtime.id;
    $('#show-diagnostics').checked = Boolean(diagnostics);
    const display=await chrome.storage.local.get({fanaticalSummaryPreferences:{}}),prefs=FanaticalLibrary.normalizeSummaryPreferences(display.fanaticalSummaryPreferences);$('#summary-minimized').checked=prefs.minimized;$('#summary-position').value=prefs.position;
    const wishes=await chrome.storage.local.get({fanaticalWishlistItems:[]});wishlist=FanaticalLibrary.normalizeWishlist(wishes.fanaticalWishlistItems);renderWishlist();
    const counts = new Map();
    for (const item of items) counts.set(item.mediaType || 'other', (counts.get(item.mediaType || 'other') || 0) + 1);
    if (counts.size) $('#library-count').textContent += ` ${[...counts].sort().map(([kind, total]) => `${total} ${kind}`).join(', ')}.`;
    renderLibraryBrowser(items);
  }

  $('#import-file').addEventListener('change', async () => {
    const input = $('#import-file'); const file = input.files[0]; if (!file || libraryBusy) return;
    setLibraryBusy(true);
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('Choose a backup smaller than 50 MB.');
      let parsed;
      try { parsed = JSON.parse(await file.text()); } catch { throw new Error('The selected file is not valid JSON.'); }
      const items = parseLibraryBackup(parsed);
      if (!confirm(`Replace all saved accounts and your current Fanatical library with ${items.length} unique items from this backup and reset scan history? Export your current library first if you want to keep it.`)) {
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
    const id = FanaticalLibrary.resolveGalacticId($('#galactic-id').value,chrome.runtime); const button = $('#test-galactic'); const status = $('#galactic-status');
    const problem=FanaticalLibrary.companionTargetProblem(id,chrome.runtime);if(problem){status.textContent=problem;return;}
    button.disabled = true; status.textContent = 'Testing Galactic Library link…';
    try{
      const capabilities=await FanaticalLibrary.testGalacticLink(message=>chrome.runtime.sendMessage(id,message));
      status.textContent=`Connected to Galactic Library${capabilities.appVersion?' '+capabilities.appVersion:''}. ${capabilities.advertised?'Media: '+(capabilities.mediaTypes.join(', ')||'none')+'; reviewed contents '+(capabilities.reviewedContents?'supported':'unavailable')+'; entitlement reminders '+(capabilities.entitlementReminders?'supported':'unavailable')+'.':'Capabilities not advertised; newer features remain unconfirmed.'}`;
    }catch(error){status.textContent='Could not connect: '+error.message+' Enable or update Galactic Library and check Advanced pairing if using an unpacked build. A receiver manifest may restrict custom IDs; failed transport does not prove it is uninstalled.';}finally{button.disabled=false;}

  });

  $('#remove-galactic').addEventListener('click', async () => {
    try {
      await mutate('unlink');
      $('#galactic-id').value = ''; $('#galactic-status').textContent = 'Override removed. Automatic Galactic Library pairing remains available; check the connection.';resetReminders();
    } catch { $('#galactic-status').textContent = 'Could not remove the Galactic Library link.'; }
  });

  $('#show-diagnostics').addEventListener('change', async () => {
    const input = $('#show-diagnostics');
    try { await mutate('patch',{fanaticalShowDiagnostics:input.checked}); }
    catch { input.checked = !input.checked; $('#local-status').textContent = 'Could not save the diagnostics setting.'; }
  });

  for(const selector of ['#summary-minimized','#summary-position'])$(selector).addEventListener('change',async()=>{try{await FanaticalLibrary.storageSet({fanaticalSummaryPreferences:{minimized:$('#summary-minimized').checked,position:$('#summary-position').value}});$('#summary-preferences-status').textContent='Panel preferences saved.';}catch(error){$('#summary-preferences-status').textContent=error.message;}});
  $('#add-wish').addEventListener('click',async()=>{try{wishlist=await mutate('wishlist','add',[{title:$('#wishlist-title').value,mediaType:$('#wishlist-media').value,weight:Number($('#wishlist-weight').value)}]);$('#wishlist-status').textContent='Wish saved. Ownership was not changed.';$('#wishlist-title').value='';renderWishlist();}catch(error){$('#wishlist-status').textContent=error.message;}});
  $('#clear-wishlist').addEventListener('click',async()=>{if(!confirm('Clear your local wishlist? Ownership will not change.'))return;try{wishlist=await mutate('wishlist','replace',[]);renderWishlist();}catch(error){$('#wishlist-status').textContent=error.message;}});
  $('#wishlist-search').addEventListener('input',()=>{wishlistPage=0;renderWishlist();});$('#wishlist-previous').addEventListener('click',()=>{wishlistPage--;renderWishlist();});$('#wishlist-next').addEventListener('click',()=>{wishlistPage++;renderWishlist();});

  $('#export-wishlist').addEventListener('click',async()=>{
    try{const saved=await chrome.storage.local.get({fanaticalWishlistItems:[]}),list=FanaticalLibrary.normalizeWishlist(saved.fanaticalWishlistItems),link=document.createElement('a');link.href=URL.createObjectURL(new Blob([JSON.stringify({wishlist:list},null,2)],{type:'application/json'}));link.download='fanatical-wishlist.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),0);}catch(error){$('#wishlist-status').textContent='Wishlist export failed: '+error.message;}
  });
  $('#wishlist-file').addEventListener('change',async()=>{
    const input=$('#wishlist-file'),file=input.files[0];if(!file)return;
    try {
      if(file.size>50*1024*1024)throw Error('Choose a wishlist smaller than 50 MB.');
      const value=JSON.parse(await file.text()),list=FanaticalLibrary.normalizeWishlist(Array.isArray(value)?value:value.wishlist);
      if(!confirm(`Replace your wishlist with ${list.length} items? Ownership will not change.`)){$('#wishlist-status').textContent='Wishlist restore cancelled.';return;}
      wishlist=await mutate('wishlist','replace',list);wishlistPage=0;renderWishlist();$('#wishlist-status').textContent=`Restored ${wishlist.length} wishlist items.`;
    }catch(error){$('#wishlist-status').textContent='Wishlist restore failed: '+error.message;}finally{input.value='';}
  });

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
    if (!confirm('Clear all saved accounts, every locally stored Fanatical title, scan history, and import summary? Your wishlist, display preferences and Galactic Library link will be kept.')) return;
    setLibraryBusy(true);
    try {
      await mutate('clear');
      $('#local-status').textContent = 'Library and scan history cleared.';
      await refresh();
    } catch { $('#local-status').textContent = 'Could not clear the library.'; }
    finally { setLibraryBusy(false); }
  });

  LibraryAccountProfiles.mount($('#account-profiles'),{request:mutate,keys:['fanaticalProfileLabel','fanaticalProfileArchives'],onActiveChange:()=>refresh().catch(()=>{})});
  globalThis.LibraryBrowser = {
    filterAndSortLibrary,
    getItemPurchaseDate,
    getState: () => ({ ...libraryBrowserState }),
    setState: (next) => { Object.assign(libraryBrowserState, next); saveLibraryState(libraryBrowserState); renderLibraryBrowser(); },
    render: () => renderLibraryBrowser()
  };
  try { await refresh(); } catch { $('#local-status').textContent = 'Could not load local library settings. Reload this page and try again.'; }
}());
