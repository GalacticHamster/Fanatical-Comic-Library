import { localKeyReminders, backupRestoreState, createLibraryBackup, parseLibraryBackup, createTitleCatalog, createTitleCatalogCsv, FANATICAL_ORDERS_URL, orderNavigationUrl, fullScanPassStatus } from './library-data.mjs';
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Galactic Hamster

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

  const ordersUrl = FANATICAL_ORDERS_URL;
  let localReminderItems = [], activePurchaseAccount = null, activeOrderIds = {}, localReminderTimer;
  function renderLocalReminders() {
    clearTimeout(localReminderTimer);
    const now = Date.now(), rows = localKeyReminders(localReminderItems, now);
    let next = Infinity;
    for (const row of rows) if (row.hidden && row.review?.action === 'snoozed') next = Math.min(next, Date.parse(row.review.until));
    if (Number.isFinite(next)) {
      localReminderTimer = setTimeout(renderLocalReminders, Math.min(60000, Math.max(1, next - now + 5)));
      localReminderTimer?.unref?.();
    }
    const filter = $('#local-reminder-filter').value || 'pending';
    const query = ($('#local-reminder-search').value || '').trim().toLowerCase();
    // One count, for the selected view, as in Humble Library.
    $('#local-key-status').textContent = 'Reminders work without Galactic Library.';
    const shown = rows.filter(row => {
      const matchesView = row.hidden ? filter === 'hidden' || filter === row.review?.action
        : filter === 'unknown' ? row.status === 'unknown' : filter === 'pending' && row.status === 'unrevealed';
      return matchesView && [row.title, row.bundle].some(value => value?.toLowerCase().includes(query));
    });
    $('#local-reminder-count').textContent = shown.length
      ? shown.length.toLocaleString() + ' ' + (shown.length === 1 ? 'reminder' : 'reminders')
      : 'No reminders match this view.';
    $('#local-reminder-list').replaceChildren(...shown.map(localReminderCard));
  }

  function localReminderCard(row) {
    const card = document.createElement('li');
    card.className = 'key-reminder-card';
    card.dataset.reminderRef = row.ref;
    const part = (tag, css, value) => {
      const node = document.createElement(tag);
      node.className = css;
      node.textContent = value;
      return node;
    };
    const day = value => new Date(value).toLocaleDateString();
    const date = row.purchasedAt ? formatPurchaseDate(row.purchasedAt) || null : null;
    const badge = row.hidden ? row.review.action === 'snoozed' ? 'Snoozed until ' + day(row.review.until) : 'Dismissed'
      : row.status === 'unrevealed' ? 'Not yet revealed' : 'Key status unknown';
    const heading = part('div', 'key-reminder-heading', '');
    heading.append(part('span', '', row.title), part('span', 'key-reminder-status', badge));
    const context = [row.bundle || 'Individual purchase', date ? 'Purchased ' + date : 'Purchase date unknown',
      row.quantity > 1 ? row.quantity.toLocaleString() + ' copies' : ''].filter(Boolean).join(' \u00b7 ');
    const observation = row.status === 'unrevealed' ? 'Fanatical reports this key as not yet revealed. ' : 'Fanatical does not report whether this key was revealed. ';
    const details = observation + 'Checked ' + day(row.checkedAt) + '. Activation is unknown. No deadline recorded.';
    card.append(heading, part('div', 'key-reminder-source', context), part('div', 'key-reminder-meta', details));
    const actions = part('div', 'key-reminder-actions', '');
    // Navigation first, then the review actions, as on Humble Library cards.
    actions.append(purchaseNavigation(row.purchaseRef, row.title, row.ref));
    const accountId = activePurchaseAccount;
    const act = (text, action) => {
      const button = part('button', 'secondary', text);
      button.type = 'button';
      button.disabled = !accountId;
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await mutate('reviewKeyReminder', {accountId, ref:row.ref, basis:row.status, expectedReview:row.review ?? null,
            action, ...(action === 'snoozed' ? {until:new Date(Date.now() + 7 * 86400000).toISOString()} : {})});
          await refresh({libraryOnly:true});
          $('#local-reminder-action-status').textContent = 'Reminder review saved.';
        } catch (error) {
          $('#local-reminder-action-status').textContent = error.message;
          button.disabled = false;
        }
      });
      actions.append(button);
    };
    if (row.hidden) act('Restore reminder', 'active');
    else { act('Dismiss reminder', 'dismissed'); act('Snooze 7 days', 'snoozed'); }
    card.append(actions);
    return card;
  }
  for (const [selector, event] of [['#local-reminder-filter', 'change'], ['#local-reminder-search', 'input']]) {
    $(selector).addEventListener(event, () => { $('#local-reminder-list').scrollTop = 0; renderLocalReminders(); });
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
      $('#reminder-list').replaceChildren(...page.reminders.map(row=>{const li=document.createElement('li');li.textContent=`${row.title} (${row.provider}): ${labels[row.kind]}; ${row.dueAt||'deadline not reported'}; ${row.severity}.`;if(row.keyStatus)li.textContent+=` ${row.keyStatus==='unrevealed'?'Key reported unrevealed':'Key reveal status unknown'}; checked ${new Date(row.keyCheckedAt).toLocaleString()}. Activation on Steam is not verified.`;if(row.source==='humble-companion')li.textContent+=' Humble companion report; review in Humble or Galactic Library.';return li;}));
      $('#reminder-previous').disabled=!history.length;$('#reminder-next').disabled=reminderNext===null;
    }catch(error){if(generation!==reminderGeneration)return;reminderNext=null;reminderHistory=[];$('#reminder-status').textContent='Reminders not checked: '+error.message;}
    finally{if(generation===reminderGeneration)$('#load-reminders').disabled=false;}
  }
  $('#load-reminders').addEventListener('click',()=>loadReminders());
  $('#reminder-provider').addEventListener('change',resetReminders);
  $('#reminder-next').addEventListener('click',()=>loadReminders(reminderNext,[...reminderHistory,reminderNext-50]));
  $('#reminder-previous').addEventListener('click',()=>loadReminders(reminderHistory.at(-1),reminderHistory.slice(0,-1)));
  $('#review-reminders').addEventListener('click',async()=>{try{const response=await chrome.runtime.sendMessage({type:'FANATICAL_OPEN_GALACTIC_REVIEW'});if(!response?.ok)throw Error('Save and check your Galactic Library link first.');}catch{$('#reminder-status').textContent='Could not open Galactic Library. Save and check the link first.';}});
  chrome.storage.onChanged?.addListener((changes,area)=>{if(area==='local'&&(changes.galacticLibraryExtensionId||changes.fanaticalProfileLabel||changes.fanaticalAccountId||changes.fanaticalLibraryItems))resetReminders();});

  function setLibraryBusy(busy) {
    libraryBusy = busy;
    for (const selector of ['#import-file', '#export', '#export-catalog', '#export-catalog-csv', '#reset']) $(selector).disabled = busy;
  }

  const STORAGE_KEY = 'fan_library_browser_state';
  const defaultLibraryState = {
    view: 'titles',
    searchScope: 'title',
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
    let latest = null;
    const directRaw = item.purchaseDate || item.purchasedAt;
    if (directRaw) {
      const time = Date.parse(directRaw);
      if (Number.isFinite(time)) latest = time;
    }
    const list = Array.isArray(item.purchaseOrigins) ? item.purchaseOrigins : (Array.isArray(item.provenance) ? item.provenance : []);
    for (const rec of list) {
      const raw = rec?.purchaseDate || rec?.purchasedAt;
      if (raw) {
        const time = Date.parse(raw);
        if (Number.isFinite(time) && (latest === null || time > latest)) {
          latest = time;
        }
      }
    }
    return latest;
  }

  // The earliest known purchase date of a title (its first purchase), for oldest-first sorting.
  function getItemEarliestPurchaseDate(item) {
    if (!item || typeof item !== 'object') return null;
    const list = Array.isArray(item.purchaseOrigins) ? item.purchaseOrigins : (Array.isArray(item.provenance) ? item.provenance : []);
    let earliest = null;
    for (const raw of [item.purchaseDate || item.purchasedAt, ...list.map(rec => rec?.purchaseDate || rec?.purchasedAt)]) {
      const time = raw ? Date.parse(raw) : NaN;
      if (Number.isFinite(time) && (earliest === null || time < earliest)) earliest = time;
    }
    return earliest;
  }

  function mediaTypeLabel(type) {
    switch (type) {
      case 'comic': return 'Comic';
      case 'book': return 'Book';
      case 'game': return 'Game';
      case 'software': return 'Software';
      case 'audiobook': return 'Audiobook';
      case 'video': return 'Video';
      case 'unclassified': return 'Unclassified';
      default: return type ? (type.charAt(0).toUpperCase() + type.slice(1)) : 'Other';
    }
  }

  function formatPurchaseDate(timestamp) {
    if (!timestamp) return '';
    try {
      // The same calendar day as Humble Library and both CSV catalogs show (FanaticalLibrary.calendarDay).
      return FanaticalLibrary.calendarDay(timestamp);
    } catch {
      return '';
    }
  }

  function itemsMatchExactly(a, b) {
    if (a === b) return true;
    const titleA = (typeof a === 'string' ? a : (a?.title || '')).trim().toLowerCase();
    const titleB = (typeof b === 'string' ? b : (b?.title || '')).trim().toLowerCase();
    if (!titleA || titleA !== titleB) return false;

    const mediaA = (typeof a === 'string' ? 'other' : (a?.mediaType || a?.kind || 'other')).toLowerCase();
    const mediaB = (typeof b === 'string' ? 'other' : (b?.mediaType || b?.kind || 'other')).toLowerCase();
    if (mediaA !== mediaB) return false;

    if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
      const idA = (a.sourceItemId || '').trim();
      const idB = (b.sourceItemId || '').trim();
      if (idA && idB && idA !== idB) return false;

      const edA = (a.edition || '').trim().toLowerCase();
      const edB = (b.edition || '').trim().toLowerCase();
      if (edA !== edB) return false;

      const volA = (a.volume || '').trim().toLowerCase();
      const volB = (b.volume || '').trim().toLowerCase();
      if (volA !== volB) return false;

      const issA = (a.issue || '').trim().toLowerCase();
      const issB = (b.issue || '').trim().toLowerCase();
      if (issA !== issB) return false;

      const isbnA = (a.externalIds?.isbn || a.isbn || '').trim().toUpperCase();
      const isbnB = (b.externalIds?.isbn || b.isbn || '').trim().toUpperCase();
      if (isbnA && isbnB && isbnA !== isbnB) return false;

      const steamA = (a.externalIds?.steamAppId || a.steamAppId || '').trim();
      const steamB = (b.externalIds?.steamAppId || b.steamAppId || '').trim();
      if (steamA && steamB && steamA !== steamB) return false;
    }

    return true;
  }

  function parseRecordTimestamp(record) {
    if (!record || typeof record !== 'object') return null;
    const raw = record.purchaseDate || record.purchasedAt;
    if (!raw) return null;
    const time = Date.parse(raw);
    return Number.isFinite(time) ? time : null;
  }

  function sortOriginRecords(records) {
    return [...records].sort((a, b) => {
      const timeA = parseRecordTimestamp(a);
      const timeB = parseRecordTimestamp(b);
      if (timeA !== null && timeB !== null) {
        if (timeB !== timeA) return timeB - timeA;
        const bundleA = (a.bundle?.title || a.sourceBundle || '').trim();
        const bundleB = (b.bundle?.title || b.sourceBundle || '').trim();
        return bundleA.localeCompare(bundleB);
      }
      if (timeA !== null) return -1;
      if (timeB !== null) return 1;
      const bundleA = (a.bundle?.title || a.sourceBundle || '').trim();
      const bundleB = (b.bundle?.title || b.sourceBundle || '').trim();
      return bundleA.localeCompare(bundleB);
    });
  }

  function extractItemOrigins(item) {
    if (!item || typeof item !== 'object') return [];
    if (Array.isArray(item.purchaseOrigins) && item.purchaseOrigins.length > 0) {
      return sortOriginRecords(item.purchaseOrigins.map((o) => ({
        bundle: {
          sourceItemId: o.bundle?.sourceItemId || '',
          title: o.bundle?.title || item.bundle?.title || '',
          slug: o.bundle?.slug || ''
        },
        // An item's date belongs to one order only when it has exactly one; an undated order of several stays undated.
        purchaseDate: o.purchaseDate || (item.purchaseOrigins.length === 1 ? item.purchaseDate : null) || null,
        purchaseRef: o.purchaseRef || '',
        quantity: o.quantity || 1,
        drm: Array.isArray(o.drm) ? o.drm : (Array.isArray(item.drm) ? item.drm : (typeof item.drm === 'string' ? [item.drm] : [])),
        platforms: Array.isArray(o.platforms) ? o.platforms : (Array.isArray(item.platforms) ? item.platforms : []),
        formats: Array.isArray(o.formats) ? o.formats : (Array.isArray(item.formats) ? item.formats : undefined),
        delivery: o.delivery || item.delivery || '',
        streaming: Boolean(o.streaming || item.streaming)
      })));
    }
    const bundleTitle = item.bundle?.title || item.sourceBundle || '';
    const bundleId = item.bundle?.sourceItemId || '';
    if (bundleTitle || item.purchaseDate || item.purchaseRef || item.drm || item.delivery || item.streaming || item.formats !== undefined) {
      const drmList = Array.isArray(item.drm) ? item.drm : (typeof item.drm === 'string' ? [item.drm] : []);
      return [{
        bundle: {
          sourceItemId: bundleId,
          title: bundleTitle,
          slug: item.bundle?.slug || ''
        },
        purchaseDate: item.purchaseDate || null,
        purchaseRef: item.purchaseRef || '',
        quantity: item.quantity || 1,
        drm: drmList,
        platforms: Array.isArray(item.platforms) ? item.platforms : [],
        formats: Array.isArray(item.formats) ? item.formats : undefined,
        delivery: item.delivery || '',
        streaming: Boolean(item.streaming)
      }];
    }
    return [];
  }

  function mergeOriginRecords(existingOrigins, incomingOrigins) {
    const merged = new Map();
    function originKey(origin) {
      if (origin.purchaseRef) {
        return `ref:${origin.purchaseRef.toLowerCase()}:${origin.bundle?.sourceItemId || ''}`;
      }
      return `bundle:${(origin.bundle?.sourceItemId || origin.bundle?.title || '').toLowerCase()}:${origin.purchaseDate || ''}:${origin.quantity || 1}`;
    }
    for (const origin of [...existingOrigins, ...incomingOrigins]) {
      const key = originKey(origin);
      if (!merged.has(key)) {
        merged.set(key, origin);
      } else {
        const prev = merged.get(key);
        const combinedFormats = Array.isArray(prev.formats) || Array.isArray(origin.formats)
          ? [...new Set([...(prev.formats || []), ...(origin.formats || [])])].sort()
          : undefined;
        merged.set(key, {
          ...prev,
          ...origin,
          bundle: {
            sourceItemId: prev.bundle?.sourceItemId || origin.bundle?.sourceItemId || '',
            title: prev.bundle?.title || origin.bundle?.title || '',
            slug: prev.bundle?.slug || origin.bundle?.slug || ''
          },
          purchaseDate: prev.purchaseDate || origin.purchaseDate,
          quantity: Math.max(prev.quantity || 1, origin.quantity || 1),
          delivery: origin.delivery || prev.delivery || '',
          streaming: Boolean(origin.streaming || prev.streaming),
          ...(combinedFormats !== undefined ? { formats: combinedFormats } : {})
        });
      }
    }
    return sortOriginRecords([...merged.values()]);
  }

  function consolidateFanaticalItemInto(target, incoming) {
    const targetObj = typeof target === 'string' ? { title: target, mediaType: 'other' } : { ...target };
    const incomingObj = typeof incoming === 'string' ? { title: incoming, mediaType: 'other' } : incoming;

    const targetOrigins = extractItemOrigins(targetObj);
    const incomingOrigins = extractItemOrigins(incomingObj);
    const allOrigins = mergeOriginRecords(targetOrigins, incomingOrigins);

    const latestOrigin = allOrigins[0];
    const targetDate = getItemPurchaseDate(targetObj);
    const incomingDate = getItemPurchaseDate(incomingObj);
    const useIncomingDate = incomingDate !== null && (targetDate === null || incomingDate > targetDate);

    const targetDrm = Array.isArray(targetObj.drm) ? targetObj.drm : (typeof targetObj.drm === 'string' ? [targetObj.drm] : []);
    const incomingDrm = Array.isArray(incomingObj.drm) ? incomingObj.drm : (typeof incomingObj.drm === 'string' ? [incomingObj.drm] : []);
    const combinedDrm = [...new Set([...targetDrm, ...incomingDrm])];

    const combinedPlatforms = [...new Set([...(targetObj.platforms || []), ...(incomingObj.platforms || [])])];
    const combinedFormats = Array.isArray(targetObj.formats) || Array.isArray(incomingObj.formats)
      ? [...new Set([...(targetObj.formats || []), ...(incomingObj.formats || [])])].sort()
      : undefined;

    return {
      ...targetObj,
      ...(useIncomingDate ? incomingObj : {}),
      ...(combinedFormats !== undefined ? { formats: combinedFormats } : {}),
      sourceItemId: targetObj.sourceItemId || incomingObj.sourceItemId,
      bundle: latestOrigin?.bundle || targetObj.bundle || incomingObj.bundle || { sourceItemId: '', title: '' },
      purchaseDate: latestOrigin?.purchaseDate || (useIncomingDate ? incomingObj.purchaseDate : targetObj.purchaseDate) || null,
      purchaseOrigins: allOrigins,
      delivery: targetObj.delivery || incomingObj.delivery || latestOrigin?.delivery || '',
      streaming: Boolean(targetObj.streaming || incomingObj.streaming || latestOrigin?.streaming),
      ...(combinedDrm.length ? { drm: combinedDrm } : {}),
      ...(combinedPlatforms.length ? { platforms: combinedPlatforms } : {})
    };
  }

  function consolidateLibrary(items) {
    if (!Array.isArray(items)) return [];
    const buckets = new Map();
    for (const item of items) {
      const title = (typeof item === 'string' ? item : (item?.title || '')).trim().toLowerCase();
      const media = (typeof item === 'string' ? 'other' : (item?.mediaType || item?.kind || 'other')).toLowerCase();
      const bucketKey = `${media}:::${title}`;
      let group = buckets.get(bucketKey);
      if (!group) {
        group = [];
        buckets.set(bucketKey, group);
      }
      const existingIndex = group.findIndex((candidate) => itemsMatchExactly(candidate, item));
      if (existingIndex >= 0) {
        group[existingIndex] = consolidateFanaticalItemInto(group[existingIndex], item);
      } else {
        const itemObj = typeof item === 'string' ? { title: item, mediaType: media } : { ...item };
        const origins = extractItemOrigins(itemObj);
        group.push({ ...itemObj, purchaseOrigins: origins });
      }
    }
    const consolidated = [];
    for (const group of buckets.values()) {
      consolidated.push(...group);
    }
    return consolidated;
  }

  function filterAndSortLibrary(items, { search = '', searchScope = 'title', media = '', metadata = '', sort = 'title-asc' } = {}) {
    const collator = globalThis.LibraryTitleSort || new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    let result = Array.isArray(items) ? consolidateLibrary(items) : [];

    if (search && search.trim()) {
      const term = search.trim().toLowerCase();
      result = result.filter((item) => {
        const title = typeof item === 'string' ? item : (item.title || '');
        return (searchScope !== 'bundle' && title.toLowerCase().includes(term))
          || (searchScope !== 'title' && extractItemOrigins(item).some(origin => origin.bundle.title.toLowerCase().includes(term)));
      });
    }

    if (media) {
      const targetMedia = media.toLowerCase();
      result = result.filter((item) => {
        const kind = (typeof item === 'string' ? 'other' : (item.mediaType || item.kind || 'unclassified')).toLowerCase();
        if (targetMedia === 'book') {
          return kind === 'book' || kind === 'comic';
        }
        if (targetMedia === 'comic') {
          return kind === 'comic' || FanaticalLibrary.isComicItem(item);
        }
        if (targetMedia === 'unclassified') {
          return kind === 'unclassified' || kind === 'other';
        }
        return kind === targetMedia;
      });
    }

    if (metadata) {
      result = result.filter((item) => {
        if (metadata === 'dated') return getItemPurchaseDate(item) !== null;
        if (metadata === 'bundle') return Boolean(typeof item === 'object' && (item.bundle?.title || item.sourceBundle));
        if (metadata === 'steam') {
          return typeof item === 'object' && (
            item.drm === 'steam' ||
            Boolean(item.steamAppId) ||
            Boolean(item.steamAppIds?.length) ||
            (Array.isArray(item.keys) && item.keys.some(k => k.type === 'steam')) ||
            (Array.isArray(item.drm) && item.drm.includes('steam')) ||
            Boolean(item.externalIds?.steamAppId)
          );
        }
        if (metadata === 'drm-free') {
          return typeof item === 'object' && (
            item.drm === 'drm-free' ||
            item.drm === 'none' ||
            Boolean(item.drmFree) ||
            Boolean(item.downloads?.length) ||
            (Array.isArray(item.drm) && (item.drm.includes('drm-free') || item.drm.includes('none')))
          );
        }
        if (metadata === 'multi-origin') return typeof item === 'object' && FanaticalLibrary.purchaseCount([item]).count > 1;
        if (metadata === 'undated') return typeof item !== 'object' || !FanaticalLibrary.purchaseList([item]).purchases.some(purchase => purchase.date) && !item.purchaseDate;
        return true;
      });
    }

    result.sort((a, b) => {
      const titleA = typeof a === 'string' ? a : (a.title || '');
      const titleB = typeof b === 'string' ? b : (b.title || '');

      if (sort === 'title-desc') {
        return collator.compare(titleB, titleA);
      }
      // Recently added: when this browser first saved the product, newest first. Products saved before that was
      // recorded follow, by newest purchase, as in Humble Library. It is never shown as a purchase date.
      if (sort === 'added-desc') {
        const addedA = Date.parse(a?.firstSeenAt), addedB = Date.parse(b?.firstSeenAt);
        if (Number.isFinite(addedA) !== Number.isFinite(addedB)) return Number.isFinite(addedA) ? -1 : 1;
        if (Number.isFinite(addedA) && addedA !== addedB) return addedB - addedA;
        const dateA = getItemPurchaseDate(a), dateB = getItemPurchaseDate(b);
        if (dateA !== dateB) return dateA === null ? 1 : dateB === null ? -1 : dateB - dateA;
        return collator.compare(titleA, titleB);
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
      // Oldest first uses each title's first purchase, as in Humble Library. Titles without a known date are
      // listed last in both directions, never treated as old purchases.
      if (sort === 'date-asc') {
        const dateA = getItemEarliestPurchaseDate(a);
        const dateB = getItemEarliestPurchaseDate(b);
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

  function purchaseNavigation(purchaseRef, label, reminderRef = null) {
    const accountId = activePurchaseAccount;
    const direct = accountId && orderNavigationUrl(activeOrderIds[purchaseRef]);
    const action = document.createElement(direct ? 'button' : 'a');
    action.className = reminderRef ? (direct ? '' : 'key-reminder-link')
      : direct ? 'secondary library-open-purchase' : 'library-open-purchase';
    action.textContent = direct ? 'Open purchase' : 'Find in Order History';
    action.setAttribute('aria-label', action.textContent + ' — ' + label);
    if (direct) {
      action.type = 'button';
      action.addEventListener('click', async () => {
        action.disabled = true;
        const status = $(reminderRef ? '#local-reminder-action-status' : '#library-action-status');
        status.textContent = '';
        try {
          const url = reminderRef ? await mutate('keyReminderDestination',accountId,reminderRef)
            : await mutate('orderDestination',accountId,purchaseRef);
          await chrome.tabs.create({url: url ?? ordersUrl});
          if (!url && reminderRef) await refresh({libraryOnly:true});
        } catch (error) {
          status.textContent = error.message;
        } finally {
          action.disabled = false;
        }
      });
    } else {
      action.href = ordersUrl;
      action.target = '_blank';
      action.rel = 'noopener';
    }
    return action;
  }

  function buildPurchaseGroups(items) {
    const orders = new Map();
    for (const item of items) {
      if (!item?.sourceItemId || (item.source && item.source !== 'fanatical')) continue;
      const origins = item.purchaseOrigins?.length ? item.purchaseOrigins : extractItemOrigins(item);
      for (const origin of origins) {
        const bundleId = origin.bundle?.sourceItemId || '';
        const isBundle = Boolean(bundleId ? bundleId !== item.sourceItemId : origin.bundle?.title && origin.bundle.title !== item.title);
        const bundle = isBundle ? origin.bundle?.title || '' : '';
        if (!origin.purchaseRef && !bundleId && !bundle && !origin.purchaseDate) continue;
        const ref = /^[a-f0-9]{64}$/u.test(origin.purchaseRef) ? origin.purchaseRef : '';
        // Unlinked evidence has no authority to group different products into an order.
        const key = ref || JSON.stringify([item.sourceItemId, bundleId || bundle.toLowerCase(), origin.purchaseRef]);
        if (!orders.has(key)) orders.set(key, {ref, dates:new Set(), lines:new Map()});
        const order = orders.get(key);
        const date = formatPurchaseDate(origin.purchaseDate || (origins.length === 1 ? item.purchaseDate : null));
        if (date) order.dates.add(date);
        const lineKey = JSON.stringify([bundleId || bundle.toLowerCase(), item.sourceItemId]);
        const previous = order.lines.get(lineKey);
        const quantity = Number.isSafeInteger(origin.quantity) && origin.quantity > 0 ? origin.quantity : 1;
        if (!previous || quantity > previous.quantity) {
          order.lines.set(lineKey, {id:item.sourceItemId, title:item.title, media:item.mediaType || item.kind,
            bundle, bundleId:isBundle ? bundleId || bundle : '', quantity, firstSeenAt:item.firstSeenAt ?? null});
        }
      }
    }
    const groups = [...orders.values()].map(({ref, dates, lines}) => {
      const contents = [...lines.values()].sort((a,b) => LibraryTitleSort.compare(a.bundle,b.bundle) || LibraryTitleSort.compare(a.title,b.title));
      const first = contents[0];
      const oneBundle = first.bundle && contents.every(line => line.bundleId === first.bundleId);
      const categories = {};
      for (const line of contents) { const key = orderMediaCategory(line.media); categories[key] = (categories[key] ?? 0) + 1; }
      // First saved when its earliest product was, and unknown if any product was saved before that was recorded.
      const added = contents.every(line => line.firstSeenAt) ? contents.map(line => line.firstSeenAt).sort()[0] : null;
      return {ref, title:oneBundle ? first.bundle : contents.length === 1 ? first.title : 'Fanatical order',
        purchaseDate:dates.size === 1 ? [...dates][0] : null, addedAt:added,
        products:new Set(contents.map(line => line.id)).size, quantity:contents.reduce((total,line) => total + line.quantity,0), contents, categories,
        bundles:new Set(contents.filter(line => line.bundleId).map(line => line.bundleId)).size, standalone:contents.filter(line => !line.bundleId).length};
    });
    // Separate verified orders with the same name, as Humble Library counts repeat purchases of a bundle.
    const names = new Map();
    for (const group of groups) if (group.ref && group.title !== 'Fanatical order') { const key = FanaticalLibrary.titleKey(group.title); names.set(key, (names.get(key) ?? 0) + 1); }
    for (const group of groups) group.sameNamePurchases = group.ref && group.title !== 'Fanatical order' ? names.get(FanaticalLibrary.titleKey(group.title)) ?? 1 : 1;
    return groups;
  }

  // Contents categories for the Bundles & Orders media filter and facts. Comics count as books, as in Humble Library.
  const ORDER_MEDIA_LABELS = { game: ['game', 'games'], book: ['book or comic', 'books or comics'], software: ['software item', 'software items'], audiobook: ['audiobook', 'audiobooks'], video: ['video', 'videos'], other: ['other item', 'other items'] };
  function orderMediaCategory(media) {
    const kind = String(media || '').toLowerCase();
    return kind === 'comic' || kind === 'book' ? 'book' : ['game', 'software', 'audiobook', 'video'].includes(kind) ? kind : 'other';
  }
  const ORDER_CONTENT_BATCH = 100;
  const countText = (n, [one, many]) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

  function orderFacts(order) {
    const facts = [];
    const media = Object.entries(order.categories).sort(([,a],[,b]) => b - a).map(([key, n]) => countText(n, ORDER_MEDIA_LABELS[key]));
    if (media.length) facts.push(`Contains ${media.join(', ')}${Object.keys(order.categories).length > 1 ? ' (mixed media)' : ''}.`);
    if (order.bundles > 1 || order.bundles && order.standalone) facts.push(`${countText(order.bundles, ['bundle', 'bundles'])}${order.standalone ? ` and ${countText(order.standalone, ['standalone product', 'standalone products'])}` : ''} in this order.`);
    if (order.quantity > order.products) facts.push(`${order.quantity.toLocaleString()} copies in total: some products were bought in quantity.`);
    facts.push(order.ref ? 'Verified Fanatical order, read from your signed-in Order History.' : 'Earlier purchase evidence without a verified order reference.');
    if (!order.purchaseDate) facts.push('No purchase date is saved for this record.');
    if (order.addedAt) facts.push(`First saved in this browser on ${formatPurchaseDate(order.addedAt)}. This is not the purchase date.`);
    if (order.sameNamePurchases > 1) facts.push(`One of ${order.sameNamePurchases} separate purchases with this name.`);
    return facts;
  }

  function renderPurchaseGroup(entry) {
    const { order, matches = [], nameMatch = false } = entry.order ? entry : { order: entry };
    const row = document.createElement('li');
    row.className = 'library-item library-group';
    row.dataset.rowKeys = 'g:' + (order.ref || order.contents.map(line => line.id).join('\u0001'));
    const details = document.createElement('details');
    details.className = 'library-item-details';
    const summary = document.createElement('summary');
    summary.className = 'library-item-summary';
    summary.textContent = `${order.title} — ${order.purchaseDate || 'Date unknown'} · ${order.products.toLocaleString()} ${order.products === 1 ? 'product' : 'products'}`;
    if (order.quantity > order.products) summary.textContent += ` · ${order.quantity.toLocaleString()} copies`;
    // A title found inside a large order is counted here and listed first when the order opens.
    if (matches.length && !nameMatch) summary.textContent += ` · ${countText(matches.length, ['matching title', 'matching titles'])}`;
    details.append(summary);
    let rendered = false;
    const render = () => {
      if (rendered) return;
      rendered = true;
      const facts = document.createElement('ul');
      facts.className = 'library-group-facts';
      facts.append(...orderFacts(order).map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
      details.append(facts, purchaseNavigation(order.ref, [order.title,order.purchaseDate].filter(Boolean).join(' · ')));
      const matched = new Set(matches), sequence = [...matches, ...order.contents.map((_, i) => i).filter(i => !matched.has(i))];
      const list = document.createElement('ul');
      list.className = 'library-provenance-list library-group-contents';
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'secondary library-group-more';
      let shown = 0;
      const step = () => {
        for (const i of sequence.slice(shown, shown + ORDER_CONTENT_BATCH)) {
          const line = order.contents[i], item = document.createElement('li');
          item.className = 'library-provenance-item';
          const title = document.createElement('div');
          title.className = 'library-provenance-primary';
          title.textContent = (matched.has(i) ? 'Match: ' : '') + line.title;
          const secondary = document.createElement('div');
          secondary.className = 'library-provenance-secondary';
          // The bundle is named only when it differs from the purchase name above.
          secondary.textContent = [line.bundle && line.bundle !== order.title ? line.bundle : line.bundleId ? '' : order.bundles ? 'Standalone product' : '', mediaTypeLabel(line.media), line.quantity > 1 ? `${line.quantity.toLocaleString()} copies` : ''].filter(Boolean).join(' · ');
          item.append(title, secondary);
          list.append(item);
        }
        shown = Math.min(sequence.length, shown + ORDER_CONTENT_BATCH);
        more.hidden = shown >= sequence.length;
        more.textContent = `Show ${Math.min(ORDER_CONTENT_BATCH, sequence.length - shown)} more of ${sequence.length - shown} remaining products`;
      };
      more.addEventListener('click', step);
      step();
      details.append(list, more);
    };
    details.addEventListener('toggle', () => { if (details.open) render(); });
    row.append(details);
    return row;
  }

  function renderLibraryRow(item) {
    const row = document.createElement('li');
    row.className = 'library-item';
    row.dataset.rowKeys = 't:' + String(typeof item === 'string' ? 'other' : item?.mediaType || item?.kind || 'other').toLowerCase() + ':' + String(typeof item === 'string' ? item : item?.title || '').trim().toLowerCase();

    const title = typeof item === 'string' ? item : (item.title || '');
    const origins = sortOriginRecords(extractItemOrigins(item));

    // Purchases, not bundles: two orders of one bundle are two purchases (FanaticalLibrary.purchaseCount).
    const counted = typeof item === 'object' ? FanaticalLibrary.purchaseCount([item]) : { count: 0, exact: true };
    const summarySuffix = counted.count ? ` — ${FanaticalLibrary.purchaseCountText(counted)}` : ' — manual entry';

    const headerText = `${title}${summarySuffix}`;

    const details = document.createElement('details');
    details.className = 'library-item-details';

    const summary = document.createElement('summary');
    summary.className = 'library-item-summary';
    summary.textContent = headerText;
    details.append(summary);

    if (origins.length > 0) {
      const list = document.createElement('ul');
      list.className = 'library-provenance-list';
      const linked = new Set();
      const navLabel = (bundle, date) => [title,bundle,date || 'Date unknown'].filter(Boolean).join(' · ');
      for (const origin of origins) {
        const li = document.createElement('li');
        li.className = 'library-provenance-item';

        const bTitle = origin.bundle?.title || origin.sourceBundle || '';
        const primary = document.createElement('div');
        primary.className = 'library-provenance-primary';
        const primaryText = bTitle
          ? `Bundle: ${bTitle}`
          : (origin.purchaseRef ? 'Individual purchase' : 'Purchase record stored without bundle details');
        primary.textContent = primaryText;
        li.append(primary);

        const secondaryParts = [];
        const pDate = formatPurchaseDate(origin.purchaseDate);
        if (pDate) secondaryParts.push(`Purchased: ${pDate}`);
        // Copies, as Bundles & Orders and reminder cards say. A verified order is named, never shown as a hash.
        if (origin.quantity && origin.quantity > 1) secondaryParts.push(`${origin.quantity} copies`);
        if (origin.purchaseRef) secondaryParts.push('Verified order');
        if (origin.drm && origin.drm.length) secondaryParts.push(`DRM: ${origin.drm.join(', ')}`);

        if (origin.delivery === 'streaming' || item.delivery === 'streaming' || item.streaming) {
          secondaryParts.push('Streaming');
        } else if (origin.delivery === 'direct-download' || item.delivery === 'direct-download') {
          secondaryParts.push('Direct download');
        } else if (origin.delivery === 'external-key' || item.delivery === 'external-key') {
          secondaryParts.push('External key');
        } else if (origin.delivery) {
          secondaryParts.push(origin.delivery);
        }

        const formats = Array.isArray(origin.formats)
          ? origin.formats
          : (Array.isArray(item.formats) ? item.formats : null);
        if (formats && formats.length > 0) {
          secondaryParts.push(`Formats: ${formats.map(f => f.startsWith('.') ? f : (/^[a-z0-9]{2,10}$/iu.test(f) ? '.' + f.toLowerCase() : f)).join(', ')}`);
        } else if (formats && formats.length === 0) {
          if (origin.delivery !== 'streaming' && !origin.streaming && origin.delivery !== 'external-key' && (!origin.drm || !origin.drm.includes('steam'))) {
            secondaryParts.push('No file formats in purchase metadata');
          }
        } else if (formats === null) {
          if (origin.delivery !== 'streaming' && !origin.streaming && origin.delivery !== 'external-key' && (!origin.drm || !origin.drm.includes('steam'))) {
            secondaryParts.push('Format details require library rescan');
          }
        }

        if (secondaryParts.length > 0) {
          const secondary = document.createElement('div');
          secondary.className = 'library-provenance-secondary';
          secondary.textContent = secondaryParts.join(' · ');
          li.append(secondary);
        }

        const legacyParts = [];
        if (bTitle) legacyParts.push(`Bundle: ${bTitle}`);
        if (pDate) legacyParts.push(`Purchased: ${pDate}`);
        if (origin.quantity && origin.quantity > 1) legacyParts.push(`${origin.quantity} copies`);
        if (origin.purchaseRef) legacyParts.push('Verified order');
        if (origin.drm && origin.drm.length) legacyParts.push(`DRM: ${origin.drm.join(', ')}`);
        const fullLegacyText = legacyParts.join(' · ') || 'Purchase record stored without bundle details';

        try {
          Object.defineProperty(li, 'textContent', {
            get() { return fullLegacyText; },
            set(v) { primary.textContent = v; },
            configurable: true
          });
        } catch {
          li.textContent = fullLegacyText;
        }

        if (!item.source || item.source === 'fanatical') {
          const ref = origin.purchaseRef;
          if (!ref || !linked.has(ref)) li.append(purchaseNavigation(ref, navLabel(bTitle,pDate)));
          if (ref) linked.add(ref);
        }
        list.append(li);
      }
      details.append(list);
      const dates = FanaticalLibrary.purchaseList([item]).purchases.map(purchase => formatPurchaseDate(purchase.date)).filter(Boolean).sort();
      if (dates.length) {
        const dateRange = document.createElement('p');
        dateRange.className = 'library-provenance-empty';
        dateRange.textContent = `First known purchase: ${dates[0]} · Last known purchase: ${dates.at(-1)}`;
        details.append(dateRange);
      }
    } else {
      const empty = document.createElement('p');
      empty.className = 'library-provenance-empty';
      empty.textContent = 'No bundle or purchase record stored.';
      details.append(empty);
    }

    const classificationRow = document.createElement('div');
    classificationRow.className = 'library-classification-row';

    const itemKind = typeof item === 'string' ? 'other' : (item.mediaType || item.kind || 'unclassified');
    const automaticKind = typeof item === 'string' ? 'other' : (item.automaticMediaType || item.mediaType || 'unclassified');
    const isOverridden = Boolean(typeof item === 'object' && (item.manualMediaType || item.manualKind || (item.automaticMediaType && item.mediaType !== item.automaticMediaType)));

    const badge = document.createElement('span');
    badge.className = 'library-media-badge';
    badge.setAttribute('data-media-type', itemKind);
    badge.textContent = mediaTypeLabel(itemKind);

    const note = document.createElement('span');
    note.className = 'library-classification-note';
    if (isOverridden) {
      note.textContent = `User override (automatic: ${mediaTypeLabel(automaticKind)})`;
    } else {
      note.textContent = `Automatic: ${mediaTypeLabel(automaticKind)}`;
    }

    const select = document.createElement('select');
    select.className = 'library-classification-select';
    select.setAttribute('aria-label', `Change classification for ${title}`);

    const optionsList = [
      { value: 'comic', label: 'Comic' },
      { value: 'book', label: 'Book' },
      { value: 'game', label: 'Game' },
      { value: 'software', label: 'Software' },
      { value: 'audiobook', label: 'Audiobook' },
      { value: 'video', label: 'Video' },
      { value: 'unclassified', label: 'Unclassified' }
    ];

    for (const opt of optionsList) {
      const optEl = document.createElement('option');
      optEl.value = opt.value;
      optEl.textContent = opt.label;
      if (opt.value === itemKind) optEl.selected = true;
      select.append(optEl);
    }

    select.addEventListener('change', async (e) => {
      e.stopPropagation();
      const newKind = select.value;
      try {
        await mutate('setMediaOverride', item, newKind);
        await refresh();
      } catch (err) {
        alert(`Failed to override media type: ${err.message}`);
      }
    });

    classificationRow.append(badge, note, select);

    if (isOverridden) {
      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'library-reset-classification-btn secondary';
      resetBtn.textContent = 'Reset to automatic';
      resetBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await mutate('resetMediaOverride', item);
          await refresh();
        } catch (err) {
          alert(`Failed to reset media type: ${err.message}`);
        }
      });
      classificationRow.append(resetBtn);
    }

    details.append(classificationRow);

    row.append(details);

    try {
      Object.defineProperty(row, 'textContent', {
        get() { return summary.textContent; },
        set(val) { summary.textContent = val; },
        configurable: true
      });
    } catch {
      row.textContent = headerText;
    }

    return row;
  }

  let latestLibraryItems = [];
  let latestPurchaseGroups = null;
  const ordersSelected = () => libraryBrowserState.view === 'orders';
  const viewState = () => ordersSelected()
    ? (libraryBrowserState.orders ??= {...defaultLibraryState, searchScope:'both'})
    : libraryBrowserState;

  function renderLibraryBrowser(items = latestLibraryItems) {
    if (items !== latestLibraryItems) latestPurchaseGroups = null;
    latestLibraryItems = Array.isArray(items) ? items : [];
    const preview = $('#library-preview');
    if (!preview) return;

    const orders = ordersSelected();
    const state = viewState();
    const libraryFilterMedia = $('#library-filter-media');
    const libraryFilterMetadata = $('#library-filter-metadata');
    const librarySort = $('#library-sort');
    const libraryPageSize = $('#library-page-size');
    const libraryPrevious = $('#library-previous');
    const libraryNext = $('#library-next');
    const controls = {
      '#library-view-titles': {checked: !orders},
      '#library-view-groups': {checked: orders},
      '#library-search-label': {textContent: orders ? 'Find bundles and orders' : 'Find titles'},
      '#library-search': {value: state.search, placeholder: orders ? 'Filter by bundle or contained title…' : 'Filter by title…'},
      '#library-title-media': {hidden: orders},
      '#library-order-media': {hidden: !orders},
      '#library-sort-size-desc': {hidden: !orders, disabled: !orders},
      '#library-sort-size-asc': {hidden: !orders, disabled: !orders},
      '#library-search-scope': {value: state.searchScope},
      '#library-title-metadata': {hidden: orders},
      '#library-order-metadata': {hidden: !orders},
      '#library-filter-orders': {value: orders ? state.metadata : ''},
      '#library-sort-name-asc': {textContent: orders ? 'Purchase name (A–Z)' : 'Title (A–Z)'},
      '#library-sort-name-desc': {textContent: orders ? 'Purchase name (Z–A)' : 'Title (Z–A)'}
    };
    for (const [selector, props] of Object.entries(controls)) {
      const element = $(selector);
      if (element) for (const [key,value] of Object.entries(props)) if (element[key] !== value) element[key] = value;
    }
    if (libraryFilterMedia && !orders) libraryFilterMedia.value = state.media;
    if (orders && $('#library-filter-order-media')) $('#library-filter-order-media').value = state.media;
    if (libraryFilterMetadata && !orders) libraryFilterMetadata.value = state.metadata;
    if (librarySort) librarySort.value = state.sort;
    if (libraryPageSize) libraryPageSize.value = String(state.pageSize);

    const uniqueItems = orders ? (latestPurchaseGroups ??= buildPurchaseGroups(latestLibraryItems)) : consolidateLibrary(latestLibraryItems);
    const processed = orders ? filterPurchaseGroups(uniqueItems,state) : filterAndSortLibrary(uniqueItems,state);
    const pageSize = state.pageSize || 50;
    const totalPages = Math.max(1, Math.ceil(processed.length / pageSize));
    state.page = Math.max(0, Math.min(state.page, totalPages - 1));
    saveLibraryState(libraryBrowserState);

    const start = state.page * pageSize;
    const pageItems = processed.slice(start, start + pageSize);

    preview.start = start + 1;
    // Re-rendering keeps expanded rows open, for example after a reminder review or a media change, as in Humble Library.
    const rowKeys = row => String(row?.dataset?.rowKeys ?? '').split('\n').filter(Boolean);
    const ownDetails = row => [...(row?.children ?? [])].find(child => child?.tagName === 'DETAILS' || child?.className === 'library-item-details');
    const open = new Set([...(preview.children ?? [])].filter(row => ownDetails(row)?.open).flatMap(rowKeys));
    preview.replaceChildren(...pageItems.map(orders ? renderPurchaseGroup : renderLibraryRow));
    if (open.size) for (const row of [...preview.children]) {
      const details = ownDetails(row);
      if (details && !details.open && rowKeys(row).some(key => open.has(key))) {
        details.open = true;
        // Bundles & Orders render contents on the toggle event; a test or older engine may not send one.
        if (typeof details.dispatchEvent === 'function' && typeof Event === 'function') details.dispatchEvent(new Event('toggle'));
        else details.listeners?.toggle?.();
      }
    }

    if (libraryPrevious) libraryPrevious.disabled = state.page === 0;
    if (libraryNext) libraryNext.disabled = (state.page + 1) * pageSize >= processed.length;

    const note = $('#preview-note');
    if (note) {
      const unit = orders ? 'purchase records' : 'items';
      if (!latestLibraryItems.length) {
        note.textContent = 'Your library is empty. Import purchases or restore a backup to see a preview.';
      } else if (orders && !uniqueItems.length) {
        note.textContent = 'No Fanatical order or bundle details are saved for this account.';
      } else if (!processed.length) {
        note.textContent = `No ${unit} match your search or filter criteria (0 of ${uniqueItems.length} ${unit}).`;
      } else {
        const pageInfo = totalPages > 1 ? ` (page ${state.page + 1} of ${totalPages})` : '';
        const filterInfo = processed.length !== uniqueItems.length ? ` (filtered from ${uniqueItems.length})` : '';
        const sortLabel = state.sort === 'date-desc' ? (orders ? 'by purchase date (newest), purchases without a known date last' : 'by latest purchase date (newest), titles without a known date last')
          : state.sort === 'date-asc' ? (orders ? 'by purchase date (oldest), purchases without a known date last' : 'by first purchase date (oldest), titles without a known date last')
          : state.sort === 'title-desc' ? 'reverse alphabetically'
          : state.sort === 'added-desc' ? `recently added first; ${orders ? 'purchases' : 'titles'} saved before this browser recorded when they were added follow, newest purchase first`
          : orders && state.sort === 'count-desc' ? 'by most products'
          : orders && state.sort === 'count-asc' ? 'by fewest products'
          : 'alphabetically';
        // Say how a search treats contained titles, so a match inside a large order is not a surprise.
        const searchInfo = orders && state.search.trim() && state.searchScope !== 'bundle' ? ' Purchases containing a matching title show how many match; open one to see those titles first.' : '';
        note.textContent = `Showing ${pageItems.length} of ${processed.length} ${unit}${filterInfo}${pageInfo}, ${sortLabel}.${searchInfo}`;
      }
    }
  }

  // Returns {order, matches, nameMatch}: matches are the contained titles a search found, listed first when the order opens.
  function filterPurchaseGroups(groups, {search,searchScope,media = '',metadata,sort}) {
    const term = search.trim().toLowerCase();
    const results = [];
    for (const order of groups) {
      if (metadata === 'dated' && !order.purchaseDate || metadata === 'undated' && order.purchaseDate) continue;
      if (metadata === 'legacy' && order.ref || metadata === 'bundle' && !order.contents.some(line => line.bundleId)) continue;
      if (metadata === 'repeat' && !(order.sameNamePurchases > 1)) continue;
      if (media === 'mixed' ? Object.keys(order.categories).length < 2 : media && !order.categories[media]) continue;
      const nameMatch = Boolean(term) && searchScope !== 'title' && (order.title.toLowerCase().includes(term) || order.contents.some(line => line.bundle.toLowerCase().includes(term)));
      const matches = term && searchScope !== 'bundle' ? order.contents.map((line, i) => line.title.toLowerCase().includes(term) ? i : -1).filter(i => i >= 0) : [];
      if (term && !nameMatch && !matches.length) continue;
      results.push({order, matches, nameMatch});
    }
    return results.sort(({order:a},{order:b}) => {
      if (sort === 'date-asc' || sort === 'date-desc') {
        if (Boolean(a.purchaseDate) !== Boolean(b.purchaseDate)) return a.purchaseDate ? -1 : 1;
        const byDate = (a.purchaseDate || '').localeCompare(b.purchaseDate || '');
        if (byDate) return sort === 'date-asc' ? byDate : -byDate;
      }
      if ((sort === 'count-desc' || sort === 'count-asc') && a.products !== b.products) return sort === 'count-desc' ? b.products - a.products : a.products - b.products;
      if (sort === 'added-desc') {
        if (Boolean(a.addedAt) !== Boolean(b.addedAt)) return a.addedAt ? -1 : 1;
        const byAdded = (b.addedAt || '').localeCompare(a.addedAt || '') || (b.purchaseDate || '').localeCompare(a.purchaseDate || '');
        if (byAdded) return byAdded;
      }
      const byName = LibraryTitleSort.compare(a.title,b.title);
      return (sort === 'title-desc' ? -byName : byName) || a.ref.localeCompare(b.ref);
    });
  }

  for (const [selector,view] of [['#library-view-titles','titles'],['#library-view-groups','orders']]) {
    $(selector)?.addEventListener('change', () => {
      if (!$(selector).checked) return;
      libraryBrowserState.view = view;
      renderLibraryBrowser();
    });
  }
  for (const [selector,property] of [
    ['#library-search','search'], ['#library-search-scope','searchScope'], ['#library-filter-media','media'], ['#library-filter-order-media','media'], ['#library-filter-metadata','metadata'],
    ['#library-filter-orders','metadata'], ['#library-sort','sort'], ['#library-page-size','pageSize']
  ]) {
    $(selector)?.addEventListener(property === 'search' ? 'input' : 'change', () => {
      const state = viewState();
      state.page = 0;
      state[property] = property === 'pageSize' ? Number($(selector).value) || 50 : $(selector).value;
      renderLibraryBrowser();
    });
  }
  $('#library-previous')?.addEventListener('click', () => {
    viewState().page--;
    renderLibraryBrowser();
  });
  $('#library-next')?.addEventListener('click', () => {
    viewState().page++;
    renderLibraryBrowser();
  });

  let refreshChain=Promise.resolve();
  function refresh(options) {const next=refreshChain.then(()=>refreshNow(options));refreshChain=next.catch(()=>{});return next;}
  // Date coverage across the titles Library lists, as in Humble Library. A title counts as dated when any purchase has a known date.
  function renderDateCoverage(items) {
    const element = $('#library-date-coverage');
    if (!element) return;
    const titles = consolidateLibrary(items);
    if (!titles.length) { element.textContent = ''; return; }
    const dated = titles.filter(item => getItemPurchaseDate(item) !== null).length, undated = titles.length - dated;
    const percent = Math.floor((dated / titles.length) * 1000) / 10;
    element.textContent = `Purchase dates known for ${dated.toLocaleString()} of ${titles.length.toLocaleString()} title${titles.length === 1 ? '' : 's'} (${percent}%).`
      + (undated ? ` ${undated.toLocaleString()} ${undated === 1 ? 'title has' : 'titles have'} no known purchase date. Choose “No known purchase date” under Metadata in Titles to list them.` : '');
  }
  // An unfinished Full scan of the active account: what was saved and how to continue or discard it.
  async function renderFullScanState() {
    const box = $('#full-scan-state');
    if (!box) return;
    const saved = await chrome.storage.local.get({ fanaticalAccountId: null, fanaticalProfileLabel: '', fanaticalFullScanPass: null });
    const u = fullScanPassStatus(saved), when = value => value ? new Date(value).toLocaleString() : 'an unknown time';
    box.hidden = !u;
    if (!u) return;
    $('#full-scan-note').textContent = `Full scan unfinished: ${u.verifiedOrders.toLocaleString()} order${u.verifiedOrders === 1 ? '' : 's'} verified and saved in ${u.batches} batch${u.batches === 1 ? '' : 'es'}, last saved ${when(u.updatedAt)}. Continue full scan on the Fanatical Orders page reads only the remaining orders. The progress is kept until ${when(u.expiresAt)}. Discarding it does not remove saved purchases.`;
    $('#continue-full-scan').hidden = $('#discard-full-scan').hidden = false;
  }
  async function refreshNow({libraryOnly=false}={}) {
    const state=await chrome.storage.local.get({fanaticalImportSummary:null,fanaticalLibraryItems:[],galacticLibraryExtensionId:'',fanaticalShowDiagnostics:false,fanaticalLastScanAttempt:null,fanaticalProfileLabel:'',fanaticalAccountId:null,fanaticalProfileArchives:[],fanaticalHistoricalItems:[],fanaticalOrderNavigation:{}});
    const {
      fanaticalImportSummary: summary = null,
      fanaticalLibraryItems: items = [],
      galacticLibraryExtensionId: extensionId = '',
      fanaticalShowDiagnostics: diagnostics = false,
      fanaticalLastScanAttempt: attempt = null
    } = state;
    $('#last-import').textContent = summary
      ? `Last ${summary.scanMode === 'full' ? 'full' : 'quick'} scan: ${summary.addedProducts} item${summary.addedProducts === 1 ? '' : 's'} added; ${summary.ordersScanned} order${summary.ordersScanned === 1 ? '' : 's'} scanned${summary.ordersSkipped ? ` and ${summary.ordersSkipped} already-scanned order${summary.ordersSkipped === 1 ? '' : 's'} skipped` : ''} on ${new Date(summary.importedAt).toLocaleString()}.`
      : 'No Fanatical import has run yet.';
    void renderFullScanState();
    const scope=state;
    $('#library-count').textContent = `Active account nickname: ${scope.fanaticalProfileLabel||'Not yet named'}. ${scope.fanaticalProfileArchives.length} other saved accounts (selectable above; excluded from active matching). ${items.length} unique item${items.length === 1 ? '' : 's'} stored locally.`;
    renderDateCoverage(items);
    const missing=scope.fanaticalHistoricalItems.filter(entry=>entry.profileLabel===scope.fanaticalProfileLabel).length;
    if(missing) $('#library-count').textContent += ' '+missing+' previously recorded products were not found in the latest scan; these warn as Check ownership and do not prove ownership.';
    activePurchaseAccount=scope.fanaticalAccountId;localReminderItems=items;
    activeOrderIds=scope.fanaticalOrderNavigation[activePurchaseAccount]??{};renderLocalReminders();

    $('#history-note').textContent = `${attempt?.status==='partial'&&attempt.acquisitionComplete===true?'Last import finished successfully. ':attempt?.status==='partial'?`Last scan was partial: ${attempt.verifiedPurchasesSaved} verified purchases saved; ${attempt.unresolvedOrders} purchases unresolved. ${attempt.discoveryComplete?'The listing was read, but some purchases remain unresolved.':'The end of the library was not verified.'} Earlier purchases and the last complete check were kept. `:attempt?.status === 'incomplete' ? 'Last scan incomplete: complete order-history coverage could not be confirmed. Previous purchases and the last successful scan were kept. ' : ''}${summary?.historyCoverage ?? 'No complete order-history check has been saved yet.'}`;
    if(diagnostics&&attempt?.status==='partial'&&attempt.acquisitionComplete===true) $('#history-note').textContent += ' Fanatical did not provide enough information to independently verify that the entire purchase history was returned. Existing purchases were preserved.';
    if (diagnostics && summary?.coverage) $('#history-note').textContent += ` ${summary.coverage.retries} retries; at most ${summary.coverage.concurrency} concurrent detail requests.`;
    if(!libraryOnly){
    $('#galactic-id').value = extensionId;
    $('#builtin-galactic-id').textContent=FanaticalLibrary.builtinGalacticId(chrome.runtime);
    $('#galactic-status').textContent = extensionId ? 'Saved override retained. Connection not yet verified; check the connection.' : 'Automatic Galactic Library pairing ready. Connection not yet verified; check the connection.';
    $('#fanatical-extension-id').textContent = chrome.runtime.id;
    $('#show-diagnostics').checked = Boolean(diagnostics);
    const display=await chrome.storage.local.get({fanaticalSummaryPreferences:{}}),prefs=FanaticalLibrary.normalizeSummaryPreferences(display.fanaticalSummaryPreferences);$('#summary-minimized').checked=prefs.minimized;$('#summary-position').value=prefs.position;
    const wishes=await chrome.storage.local.get({fanaticalWishlistItems:[]});wishlist=FanaticalLibrary.normalizeWishlist(wishes.fanaticalWishlistItems);renderWishlist();
    }
    const { rejectedPurchaseItems = [], mediaTypeOverrides = {} } = await chrome.storage.local.get({ rejectedPurchaseItems: [], mediaTypeOverrides: {} });
    const overrideCount = Object.keys(mediaTypeOverrides).length;
    const comics = items.filter((item) => item.mediaType === 'comic' || FanaticalLibrary.isComicItem(item)).length;
    const books = items.filter((item) => (item.mediaType === 'book' || !item.mediaType) && !FanaticalLibrary.isComicItem(item)).length;
    const games = items.filter((item) => item.mediaType === 'game').length;
    const software = items.filter((item) => item.mediaType === 'software').length;
    const audiobooks = items.filter((item) => item.mediaType === 'audiobook').length;
    const videos = items.filter((item) => item.mediaType === 'video').length;
    const unclassified = items.filter((item) => item.mediaType === 'unclassified' || item.mediaType === 'other').length;

    const diagnosticsEl = document.querySelector('#library-classification-diagnostics');
    if (diagnosticsEl) {
      diagnosticsEl.replaceChildren();
      const summaryList = document.createElement('div');
      summaryList.className = 'library-diagnostics-pills';
      const pills = [
        { label: 'Comics', count: comics },
        { label: 'Books', count: books },
        { label: 'Games', count: games },
        { label: 'Software', count: software },
        { label: 'Audiobooks', count: audiobooks },
        { label: 'Videos', count: videos },
        { label: 'Unclassified', count: unclassified },
        { label: 'Unimported / Rejected', count: rejectedPurchaseItems.length }
      ];
      if (overrideCount > 0) pills.push({ label: 'Manual overrides', count: overrideCount });

      for (const p of pills) {
        const span = document.createElement('span');
        span.className = 'library-diag-pill';
        span.textContent = `${p.label}: ${p.count}`;
        summaryList.append(span);
      }
      diagnosticsEl.append(summaryList);
    }

    const rejectedCountSpan = document.querySelector('#library-rejected-count');
    const rejectedEmpty = document.querySelector('#library-rejected-empty');
    const rejectedActions = document.querySelector('#library-rejected-actions');
    const rejectedList = document.querySelector('#library-rejected-list');

    if (rejectedCountSpan) rejectedCountSpan.textContent = String(rejectedPurchaseItems.length);
    if (rejectedEmpty) rejectedEmpty.hidden = rejectedPurchaseItems.length > 0;
    if (rejectedActions) rejectedActions.hidden = rejectedPurchaseItems.length === 0;

    if (rejectedList) {
      rejectedList.replaceChildren();
      for (const rec of rejectedPurchaseItems) {
        const li = document.createElement('li');
        li.className = 'library-rejected-item';

        const titleSpan = document.createElement('strong');
        titleSpan.textContent = rec.title;
        const metaSpan = document.createElement('span');
        metaSpan.className = 'library-rejected-meta';
        const rejFormats = Array.isArray(rec.formats) ? rec.formats : null;
        const formatsText = rejFormats && rejFormats.length > 0
          ? `Formats: ${rejFormats.map(f => f.startsWith('.') ? f : (/^[a-z0-9]{2,10}$/iu.test(f) ? '.' + f.toLowerCase() : f)).join(', ')}`
          : rejFormats && rejFormats.length === 0
          ? (rec.delivery === 'direct-download' ? 'No file formats in purchase metadata' : '')
          : (rec.delivery === 'direct-download' ? 'Format details require library rescan' : '');
        const deliveryText = rec.delivery === 'streaming' ? 'Streaming' : (rec.delivery === 'direct-download' ? 'Direct download' : (rec.delivery === 'external-key' ? 'External key' : ''));
        const parts = [
          rec.sourceBundle || rec.bundle?.title ? `Bundle: ${rec.sourceBundle || rec.bundle?.title}` : '',
          deliveryText,
          formatsText,
          rec.reason || 'Unverified content'
        ].filter(Boolean);
        metaSpan.textContent = ` (${parts.join(' · ')})`;

        const recoverSelect = document.createElement('select');
        recoverSelect.className = 'library-recover-select';
        recoverSelect.setAttribute('aria-label', `Select category to recover ${rec.title}`);
        for (const cat of ['book', 'comic', 'game', 'software', 'audiobook', 'video', 'unclassified']) {
          const opt = document.createElement('option');
          opt.value = cat;
          opt.textContent = mediaTypeLabel(cat);
          recoverSelect.append(opt);
        }

        const recoverBtn = document.createElement('button');
        recoverBtn.type = 'button';
        recoverBtn.className = 'library-recover-btn secondary';
        recoverBtn.textContent = 'Import to library';
        recoverBtn.addEventListener('click', async () => {
          try {
            await mutate('recoverRejectedItem', rec, recoverSelect.value);
            await refresh();
          } catch (err) {
            alert(`Failed to recover item: ${err.message}`);
          }
        });

        const dismissBtn = document.createElement('button');
        dismissBtn.type = 'button';
        dismissBtn.className = 'library-dismiss-btn secondary';
        dismissBtn.textContent = 'Dismiss';
        dismissBtn.addEventListener('click', async () => {
          try {
            await mutate('dismissRejectedItem', rec);
            await refresh();
          } catch (err) {
            alert(`Failed to dismiss item: ${err.message}`);
          }
        });

        li.append(titleSpan, metaSpan, ' ', recoverSelect, ' ', recoverBtn, dismissBtn);
        rejectedList.append(li);
      }
    }

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
      const wishes = parsed.schemaVersion >= 3 ? 'wishes missing here are added; your current wishes are kept' : 'this backup has no wishlist, so your wishlist does not change';
      if (!confirm(`Add this backup (${items.length} unique items) to your saved library?\n\nPurchases, corrections and saved accounts already in this browser are kept; the backup adds what is missing. A saved account that is not in the backup stays as a saved account.\n\nWishlist: ${wishes}.\nKey reminder reviews: the newer decision is kept for each key.`)) {
        $('#import-status').textContent = 'Restore cancelled. Your library is unchanged.'; return;
      }
      await mutate('restore',parsed);
      await refresh();
      $('#import-status').textContent = `Backup restored: ${items.length} unique items from the backup were added to your saved library. Nothing already saved was removed; your next quick scan rechecks all completed orders.`;
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
    try {
      const capabilities = await FanaticalLibrary.testGalacticLink(message => chrome.runtime.sendMessage(id, message));
      status.textContent = 'Connected to Galactic Library. You can now check bundle items against your other saved libraries.';
      const details = document.createElement('details');
      details.className = 'settings-help';
      const summary = document.createElement('summary');
      summary.textContent = 'Show technical details';
      const info = document.createElement('p');
      info.textContent = `Galactic Library ${capabilities.appVersion || 'connected'}. ${capabilities.advertised ? 'Media: ' + (capabilities.mediaTypes.join(', ') || 'none') + '; reviewed contents ' + (capabilities.reviewedContents ? 'supported' : 'unavailable') + '; entitlement reminders ' + (capabilities.entitlementReminders ? 'supported' : 'unavailable') + '.' : 'Capabilities not advertised; newer features remain unconfirmed.'}`;
      details.append(summary, info);
      status.append(details);
    } catch (error) {
      status.textContent = "Could not connect to Galactic Library. Make sure it's installed and enabled, then try Check connection again.";
      const details = document.createElement('details');
      details.className = 'settings-help';
      const summary = document.createElement('summary');
      summary.textContent = 'Show technical details';
      const err = document.createElement('p');
      err.textContent = `Error: ${error.message}. Enable or update Galactic Library and check Advanced pairing if using an unpacked build. A receiver manifest may restrict custom IDs; failed transport does not prove it is uninstalled.`;
      details.append(summary, err);
      status.append(details);
    } finally {
      button.disabled = false;
    }
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

  $('#continue-full-scan').addEventListener('click', () => { chrome.tabs.create({ url: ordersUrl }); });
  $('#discard-full-scan').addEventListener('click', async () => {
    if (!confirm('Discard the unfinished Full scan? Purchases it already saved stay in your library; the next Full scan starts from the first order.')) return;
    try { const response = await chrome.runtime.sendMessage({ type: 'FANATICAL_SCAN_CONTROL', action: 'discard' }); if (!response?.ok) throw Error(response?.error ?? 'Unavailable.'); $('#full-scan-note').textContent = 'Unfinished Full scan discarded. No saved purchases were removed.'; }
    catch (error) { $('#full-scan-note').textContent = `Discard failed: ${error.message}`; }
    await renderFullScanState();
  });
  $('#open-orders').addEventListener('click', () => {
    chrome.tabs.create({ url: ordersUrl });
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

  // Both catalogs list the same merged title rows the Library shows; saved records are only read.
  const exportCatalog=async format=>{
    if(libraryBusy)return;setLibraryBusy(true);
    try{
      const saved=await chrome.storage.local.get({fanaticalLibraryItems:[]}),rows=consolidateLibrary(saved.fanaticalLibraryItems),link=document.createElement('a');
      const csv=format==='csv',content=csv?createTitleCatalogCsv(rows):JSON.stringify(createTitleCatalog(rows),null,2);
      link.href=URL.createObjectURL(new Blob([content],{type:csv?'text/csv;charset=utf-8':'application/json'}));link.download='fanatical-title-catalog.'+(csv?'csv':'json');link.click();setTimeout(()=>URL.revokeObjectURL(link.href),0);
      $('#local-status').textContent=csv?`Exported ${rows.length.toLocaleString()} titles with their purchase counts and dates as CSV; this is not a recoverable ownership backup.`:'Exported catalog titles and identity metadata only; this is not a recoverable ownership backup.';
    }catch{$('#local-status').textContent='Could not export the title catalog.';}finally{setLibraryBusy(false);}
  };
  $('#export-catalog').addEventListener('click',()=>exportCatalog('json'));
  $('#export-catalog-csv').addEventListener('click',()=>exportCatalog('csv'));

  document.querySelector('#library-dismiss-all-rejected')?.addEventListener('click', async () => {
    if (!confirm('Dismiss all unimported/rejected items? You can recover them in a future rescan if needed.')) return;
    try {
      await mutate('dismissRejectedItem', 'all');
      await refresh();
    } catch (err) {
      alert(`Failed to dismiss rejected items: ${err.message}`);
    }
  });

  $('#reset').addEventListener('click', async () => {
    if (libraryBusy) return;
    if (!confirm('Clear all saved accounts, every locally stored Fanatical title, scan history, and import summary? Your wishlist, display preferences, sharing preference and Galactic Library link will be kept. Turn automatic sharing off first if you do not want Galactic Library to send its saved purchases back.')) return;
    setLibraryBusy(true);
    try {
      await mutate('clear');
      $('#local-status').textContent = 'Library and scan history cleared.';
      await refresh();
    } catch { $('#local-status').textContent = 'Could not clear the library.'; }
    finally { setLibraryBusy(false); }
  });

  LibraryAccountProfiles.mount($('#account-profiles'),{request:mutate,keys:['fanaticalProfileLabel','fanaticalAccountId','fanaticalProfileArchives'],onActiveChange:()=>refresh({libraryOnly:true}).catch(()=>{})});
  globalThis.LibraryBrowser = {
    consolidateFanaticalItemInto,
    filterAndSortLibrary,
    getItemPurchaseDate,
    getState: () => ({ ...libraryBrowserState }),
    setState: (next) => { Object.assign(libraryBrowserState, next); saveLibraryState(libraryBrowserState); renderLibraryBrowser(); },
    render: () => renderLibraryBrowser()
  };
  let liveDirty=false,liveRefresh=null;
  const libraryKeys=['fanaticalLibraryItems','fanaticalImportSummary','fanaticalFullScanPass','fanaticalLastScanAttempt','fanaticalProfileLabel','fanaticalAccountId','fanaticalProfileArchives','fanaticalHistoricalItems','fanaticalOrderNavigation','rejectedPurchaseItems','mediaTypeOverrides'];
  chrome.storage.onChanged?.addListener((changes,area)=>{
    if(area!=='local'||!libraryKeys.some(key=>Object.hasOwn(changes,key)))return;
    liveDirty=true;
    if(!liveRefresh)liveRefresh=(async()=>{do{liveDirty=false;await refresh({libraryOnly:true});}while(liveDirty);})().catch(()=>{$('#local-status').textContent='Could not refresh the library. Reload this page to read the latest saved purchases.';}).finally(()=>{liveRefresh=null;});
    return liveRefresh;
  });
  try { await refresh(); } catch { $('#local-status').textContent = 'Could not load local library settings. Reload this page and try again.'; }
}());
