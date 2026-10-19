(function fanaticalPageOverlay() {
  'use strict';
  const F = globalThis.FanaticalLibrary;
  if (!F) return;
  const titleCollator = {compare:(left,right)=>globalThis.LibraryTitleSort.compare(left,right)};
  const state = { wishlist:[],planGoal:'products',planUncertain:false,planOpen:false,wishOpen:false,offerWishPage:0, capabilityId:null, softwareSupported:false, capabilityFailed:false, url: '', parsed: null, rendering: false, timer: null, galactic: new Map(), requests: new Map(), failed: new Set(), lookupFailures: new Set(), galacticEnabled: false, galacticStatus: 'Not configured.', showNewOnly: false, showNewOnlyLoaded: false, pickMixReflow: [], summaryDirty: false, summaryPreferences:{minimized:false,position:'bottom-right'}, revision: 0 };
  const catalogueState = { items: null, filters: null, rendering: false };
  let observer = null;
  let diagnosticsEnabled = false;

  function updateDiagnostics(parent, lines, entries = []) {
    let details = parent.querySelector('[data-fanatical-library-diagnostics]');
    if (!diagnosticsEnabled) { details?.remove(); return; }
    const signature = JSON.stringify([lines, entries]);
    if (details?.dataset.diagnosticsContent === signature) return;
    if (!details) {
      details = document.createElement('details'); details.dataset.fanaticalLibraryDiagnostics = 'true'; details.className = 'fanatical-library-diagnostics';
      const heading = document.createElement('summary'); heading.textContent = 'Diagnostics'; details.append(heading); parent.append(details);
    }
    details.dataset.diagnosticsContent = signature;
    details.querySelectorAll('ul, ol').forEach((list) => list.remove());
    for (const [tag, rows] of [['ul', lines], ['ol', entries]]) {
      if (!rows.length) continue;
      const list = document.createElement(tag);
      for (const text of rows) { const row = document.createElement('li'); row.textContent = text; list.append(row); }
      details.append(list);
    }
  }

  function catalogueDiagnostics(cards) {
    let host = document.querySelector('#fanatical-library-catalogue-diagnostics');
    if (!diagnosticsEnabled) {
      host?.remove(); document.querySelector('#fanatical-library-catalogue-controls [data-fanatical-library-diagnostics]')?.remove(); return;
    }
    const controls = document.querySelector('#fanatical-library-catalogue-controls');
    if (controls) { host?.remove(); host = controls; }
    else if (!host) {
      host = document.createElement('aside'); host.id = 'fanatical-library-catalogue-diagnostics'; host.className = 'fanatical-library-catalogue-controls'; document.body.append(host);
    }
    const entries = [...cards].map(([card, offer]) => ({ title: catalogueTitle(card, offer), days: catalogueExpiry(card), slot: catalogueSlot(card) }));
    updateDiagnostics(host, [
      `Catalogue: ${F.cataloguePageKind(location.pathname)}; ${entries.length} offer cards detected.`,
      `Cards with a readable expiry: ${entries.filter((entry) => entry.days !== null).length}; unknown expiry: ${entries.filter((entry) => entry.days === null).length}.`,
      `Filtered cards: ${entries.filter((entry) => entry.slot.classList.contains('fanatical-library-catalogue-filtered')).length}.`,
      `Sorting: ${controls ? 'time left, then natural alphabetical title' : 'native featured sections (not reordered)'}.`
    ], entries.map((entry) => `${entry.title}: ${entry.days === null ? 'expiry unavailable' : `${Number(entry.days.toFixed(2))} days left`}`));
  }

  function isCataloguePage() {
    return F.cataloguePageKind(location.pathname) !== null;
  }

  function isCatalogueCategory() {
    return ['all', 'games', 'books', 'other', 'mystery'].includes(F.cataloguePageKind(location.pathname));
  }

  function catalogueCard(link) {
    // HitCard titles may exist only while hovered. The stable card contains
    // both the cover and the countdown; a hover overlay contains neither
    // the full card contents nor a dependable expiry.
    if (link.closest('.HitCardPopup')) return null;
    const hitCard = link.closest('.HitCard');
    if (hitCard) return hitCard;
    for (let node = link; node && node !== document.body; node = node.parentElement) {
      if (!node.querySelector('img') || node.querySelectorAll('h2, h3, h4').length !== 1) continue;
      const offers = new Set([...node.querySelectorAll('a[href]')].map((anchor) => F.catalogueOffer(anchor.href)?.slug).filter(Boolean));
      if (offers.size === 1) return node;
    }
    return null;
  }

  function catalogueOfferCount(node) {
    return new Set([...node.querySelectorAll('a[href]')].map((link) => {
      const offer = F.catalogueOffer(link.href);
      return offer ? `${offer.kind}/${offer.slug}` : null;
    }).filter(Boolean)).size;
  }

  function catalogueSlot(card) {
    const hitCardSlot = card.closest('.HitCardContainer');
    if (hitCardSlot) return hitCardSlot;
    let child = card;
    for (let parent = child.parentElement; parent && parent !== document.body; child = parent, parent = parent.parentElement) {
      const slots = [...parent.children].filter((node) => catalogueOfferCount(node) === 1);
      if (slots.length >= 2 && slots.includes(child)) return child;
    }
    return card;
  }

  function catalogueTitle(card, offer) {
    const heading = card.querySelector('.hit-card-game-name, h2, h3, h4')?.textContent?.trim();
    if (heading) return heading;
    const coverTitle = card.querySelector('.HitCard__main img[alt], img[alt]')?.getAttribute('alt')?.trim();
    return coverTitle?.replace(/^product cover for\s+/iu, '') || offer.slug;
  }

  function catalogueExpiry(card) {
    const clock = card.querySelector('.CountdownTimer__clock');
    if (clock) return F.catalogueDaysLeft(clock.textContent);
    const timer = card.querySelector('.CountdownTimer, [class*="countdown" i]');
    return timer ? F.catalogueDaysLeft(timer.textContent) : null;
  }

  function catalogueFilters(value) {
    return { hidePurchased: Boolean(value?.hidePurchased), endingSoon: Boolean(value?.endingSoon) };
  }

  function renderCatalogueControls() {
    if (!isCatalogueCategory()) { document.querySelector('#fanatical-library-catalogue-controls')?.remove(); return; }
    let panel = document.querySelector('#fanatical-library-catalogue-controls');
    if (!panel) {
      panel = document.createElement('aside'); panel.id = 'fanatical-library-catalogue-controls'; panel.className = 'fanatical-library-catalogue-controls';
      const heading = document.createElement('strong'); heading.textContent = 'Catalogue filters'; panel.append(heading);
      for (const [key, label] of [['hidePurchased', 'Hide purchased'], ['endingSoon', 'Ending within 7 days']]) {
        const field = document.createElement('label'); const input = document.createElement('input'); input.type = 'checkbox'; input.dataset.catalogueFilter = key;
        field.title = key === 'hidePurchased' ? 'Hides offers previously bought from, including Pick & Mix offers that may still contain new items.' : 'Hides offers with more than 7 days left or no visible expiry.';
        field.append(input, ` ${label}`); panel.append(field);
      }
      const note = document.createElement('small'); note.textContent = 'Sorted by time left, then title.'; panel.append(note);
      panel.addEventListener('change', () => {
        const next = {};
        for (const input of panel.querySelectorAll('input[data-catalogue-filter]')) next[input.dataset.catalogueFilter] = input.checked;
        catalogueState.filters = catalogueFilters(next);
        F.storageSet({ fanaticalCatalogueFilters: catalogueState.filters }).catch(() => {});
        schedule(true);
      });
      document.body.append(panel);
    }
    for (const input of panel.querySelectorAll('input[data-catalogue-filter]')) input.checked = catalogueState.filters[input.dataset.catalogueFilter];
  }

  function compareCatalogueEntries(left, right) {
    if (left.daysLeft !== null && right.daysLeft !== null && left.daysLeft !== right.daysLeft) return left.daysLeft - right.daysLeft;
    if (left.daysLeft !== null && right.daysLeft === null) return -1;
    if (left.daysLeft === null && right.daysLeft !== null) return 1;
    return titleCollator.compare(left.title, right.title) || left.offer.slug.localeCompare(right.offer.slug);
  }

  function sortCatalogueRows(groups) {
    const sections = new Map();
    for (const [parent, entries] of groups) {
      const section = parent.parentElement;
      if (!section) continue;
      const rows = sections.get(section) ?? [];
      rows.push({ parent, entries });
      sections.set(section, rows);
    }
    for (const rows of sections.values()) {
      if (rows.length < 2) continue;
      const current = rows.flatMap((row) => row.entries);
      const ordered = [...current].sort(compareCatalogueEntries);
      if (ordered.every((entry, index) => entry === current[index])) continue;
      const slots = rows.map((row) => row.entries.map((entry) => {
        const marker = document.createComment('fanatical-library-catalogue-slot');
        row.parent.replaceChild(marker, entry.slot);
        return marker;
      }));
      let index = 0;
      for (const row of slots) for (const marker of row) marker.parentElement.replaceChild(ordered[index++].slot, marker);
    }
  }

  function applyCatalogueCategory(cards, purchased) {
    document.querySelectorAll('.fanatical-library-catalogue-filtered').forEach((slot) => slot.classList.remove('fanatical-library-catalogue-filtered'));
    if (!isCatalogueCategory()) { renderCatalogueControls(); return; }
    const entries = [...cards].map(([card, offer]) => {
      const slot = catalogueSlot(card);
      return { card, slot, offer, title: catalogueTitle(card, offer), daysLeft: catalogueExpiry(card), purchased: purchased.has(offer.slug) };
    });
    const groups = new Map();
    for (const entry of entries) {
      const parent = entry.slot.parentElement;
      if (!parent || parent === document.body) continue;
      const group = groups.get(parent) ?? [];
      if (!group.some((item) => item.slot === entry.slot)) group.push(entry);
      groups.set(parent, group);
    }
    for (const [parent, group] of groups) {
      if (group.length < 2) continue;
      const ordered = [...group].sort(compareCatalogueEntries);
      if (ordered.every((entry, index) => entry === group[index])) continue;
      const marker = document.createComment('fanatical-library-catalogue-sort-anchor');
      parent.insertBefore(marker, group[0].slot);
      for (const entry of ordered) parent.insertBefore(entry.slot, marker);
      marker.remove();
      groups.set(parent, ordered);
    }
    sortCatalogueRows(groups);
    for (const entry of entries) {
      const filtered = (catalogueState.filters.hidePurchased && entry.purchased) || (catalogueState.filters.endingSoon && (entry.daysLeft === null || entry.daysLeft > 7));
      entry.slot.classList.toggle('fanatical-library-catalogue-filtered', filtered);
    }
    renderCatalogueControls();
  }

  async function renderCatalogue() {
    if (catalogueState.rendering || !isCataloguePage()) return;
    catalogueState.rendering = true;
    try {
      if (state.parsed) {
        restorePickMixReflow();
        state.parsed = null;
        state.url = '';
        document.body.classList.remove('fanatical-library-show-new-only');
      }
      state.panelView=null;
      document.querySelector('[data-fanatical-library-summary]')?.remove();
      if (!catalogueState.items || !catalogueState.filters) {
        const stored = await chrome.storage.local.get({ fanaticalLibraryItems: [], fanaticalCatalogueFilters: {}, fanaticalShowDiagnostics: false,fanaticalWishlistItems:[] });
        catalogueState.items = stored.fanaticalLibraryItems;
        catalogueState.filters = catalogueFilters(stored.fanaticalCatalogueFilters);
        diagnosticsEnabled = Boolean(stored.fanaticalShowDiagnostics);
      }
      if (!isCataloguePage()) return;
      const purchased = F.purchasedBundleSlugs(catalogueState.items);
      const wanted = new Map();
      const cards = new Map();
      for (const link of document.querySelectorAll('a[href]')) {
        const offer = F.catalogueOffer(link.href);
        if (!offer) continue;
        const card = catalogueCard(link);
        if (!card) continue;
        cards.set(card, offer);
        if (purchased.has(offer.slug)) wanted.set(card, { ...offer, purchase: purchased.get(offer.slug) });
      }
      observer?.disconnect();
      for (const card of document.querySelectorAll('.fanatical-library-catalogue-card')) {
        if (!wanted.has(card)) card.classList.remove('fanatical-library-catalogue-card');
      }
      for (const badge of document.querySelectorAll('[data-fanatical-library-catalogue-for]')) {
        const card = badge.parentElement;
        if (!wanted.has(card) || badge.dataset.fanaticalLibraryCatalogueFor !== wanted.get(card).slug) badge.remove();
      }
      for (const [card, offer] of wanted) {
        card.classList.add('fanatical-library-catalogue-card');
        if (card.querySelector(`[data-fanatical-library-catalogue-for="${offer.slug}"]`)) continue;
        const badge = document.createElement('span');
        badge.className = 'fanatical-library-catalogue-badge';
        badge.dataset.fanaticalLibraryCatalogueFor = offer.slug;
        badge.textContent = offer.kind === 'pick-mix' ? 'Previously purchased' : 'Purchased';
        const date = offer.purchase.purchaseDate && !Number.isNaN(Date.parse(offer.purchase.purchaseDate)) ? ` on ${new Date(offer.purchase.purchaseDate).toLocaleDateString()}` : '';
        badge.title = offer.kind === 'pick-mix' ? `Purchased items from this Pick & Mix offer${date}; other items may still be new.` : `Purchased this bundle${date}. Check its tiers for any items you do not own.`;
        badge.setAttribute('aria-label', `Fanatical Library: ${badge.textContent}`);
        card.append(badge);
      }
      applyCatalogueCategory(cards, purchased);
      catalogueDiagnostics(cards);
    } finally {
      catalogueState.rendering = false;
      observer?.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  function alphabetize(products) {
    return [...products].sort((left, right) => titleCollator.compare(left.title, right.title) || String(left.sourceItemId).localeCompare(String(right.sourceItemId)));
  }

  function cardTitle(card) {
    return card.querySelector('.card-product-name')?.textContent?.trim() || card.querySelector('img[alt]')?.alt?.trim() || '';
  }

  function upsertCardTitle(card, product, match) {
    const host = card.querySelector('.cover-container') ?? card;
    // A SPA card node can be repurposed for another product, just as with
    // ownership badges. Its old title label must not survive that reuse.
    for (const stale of host.querySelectorAll('[data-fanatical-library-title-for]')) stale.remove();
    const label = document.createElement('span');
    label.className = 'fanatical-library-card-title';
    label.dataset.fanaticalLibraryTitleFor = product.sourceItemId;
    label.setAttribute('aria-hidden', 'true');
    host.append(label);
    label.textContent = product.title;
    label.title = product.title;
    appendRelatedTitles(label,match);
    if(['possible','partial'].includes(match?.state)){label.setAttribute('aria-hidden','false');label.classList.add('fanatical-library-card-title-with-match');}
  }

  function sortPickMixCards() {
    document.querySelectorAll('.fanatical-library-sorted-empty-row').forEach((row) => row.classList.remove('fanatical-library-sorted-empty-row'));
    const rows = [...document.querySelectorAll('.three-column-row')].filter((row) => row.querySelector('article.PickAndMixCard'));
    if (rows.length < 2) return;
    const primaryParent = rows[0].parentElement;
    if (!primaryParent) return;
    const originalParents = new Set(rows.map((row) => row.parentElement));
    const ordered = [...rows].sort((left, right) => titleCollator.compare(cardTitle(left), cardTitle(right)) || cardTitle(left).localeCompare(cardTitle(right)));
    if (!ordered.every((row, index) => row === rows[index] && row.parentElement === primaryParent)) {
      // A card is not a stable insertion point: moving it can rotate the
      // remaining sequence on the next iteration. A marker stays put until
      // every card has been moved into its exact sorted position.
      const marker = document.createComment('fanatical-library-sort-anchor');
      primaryParent.insertBefore(marker, rows.find((row) => row.parentElement === primaryParent) ?? null);
      for (const row of ordered) primaryParent.insertBefore(row, marker);
      marker.remove();
    }
    for (const parent of originalParents) {
      if (parent !== primaryParent && parent.children.length === 0) parent.classList.add('fanatical-library-sorted-empty-row');
    }
  }

  function sortStandardBundleCards() {
    for (const grid of document.querySelectorAll('.fan-grid-container')) {
      const rows = [...grid.children].filter((row) => row.matches('.three-column-row, .five-column-row') && row.querySelector('article.bundle-product-card'));
      if (rows.length < 2) continue;
      const ordered = [...rows].sort((left, right) => titleCollator.compare(cardTitle(left), cardTitle(right)) || cardTitle(left).localeCompare(cardTitle(right)));
      if (ordered.every((row, index) => row === rows[index])) continue;
      const marker = document.createComment('fanatical-library-tier-sort-anchor');
      grid.insertBefore(marker, rows[0]);
      for (const row of ordered) grid.insertBefore(row, marker);
      marker.remove();
    }
  }

  function route() {
    if (isCataloguePage()) return null;
    const path = location.pathname.replace(/\/+$/u, ''); const slug = path.split('/').pop();
    if (!slug || !/^[a-z0-9-]+$/iu.test(slug)) return null;
    if (path.includes('/pick-and-mix/')) return { kind: 'pick-mix', slug, endpoint: `/api/pick-and-mix/${encodeURIComponent(slug)}/en` };
    if (path.includes('/bundle/') || path.includes('/products-group/')) return { kind: 'standard', slug, endpoint: `/api/products-group/${encodeURIComponent(slug)}/en` };
    return null;
  }

  function isOrderHistoryPage() {
    return /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?orders\/?$/iu.test(location.pathname);
  }

  function importerResult(summary, fullScan) {
    const scope = F.purchaseImportScope({...summary,scanMode:fullScan?'full':'quick'});
    const result = `${scope}; imported ${summary.addedProducts} new item${summary.addedProducts === 1 ? '' : 's'}; ${summary.ownedLeafProducts} total items.`;
    return `${result} ${summary.historyCoverage ?? ''}`.trim();
  }

  function ensureOrderImporter() {
    if (document.querySelector('#fanatical-library-importer') || !document.body) return;
    const panel = document.createElement('section');
    panel.id = 'fanatical-library-importer';
    panel.className = 'fanatical-library-importer';
    const heading = document.createElement('strong'); heading.textContent = 'Fanatical Library';
    const description = document.createElement('span'); description.textContent = 'Import purchases from the Fanatical account signed in to this browser.';
    const actions = document.createElement('div'); actions.className = 'fanatical-library-import-actions';
    const quick = document.createElement('button'); quick.type = 'button'; quick.dataset.importMode = 'new'; quick.textContent = 'Import new purchases';
    quick.title = 'Checks for new purchases and skips previously imported purchases with saved scan history.';
    const full = document.createElement('button'); full.type = 'button'; full.dataset.importMode = 'all'; full.textContent = 'Rescan all purchases'; full.title = 'Reprocesses every completed order and rebuilds the local Fanatical library.';
    actions.append(quick, full);
    const status = document.createElement('output'); status.setAttribute('aria-live', 'polite');
    const profileControls=document.createElement('div'); profileControls.className='library-import-profile';
    profileControls.innerHTML='<label>Account nickname <input data-profile-label maxlength="100" placeholder="e.g. personal"></label><label><input type="checkbox" data-profile-confirm> The signed-in account matches this nickname</label><label><input type="checkbox" data-profile-switch> Save a new account on full rescan</label>';
    chrome.storage.local.get({fanaticalProfileLabel:''}).then(saved=>{const input=profileControls.querySelector('[data-profile-label]');if(!input.value)input.value=saved.fanaticalProfileLabel;}).catch(()=>{});
    const intro=document.createElement('div'); intro.className='library-import-description';
    const help=document.createElement('details');help.innerHTML='<summary>How account nicknames work</summary><p>Choose a local nickname, such as personal. It does not sign you in or detect your account. Only the active account is checked for ownership. Use Saved accounts below to switch back to a saved snapshot, then Import new purchases to refresh it. Rename account keeps its purchases and scan history. For a new account, sign in on the website, enter a new nickname, select Save a new account, and rescan all purchases once.</p>';
    intro.append(heading,' ',description,help);
    const footer=document.createElement('div');footer.className='library-import-footer';footer.append(status,actions);
    panel.append(intro,profileControls,footer);
    document.body.prepend(panel);
    LibraryAccountProfiles.mount(intro,{request:async(operation,...args)=>{const result=await chrome.runtime.sendMessage({type:'FANATICAL_STORE',operation,args});if(!result?.ok)throw Error(result?.error??'Saved accounts are unavailable.');return result.result;},keys:['fanaticalProfileLabel','fanaticalProfileArchives'],onActiveChange:(label,previous)=>{const input=profileControls.querySelector('[data-profile-label]');if(previous===undefined&&input.value)return;const changed=input.value!==label;input.value=label;if(changed){profileControls.querySelector('[data-profile-confirm]').checked=false;if(previous!==undefined)status.textContent='Active account: '+(label||'Not yet named')+'. Import new purchases checks for updates.';}profileControls.querySelector('[data-profile-switch]').checked=false;}});
    profileControls.querySelector('[data-profile-label]').addEventListener('input',()=>{profileControls.querySelector('[data-profile-confirm]').checked=false;});
    const buttons = [quick, full];
    for (const button of buttons) button.addEventListener('click', async () => {
      const fullScan = button.dataset.importMode === 'all';
      if (fullScan && !confirm('Full scan every completed Fanatical purchase? This can take longer.')) return;
      buttons.forEach((control) => { control.disabled = true; });
      status.textContent = 'Loading your purchase list\u2026';
      const progressId = [...crypto.getRandomValues(new Uint8Array(16))].map(value=>value.toString(16).padStart(2,'0')).join('');
      const onProgress = event => {
        if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'FANATICAL_IMPORT_PROGRESS' || event.data.progressId !== progressId) return;
        const message = F.purchaseImportProgress(event.data.progress);
        if (message) status.textContent = message;
      };
      window.addEventListener('message',onProgress);
      try {
        const response = await chrome.runtime.sendMessage({ type: 'FANATICAL_IMPORT_PURCHASES', fullScan,progressId,profileLabel:profileControls.querySelector('[data-profile-label]').value,confirmed:profileControls.querySelector('[data-profile-confirm]').checked,switchProfile:profileControls.querySelector('[data-profile-switch]').checked });
        status.textContent = response?.ok ? importerResult(response.summary, fullScan||response.summary.scanMode==='full') : (response?.error ?? 'Import failed.');
      } catch {
        status.textContent = 'Import failed. Refresh this signed-in Fanatical Orders page and try again.';
      } finally {
        window.removeEventListener('message',onProgress);
        buttons.forEach((control) => { control.disabled = false; });
      }
    });
  }

  const parse = F.parseBundle;

  async function loadPublicBundle(current) {
    const pageUrl = location.href;
    if (state.url === pageUrl && state.parsed) return state.parsed;
    const response = await chrome.runtime.sendMessage({ type: 'FANATICAL_GET_PUBLIC_BUNDLE', path: current.endpoint });
    if (!response?.ok) throw new Error(response?.error ?? 'Fanatical bundle data is unavailable.');
    const parsed = parse(response.bundle, current.kind);
    if (pageUrl === location.href) { state.panelView=null;state.planOpen=false;state.wishOpen=false;state.offerWishPage=0; state.parsed = parsed; state.url = pageUrl; state.capabilityId=null;state.galactic.clear(); state.requests.clear(); state.failed.clear(); }
    return parsed;
  }

  async function queryGalactic(products, extensionId) {
    extensionId=F.resolveGalacticId(extensionId,chrome.runtime);
    state.galacticEnabled = F.isExtensionId(extensionId);
    if (!state.galacticEnabled) { state.galacticStatus = 'Not configured.'; return; }
    const revision=state.revision,pageUrl=location.href;
    const availabilityScope = JSON.stringify([extensionId,revision,pageUrl]);
    const availability = state.galacticAvailability?.scope === availabilityScope
      ? state.galacticAvailability.value : await F.galacticAvailability(message => chrome.runtime.sendMessage(extensionId, message));
    if (revision !== state.revision || pageUrl !== location.href) return;
    if (availability.state !== 'failed') state.galacticAvailability = {scope:availabilityScope,value:availability};
    state.galacticConnectionState = availability.state;
    if (availability.state === 'unavailable' || availability.state === 'unlinked') {
      state.galacticEnabled = false;
      state.galactic.clear(); state.failed.clear(); state.lookupFailures.clear();
      state.softwareSupported = false; state.capabilityFailed = false; state.capabilityId = null;
      state.galacticStatus = 'Not linked; local library only.';
      return;
    }
    if(state.capabilityId!==extensionId&&products.some(product=>product.mediaType==='software')){
      state.capabilityId=extensionId;state.softwareSupported=false;state.capabilityFailed=false;
      try{const capabilities=await F.galacticCapabilities(message=>chrome.runtime.sendMessage(extensionId,message));if(revision!==state.revision||pageUrl!==location.href)return;state.softwareSupported=capabilities.mediaTypes.includes('software');}catch{if(revision!==state.revision||pageUrl!==location.href)return;state.capabilityFailed=true;}
    }
    const requests = [...new Map(F.galacticRequestItems(products,state.softwareSupported).map(request => { request.requestId = requestId(request); return [request.requestId, request]; })).values()].filter(request => !state.galactic.has(request.requestId));
    if(state.capabilityFailed&&!requests.length){state.galacticStatus='Check incomplete: capability check failed; software ownership is unresolved.';return;}
    if (!requests.length && !state.galactic.size) { state.galacticStatus = 'No unresolved supported items to check; pairing has not been tested on this page.'; return; }
    let permissionRevoked = false;
    const lookup = await F.queryGalacticItems(requests, message => {
      if (availability.state === 'failed') throw Error(availability.error);
      return F.sendGalacticMatch(async request=>{
        const response=await chrome.runtime.sendMessage(extensionId,request);
        if (F.galacticPermissionDenied(response)) permissionRevoked=true;
        return response;
      },message);
    });
    if (revision !== state.revision || pageUrl !== location.href) return;
    if (permissionRevoked) {
      state.galacticEnabled=false; state.galacticConnectionState='unlinked';
      state.galacticAvailability={scope:availabilityScope,value:{state:'unlinked'}};
      state.galactic.clear();state.failed.clear();state.lookupFailures.clear();
      state.galacticStatus='Not linked; local library only.';
      return;
    }
    for (const [id, result] of lookup.results) { state.galactic.set(id, result); state.failed.delete(id); }
    for (const id of lookup.failed) state.failed.add(id);
    state.lookupFailures=lookup.failures;
    state.galacticStatus = state.capabilityFailed?'Incomplete: software capability check failed.':state.failed.size ? `Check incomplete: ${state.failed.size} ownership checks failed; these items may already be owned. ${[...state.lookupFailures].join("; ")}.` : `Available. ${state.galactic.size} items checked; not found means not found in synced libraries.`;
  }

  function requestId(request) {
    const { requestId: ignored, ...evidence } = request;
    const key = JSON.stringify(evidence);
    if (!state.requests.has(key)) state.requests.set(key, `fan-${state.requests.size + 1}`);
    return state.requests.get(key);
  }
  function externalResult(product) {
    const request = F.galacticRequestItems([product],state.softwareSupported)[0];
    return request ? state.galactic.get(requestId(request)) || (state.galacticEnabled ? { matches: [], lookupIncomplete: true } : null) : null;
  }
  function status(product, localItems, localUnits) {
    // Extra exact-owned queries are context only; preserve the existing local result.
    const contextOnly=F.classify(product,localItems).state==='owned'&&!F.offerContents(product).entries.length;
    const lookup=query=>contextOnly&&query===product?(state.galacticEnabled?{matches:[],lookupIncomplete:true}:null):externalResult(query);
    const result = lookup(product);
    const match = F.resolveProduct(product, localItems, localUnits, lookup, 0, state.history);
    if (state.galacticEnabled && (!result || result.lookupIncomplete) && match.state !== 'owned' && (['game', 'book', 'audiobook'].includes(product.mediaType)||product.mediaType==='software'&&(state.softwareSupported||state.capabilityFailed))) {
      match.lookupIncomplete = true;
      if (match.state === 'new') { match.state = 'unchecked'; match.reason = 'No local match found. Galactic Library could not complete the ownership check; this item may already be owned.'; }
    }
    return match;
  }

  function cardContainer(anchor) {
    if (!anchor) return null;
    let imageFallback = null;
    for (let node = anchor; node && node !== document.body; node = node.parentElement) {
      const className = String(node.className ?? '');
      const productLike = /(?:card|product|tile|item|offer)/iu.test(className) || node.matches?.('article, li');
      const hasImage = Boolean(node.querySelector?.('img'));
      if (!imageFallback && hasImage) imageFallback = node;
      if (productLike && (hasImage || node.querySelector?.('a, button'))) return node;
    }
    return imageFallback ?? anchor.parentElement;
  }

  function cardFor(product) {
    const wanted = F.titleKey(product.title);
    const directCard = [...document.querySelectorAll('article.bundle-product-card, article.PickAndMixCard')].find((card) => {
      const title = card.querySelector('.card-product-name')?.textContent;
      const alt = card.querySelector('img[alt]')?.alt;
      return F.titleKey(title) === wanted || F.titleKey(alt) === wanted;
    });
    if (directCard) return directCard;
    const dataNode = [...document.querySelectorAll('[data-product-id], [data-product]')].find((node) => String(node.dataset?.productId ?? node.dataset?.product ?? '') === product.sourceItemId);
    if (dataNode) return cardContainer(dataNode);
    const links = [...document.querySelectorAll('a[href]')];
    const link = links.find((entry) => entry.getAttribute('href')?.toLowerCase().includes(`/${product.slug.toLowerCase()}`));
    if (link) return cardContainer(link);
    const titleSelectors = 'h1, h2, h3, h4, h5, h6, [data-testid*="title" i], [class*="title" i], [class*="name" i]';
    let title = [...document.querySelectorAll(titleSelectors)].find((node) => F.titleKey(node.textContent) === wanted);
    // Some Fanatical layouts use an unadorned text span for a product title.
    if (!title) title = [...document.querySelectorAll('body *')].find((node) => node.children.length === 0 && F.titleKey(node.textContent) === wanted);
    if (!title) title = [...document.querySelectorAll('img[alt]')].find((image) => F.titleKey(image.alt) === wanted);
    return cardContainer(title);
  }

  function selectedCount(products) {
    return selectedProducts(products).length;
  }
  function selectedProducts(products) {
    return products.filter((product) => {
      const card = cardFor(product); const classes = String(card?.className ?? '');
      return /\b(?:selected|chosen|active)\b/iu.test(classes) || Boolean(card?.querySelector('input:checked, [aria-pressed="true"], [aria-selected="true"]'));
    });
  }

  function restorePickMixReflow() {
    for (const group of state.pickMixReflow) {
      // Disconnect the temporary grid first so original child indexes refer
      // only to Fanatical's real card wrappers.
      group.grid.remove();
      for (const cell of [...group.cells].sort((left, right) => left.index - right.index)) {
        if (!cell.parent.isConnected) continue;
        cell.parent.insertBefore(cell.node, cell.parent.children[cell.index] ?? null);
      }
      for (const row of group.rows) {
        if (row.display) row.node.style.setProperty('display', row.display, row.priority);
        else row.node.style.removeProperty('display');
        delete row.node.dataset.fanaticalLibraryReflowDisplay;
        delete row.node.dataset.fanaticalLibraryReflowPriority;
      }
    }
    // Recover even if Fanatical replaced a grid while the checkbox was being
    // toggled and the in-memory reflow group no longer contains that row.
    document.querySelectorAll('[data-fanatical-library-reflow-display]').forEach((node) => {
      const display = node.dataset.fanaticalLibraryReflowDisplay;
      const priority = node.dataset.fanaticalLibraryReflowPriority;
      if (display) node.style.setProperty('display', display, priority);
      else node.style.removeProperty('display');
      delete node.dataset.fanaticalLibraryReflowDisplay;
      delete node.dataset.fanaticalLibraryReflowPriority;
    });
    state.pickMixReflow = [];
  }

  function reflowVisiblePickMixCards() {
    const rows = [...document.querySelectorAll('.three-column-row')].filter((row) => row.querySelector('article.PickAndMixCard'));
    const parent = rows[0]?.parentElement;
    if (!parent) return;
    const visibleRows = rows.map((node) => ({ node, parent, index: [...parent.children].indexOf(node) }))
      .filter((cell) => !cell.node.querySelector('.fanatical-library-card-owned, .fanatical-library-card-owned-elsewhere'));
    if (!visibleRows.length) return;

    // Copy the live dimensions of Fanatical's complete column wrappers.
    // These wrappers carry the site's gutters, so moving them intact keeps
    // card dimensions and row spacing unchanged.
    const positionedRows = rows.map((node) => ({ node, rect: node.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0);
    if (!positionedRows.length) return;
    const firstTop = Math.min(...positionedRows.map(({ rect }) => rect.top));
    const firstVisualRow = positionedRows
      .filter(({ rect }) => Math.abs(rect.top - firstTop) < 1)
      .sort((left, right) => left.rect.left - right.rect.left);
    const firstRect = firstVisualRow[0]?.rect;
    const nextRowRect = positionedRows.find(({ rect }) => firstRect && rect.top > firstRect.top + 1)?.rect;
    const grid = document.createElement('div'); grid.className = 'fanatical-library-pick-mix-reflow';
    if (firstVisualRow.length) {
      grid.style.gridTemplateColumns = firstVisualRow.map(({ rect }) => `${rect.width}px`).join(' ');
      const columnGap = firstVisualRow.length > 1 ? firstVisualRow[1].rect.left - firstVisualRow[0].rect.right : 0;
      const rowGap = nextRowRect && firstRect ? nextRowRect.top - firstRect.bottom : 0;
      grid.style.columnGap = `${Math.max(0, columnGap)}px`;
      grid.style.rowGap = `${Math.max(0, rowGap)}px`;
    }
    parent.insertBefore(grid, rows[0]);
    for (const cell of visibleRows) grid.append(cell.node);
    const visibleNodes = new Set(visibleRows.map(({ node }) => node));
    const savedRows = rows.filter((node) => !visibleNodes.has(node)).map((node) => ({ node, display: node.style.getPropertyValue('display'), priority: node.style.getPropertyPriority('display') }));
    for (const row of savedRows) {
      row.node.dataset.fanaticalLibraryReflowDisplay = row.display;
      row.node.dataset.fanaticalLibraryReflowPriority = row.priority;
      row.node.style.setProperty('display', 'none', 'important');
    }
    state.pickMixReflow.push({ grid, cells: visibleRows, rows: savedRows });
  }

  function applyNewOnlyFilter() {
    restorePickMixReflow();
    document.body.classList.remove('fanatical-library-show-new-only');
    document.querySelectorAll('[data-fanatical-library-filter-display]').forEach((node) => {
      const original = node.dataset.fanaticalLibraryFilterDisplay;
      const priority = node.dataset.fanaticalLibraryFilterPriority;
      if (original) node.style.setProperty('display', original, priority);
      else node.style.removeProperty('display');
      delete node.dataset.fanaticalLibraryFilterDisplay;
      delete node.dataset.fanaticalLibraryFilterPriority;
    });
    document.querySelectorAll('.fanatical-library-bundle-filtered').forEach((node) => node.classList.remove('fanatical-library-bundle-filtered'));
    if (!state.showNewOnly) return;
    // Measure and build the replacement grid while Fanatical's original rows
    // are still visible; the body filter below intentionally hides them.
    reflowVisiblePickMixCards();
    document.body.classList.add('fanatical-library-show-new-only');
    // Pick & Mix has already hidden each excluded outer card wrapper above.
    // A second nested hide can survive a SPA card recycle and hide a new card.
    if (state.parsed?.kind === 'pick-mix') return;
    document.querySelectorAll('.fanatical-library-card-owned, .fanatical-library-card-owned-elsewhere').forEach((card) => {
      // Pick & Mix places each article in a one-card grid-cell wrapper. Hide
      // that wrapper so CSS Grid reflows instead of retaining an empty hole.
      const wrapper = card.parentElement;
      const target = wrapper?.parentElement?.matches('.three-column-row, .five-column-row') ? wrapper : card;
      target.classList.add('fanatical-library-bundle-filtered');
      target.dataset.fanaticalLibraryFilterDisplay = target.style.getPropertyValue('display');
      target.dataset.fanaticalLibraryFilterPriority = target.style.getPropertyPriority('display');
      target.style.setProperty('display', 'none', 'important');
    });
  }

  function cardsNeedAnnotation() {
    if (!state.parsed) return true;
    let visibleCards = 0;
    for (const product of state.parsed.products) {
      const card = cardFor(product);
      if (!card) continue;
      visibleCards += 1;
      const host = card.querySelector('.cover-container') ?? card;
      if (!host.querySelector(`[data-fanatical-library-for="${product.sourceItemId}"]`)) return true;
    }
    // Keep waiting through the SPA's short gap while it replaces a tier grid.
    return visibleCards === 0;
  }


function captureSummaryState(panel) {
  if(!panel)return null;
  const active=panel.contains(document.activeElement)?document.activeElement:null;
  return {open:[...panel.querySelectorAll('details')].filter(node=>node.open).map(node=>node.dataset.section||node.id||node.className||node.querySelector('summary')?.textContent),scroll:panel.scrollTop,focus:active?.getAttribute('aria-label')||active?.id};
}
function restoreSummaryState(panel, state) {
  if(!state)return;
  for(const node of panel.querySelectorAll('details'))node.open=state.open.includes(node.dataset.section||node.id||node.className||node.querySelector('summary')?.textContent);
  panel.scrollTop=state.scroll;
  if(state.focus)[...panel.querySelectorAll('button,input,select')].find(node=>node.getAttribute('aria-label')===state.focus||node.id===state.focus)?.focus({preventScroll:true});
}

  function panel(failed = false) {
    const previous=document.querySelector('.fanatical-library-summary');
    if(state.url===location.href&&previous?.querySelector('.fanatical-library-advanced'))state.panelView=captureSummaryState(previous);
    else if(state.url!==location.href)state.panelView=null;
    document.querySelector('[data-fanatical-library-summary]')?.remove();
    const element = document.createElement('aside'); element.id = 'fanatical-library-summary'; element.dataset.fanaticalLibrarySummary = 'true'; element.className = failed ? 'fanatical-library-progress fanatical-library-progress-error' : 'fanatical-library-summary'; element.setAttribute('aria-label', 'Bundle ownership'); document.body.append(element); return element;
  }

  function showPanel(message, failed = false) {
    panel(failed).textContent = message;
  }

  function appendRelatedTitles(host, match) {
    if(!['possible','partial'].includes(match?.state))return;
    const caption=F.presentation.relatedCaption(match.offered||{},match);
    if(!caption)return;
    const note=document.createElement('small');note.className='fanatical-library-related-titles';
    if(host.classList.contains('fanatical-library-card-title'))note.classList.add('fanatical-library-card-edition-note');
    note.textContent=(match.state==='partial'?'Overlap: ':match.ownershipReview?'Check ownership: ':'Possible match: ')+caption;host.append(note);
  }

  function appendSummaryControls(summary) {
    const controls = document.createElement('div');
    controls.className = 'fanatical-library-summary-controls';
    const minimize = document.createElement('button');
    minimize.type = 'button';
    minimize.className = 'fanatical-library-summary-minimize';
    minimize.textContent = 'Minimize';
    minimize.setAttribute('aria-label', 'Minimize Fanatical Library bundle summary');
    const expand = document.createElement('button');
    expand.type = 'button';
    expand.className = 'fanatical-library-summary-expand';
    expand.textContent = 'Fanatical Library — Expand';
    expand.setAttribute('aria-label', 'Expand Fanatical Library bundle summary');
    const position=document.createElement('select');position.setAttribute('aria-label','Bundle summary position');
    for(const [value,label]of [['bottom-right','Bottom right'],['bottom-left','Bottom left'],['top-right','Top right'],['top-left','Top left']]){const option=document.createElement('option');option.value=value;option.textContent=label;position.append(option);}
    const status=document.createElement('small');status.setAttribute('role','status');status.hidden=true;
    const persist=()=>F.storageSet({fanaticalSummaryPreferences:{...state.summaryPreferences}}).catch(error=>{status.hidden=false;status.textContent='Could not save panel preferences: '+error.message;});
    position.addEventListener('change',()=>{state.summaryPreferences.position=position.value;update();persist();});
    summary.addEventListener('fanatical-summary-preferences',()=>update());
    const update = () => {
      summary.classList.toggle('fanatical-library-summary-minimized', state.summaryPreferences.minimized);
      summary.dataset.position=state.summaryPreferences.position;position.value=state.summaryPreferences.position;position.hidden=state.summaryPreferences.minimized;
      minimize.hidden = state.summaryPreferences.minimized;
      expand.hidden = !state.summaryPreferences.minimized;
      minimize.setAttribute('aria-expanded', String(!state.summaryPreferences.minimized));
      expand.setAttribute('aria-expanded', String(!state.summaryPreferences.minimized));
    };
    minimize.addEventListener('click', () => {
      state.summaryPreferences.minimized = true;
      update();persist();
      expand.focus();
    });
    expand.addEventListener('click', () => {
      state.summaryPreferences.minimized = false;
      update();persist();
      minimize.focus();
    });
    controls.append(position,minimize, expand,status);
    summary.prepend(controls);
    update();
  }

  function appendNewOnlyFilter(summary) {
    const label = document.createElement('label'); label.className = 'fanatical-library-bundle-filter';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = state.showNewOnly;
    checkbox.addEventListener('change', () => {
      state.showNewOnly = checkbox.checked;
      F.storageSet({ fanaticalShowNewItemsOnly: state.showNewOnly }).catch(() => {});
      applyNewOnlyFilter();
    });
    label.append(checkbox, ' Hide owned items');
    label.title = 'Hides confirmed-owned items. Possible and partially owned items stay visible for review.';
    summary.append(label);
  }

  function showEvidence(match, trigger) {
    document.querySelector('#fanatical-library-evidence')?.remove();
    const dialog = document.createElement('dialog'); dialog.id = 'fanatical-library-evidence'; dialog.className = 'fanatical-library-evidence';
    dialog.setAttribute('aria-labelledby', 'fanatical-library-evidence-heading');
    const heading = document.createElement('h2'); heading.id = 'fanatical-library-evidence-heading'; heading.textContent = match.offered?.title || 'Ownership evidence';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close'; close.autofocus = true;
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { dialog.remove(); if (trigger?.isConnected) trigger.focus(); });
    const plain=document.createElement('p'); plain.className='fanatical-library-explanation'; plain.textContent=F.presentation.explanation(match.offered||{},match); dialog.append(heading,close,plain);
    F.presentation.renderCandidates(dialog,match.offered||{},match);
    const technical=document.createElement('details'); const technicalTitle=document.createElement('summary'); technicalTitle.textContent='Match details'; technical.append(technicalTitle);
    const list = document.createElement('ul');
    for (const text of F.explanationLines(match, state.lastImport)) { const row = document.createElement('li'); row.textContent = text; list.append(row); }
    F.presentation.renderDeferred(technical,match.offered||{},match);
    technical.append(list); dialog.append(technical);
    const review = document.createElement('button'); review.type = 'button'; review.textContent = 'Review in Galactic Library';
    const output = document.createElement('p'); output.setAttribute('role', 'status');
    review.addEventListener('click', () => openCentralReview(review, output));
    const refresh = document.createElement('button'); refresh.type = 'button'; refresh.textContent = 'Refresh central evidence';
    refresh.addEventListener('click', () => { dialog.close(); refreshCentralEvidence(); });
    if(match.externalResult||match.lookupIncomplete||match.contentsLookupIncomplete||match.state==='owned-elsewhere')dialog.append(review,refresh,output); document.body.append(dialog); dialog.showModal();
  }

  async function openCentralReview(button, output) {
    button.disabled = true;
    try { const response = await chrome.runtime.sendMessage({ type: 'FANATICAL_OPEN_GALACTIC_REVIEW' }); output.textContent = response?.ok ? 'Opened Galactic Library. Use Ownership evidence, Contents, or Duplicate review, then refresh this comparison.' : response?.error || 'Open Galactic Library from its toolbar icon to review evidence.'; }
    catch { output.textContent = 'Open Galactic Library from its toolbar icon to review evidence.'; }
    finally { button.disabled = false; }
  }

  function downloadTierList(parsed, matches) {
    const stateFor = (product) => matches[parsed.products.findIndex((candidate) => candidate.sourceItemId === product.sourceItemId)]?.state ?? 'new';
    const lines = [`Fanatical Library — ${parsed.title}`, ''];
    if (parsed.kind === 'standard') parsed.groups.forEach((group, index) => {
      const price = Number(group.price?.USD); lines.push(`${Number.isFinite(price) ? `$${(price / 100).toFixed(2)}` : `Tier ${index + 1}`} tier`);
      alphabetize(group.products).forEach((product) => lines.push(`[${stateFor(product)}] ${product.title}`)); lines.push('');
    });
    else {
      lines.push('Pick & Mix tiers:');
      for (const tier of [...parsed.tiers].sort((left, right) => Number(left.price?.USD ?? Number.MAX_SAFE_INTEGER) - Number(right.price?.USD ?? Number.MAX_SAFE_INTEGER))) {
        const price = Number(tier.price?.USD);
        lines.push(`${Number.isFinite(price) ? `$${(price / 100).toFixed(2)}` : 'Unknown price'} tier: choose ${tier.quantity} item${tier.quantity === 1 ? '' : 's'}`);
      }
      lines.push('', 'Pool:');
      alphabetize(parsed.products).forEach((product) => lines.push(`[${stateFor(product)}] ${product.title}`));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${parsed.title.replace(/[^a-z0-9]+/giu, '-').replace(/^-|-$/gu, '').toLowerCase() || 'fanatical-bundle'}-tier-list.txt`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0);
  }


  function wishFor(product) { return state.wishlist.filter(w=>F.wishlistRelation(w,product)==='match').sort((a,b)=>b.weight-a.weight)[0]; }
  function appendWishlistControl(row, product) {
    const label=document.createElement('label'); label.className='fanatical-library-wishlist-control'; const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=Boolean(wishFor(product));checkbox.setAttribute('aria-label','Wishlist '+product.title);
    const status=document.createElement('small');status.setAttribute('role','status');
    checkbox.addEventListener('change',async()=>{checkbox.disabled=true;try{const wish=wishFor(product);if(checkbox.checked)state.wishlist=await F.updateWishlist('add',[wish||{...product,weight:1}]);else for(const entry of state.wishlist.filter(w=>F.wishlistRelation(w,product)==='match'))state.wishlist=await F.updateWishlist('remove',F.wishlistKey(entry));state.summaryDirty=true;schedule(true);}catch(error){checkbox.checked=!checkbox.checked;status.textContent=error.message;}finally{checkbox.disabled=false;}});
    label.append(checkbox,' Wishlist');row.append(' ',label,status);
  }
  function appendWishlistNotice(summary, parsed) {
    document.querySelectorAll('.fanatical-library-wish-marker').forEach(node=>node.remove());
    const rows=parsed.products.map(item=>({item,relation:wishFor(item)?'match':state.wishlist.some(w=>F.wishlistRelation(w,item)==='related')?'related':''})).filter(row=>row.relation);
    if(!rows.length)return;
    const details=document.createElement('details');details.className='fanatical-library-wishlist-notice';const heading=document.createElement('summary');heading.textContent=`Wishlist: ${rows.filter(row=>row.relation==='match').length} matches · ${rows.filter(row=>row.relation==='related').length} related`;details.append(heading);
    const list=document.createElement('ul');for(const row of rows){const li=document.createElement('li');li.textContent=`${row.item.title} — ${row.relation==='match'?'Wishlist match':'Related wishlist item'}`;list.append(li);const host=cardFor(row.item)?.querySelector('.cover-container');if(host){const marker=document.createElement('span');marker.className='fanatical-library-wish-marker';marker.textContent=row.relation==='match'?'♥ Wishlist':'♡ Related wish';host.append(marker);}}details.append(list);summary.append(details);
  }

  function renderSummary(parsed, matches, localItems, options = {}) {
    const isPending = Boolean(options?.pendingGalactic);
    const counts = { owned: 0, elsewhere: 0, partial: 0, possible: 0, new: 0, unchecked: 0 };
    for (const match of matches) {
      if (match.state === 'owned') counts.owned++;
      else if (match.state === 'owned-elsewhere') counts.elsewhere++;
      else if (match.state === 'partial') counts.partial++;
      else if (match.state === 'possible') counts.possible++;
      else if (match.state === 'unchecked') counts.unchecked++;
      else counts.new++;
    }
    const detail = parsed.kind === 'pick-mix' ? ` Available unowned: ${matches.filter((match, i) => match.state === 'new' && parsed.products[i].availability.regionAvailable && !parsed.products[i].availability.soldOut).length}. Selected (page UI): ${selectedCount(parsed.products)}.` : '';
    const rates = parsed.kind === 'pick-mix' ? parsed.tiers.map((tier) => Number.isFinite(tier.price?.USD) ? `${tier.quantity}: $${(tier.price.USD / 100 / tier.quantity).toFixed(2)}/item` : '').filter(Boolean).join(' · ') : '';
    const element = panel();
    const title=document.createElement('strong'); title.textContent='Bundle ownership'; element.append(title);
    const heading=document.createElement('strong'); heading.className='fanatical-library-summary-counts';
    if (isPending) {
      heading.textContent = `Preliminary: Owned ${counts.owned} · Not owned locally ${counts.new}${counts.partial ? ` · Partial ${counts.partial}` : ''}${counts.possible ? ` · Possible ${counts.possible}` : ''}`;
    } else {
      heading.textContent = `Owned ${counts.owned} · Owned elsewhere ${counts.elsewhere} · New ${counts.new} · Partial ${counts.partial} · Possible ${counts.possible}${counts.unchecked ? ` · Check incomplete ${counts.unchecked}` : ''}`;
    }
    element.append(heading);
    const countHelp=document.createElement('p');countHelp.className='library-ui-muted';
    countHelp.textContent = isPending
      ? 'Preliminary local checks. Galactic Library is checking linked libraries for additional ownership.'
      : 'Possible needs review; Partial overlaps some known contents. New means no match in available data.';
    element.append(countHelp);
    const advanced=document.createElement('details'); advanced.className='fanatical-library-advanced'; advanced.dataset.section='advanced';
    const advancedHeading=document.createElement('summary'); advancedHeading.textContent='Advanced'; advanced.append(advancedHeading);
    appendContentsSummary(advanced, parsed, matches);
    if(parsed.products.length)advanced.append(F.createPurchasePlanning(parsed,matches,state));
    appendReadingSummary(advanced, matches);
    const purchase = (Array.isArray(localItems) ? localItems : []).flatMap(item=>item.purchaseOrigins?.length?item.purchaseOrigins:[item]).filter(item=>item?.bundle?.sourceItemId===parsed.sourceItemId).sort((a,b)=>(Date.parse(b.purchaseDate)||0)-(Date.parse(a.purchaseDate)||0))[0];
    if (purchase?.purchaseDate) {
      const notice = document.createElement('p'); notice.className = 'fanatical-library-purchased library-ui-status-owned';
      const date = new Date(purchase.purchaseDate);
      notice.textContent = `Already purchased: ${Number.isNaN(date.valueOf()) ? purchase.purchaseDate : date.toLocaleDateString()}`;
      element.append(notice);
    }
    const legend = document.createElement('div'); legend.className = 'fanatical-library-legend';
    for (const [state, label] of [['owned', 'Owned'], ['owned-elsewhere', 'Owned elsewhere'], ['new', 'New'], ['partial', 'Partial'], ['possible', 'Possible'], ['unchecked', 'Check incomplete']]) { const chip = document.createElement('span'); chip.className = `fanatical-library-legend-${state}`; chip.textContent = label; legend.append(chip); }
    element.append(legend);
    if (state.galacticEnabled || isPending) {
      const galactic = document.createElement('p');
      if (isPending) {
        galactic.className = 'library-ui-muted fanatical-library-galactic-status fanatical-library-galactic-pending';
        const bullet = document.createElement('span');
        bullet.className = 'fanatical-library-pending-bullet';
        bullet.textContent = '●';
        galactic.append(bullet, ' Checking Galactic Library…');
      } else {
        galactic.className = 'fanatical-library-galactic-status '+(state.failed.size || state.capabilityFailed?'library-ui-warning':'library-ui-muted');
        galactic.textContent = state.failed.size || state.capabilityFailed ? 'Galactic Library: check incomplete. Local results are retained.' : state.galactic.size?'Galactic Library: checked linked libraries.':'Galactic Library: linked; no central checks completed on this page.';
      }
      galactic.title = 'Checks catalog and contents evidence with local Galactic Library. Central Fanatical copies are excluded; rescan local orders if the snapshots disagree.';
      element.append(galactic);
      if (!isPending && (state.failed.size || state.capabilityFailed)) {
        const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'fanatical-library-download fanatical-library-retry-galactic'; retry.textContent = 'Retry Galactic Library checks';
        retry.addEventListener('click', () => {
          if (retry.disabled) return;
          retry.disabled = true;
          element.setAttribute('aria-busy', 'true');
          state.keepSummaryDuringRetry = true;
          if (state.capabilityFailed) state.capabilityId = null;
          state.revision++; state.summaryDirty = true;
          // Retain successful results; queryGalactic requests only missing ones.
          schedule(true);
        });
        element.append(retry);
      }
    }
    if (!state.galacticEnabled && !isPending) { const status=document.createElement('p'); status.className='library-ui-muted fanatical-library-galactic-status';status.textContent='Galactic Library: not linked — local library only.'; element.append(status); }
    appendWishlistNotice(element, parsed);
    appendNewOnlyFilter(element);
    let tierDownload = null;
    if (parsed.kind === 'standard' && parsed.groups.length) {
      const { tiers } = F.standardTierCoverage(parsed, matches);
      const list = document.createElement('ul'); list.className = 'fanatical-library-tier-list';
      tiers.forEach(({ price, total, confirmedNew }, index) => {
        const priceText = price !== null ? `$${(price / 100).toFixed(2)} tier` : `Tier ${index + 1}`;
        if (isPending) {
          const line = document.createElement('li'); line.textContent = `${priceText}: ${confirmedNew} not owned locally / ${total}`; list.append(line);
        } else {
          const perNew = confirmedNew && price !== null ? ` · $${(price / 100 / confirmedNew).toFixed(2)}/new` : '';
          const line = document.createElement('li'); line.textContent = `${priceText}: ${confirmedNew} new / ${total}${perNew}`; list.append(line);
        }
      });
      element.append(list);
      tierDownload = document.createElement('button'); tierDownload.type = 'button'; tierDownload.className = 'fanatical-library-download'; tierDownload.textContent = 'Download complete item list'; tierDownload.addEventListener('click', () => downloadTierList(parsed, matches));
    }
    if (parsed.kind === 'pick-mix' && parsed.tiers.length) {
      const availableProducts = parsed.products.filter((product) => product.availability.regionAvailable && !product.availability.soldOut);
      const availableNew = availableProducts.filter((product) => matches[parsed.products.findIndex((candidate) => candidate.sourceItemId === product.sourceItemId)]?.state === 'new').length;
      const tierList = document.createElement('ul'); tierList.className = 'fanatical-library-tier-list';
      for (const tier of [...parsed.tiers].sort((left, right) => Number(left.price?.USD ?? Number.MAX_SAFE_INTEGER) - Number(right.price?.USD ?? Number.MAX_SAFE_INTEGER))) {
        const price = Number(tier.price?.USD);
        const priceText = Number.isFinite(price) ? `$${(price / 100).toFixed(2)} tier` : `${tier.quantity}-item tier`;
        const perItem = Number.isFinite(price) && tier.quantity ? ` · $${(price / 100 / tier.quantity).toFixed(2)}/item` : '';
        const row = document.createElement('li');
        if (isPending) {
          row.textContent = `${priceText}: choose ${tier.quantity} item${tier.quantity === 1 ? '' : 's'} from ${availableProducts.length} available (${availableNew} not owned locally)${perItem}`;
        } else {
          row.textContent = `${priceText}: choose ${tier.quantity} item${tier.quantity === 1 ? '' : 's'} from ${availableProducts.length} available (${availableNew} confirmed new)${perItem}`;
        }
        tierList.append(row);
      }
      element.append(tierList);
      tierDownload = document.createElement('button'); tierDownload.type = 'button'; tierDownload.className = 'fanatical-library-download'; tierDownload.textContent = 'Download complete item list'; tierDownload.addEventListener('click', () => downloadTierList(parsed, matches));
    }
    if (detail || rates) { const extra = document.createElement('div'); extra.className = 'fanatical-library-extra'; extra.textContent = `${detail}${rates ? ` USD: ${rates}.` : ''}`; element.append(extra); }
    for (const [stateKey, label] of [['owned', 'Owned'], ['owned-elsewhere', 'Owned elsewhere'], ['new', isPending ? 'Not owned locally' : 'New'], ['partial', 'Partial'], ['possible', 'Possible matches'], ['unchecked', 'Check incomplete']]) {
      const entries = parsed.products.filter((_product, index) => (stateKey === 'owned-elsewhere' ? matches[index].state === 'owned-elsewhere' : matches[index].state === stateKey));
      if (!entries.length) continue;
      const detailList = document.createElement('details'); detailList.className = 'fanatical-library-title-list'; detailList.dataset.section=stateKey; const title = document.createElement('summary'); title.textContent = `${label} (${entries.length})`; detailList.append(title); const list = document.createElement('ol'); alphabetize(entries).forEach((product) => {
        const match = matches[parsed.products.findIndex((candidate) => candidate.sourceItemId === product.sourceItemId)];
        const row = document.createElement('li');
        const view=F.presentation.row(product, match);
        row.append(document.createTextNode(product.title+(view.providers.length?' — '+view.providers.join(', '):'')+(view.fraction?' — '+view.fraction:'')));
        if (view.why) { const inspect=document.createElement('button'); inspect.type='button'; inspect.className='fanatical-library-inspect'; inspect.textContent='Why?'; inspect.setAttribute('aria-label','Why '+product.title); inspect.addEventListener('click',()=>showEvidence(match,inspect)); row.append(' ',inspect); }
        appendRelatedTitles(row,match);
        appendWishlistControl(row,product);
        list.append(row);
      }); detailList.append(list); element.append(detailList);
    }
    if (advanced.children.length>1||diagnosticsEnabled) element.append(advanced);
    if (tierDownload) element.append(tierDownload);
    appendSummaryControls(element);
    restoreSummaryState(element,state.panelView);
  }

  function updateSummary(parsed, matches, localItems) {
    const summary = document.querySelector('[data-fanatical-library-summary]');
    if (!summary || !summary.isConnected || !summary.classList.contains('fanatical-library-summary')) {
      renderSummary(parsed, matches, localItems);
      return;
    }
    summary.removeAttribute('aria-busy');
    const savedState = captureSummaryState(summary);

    const counts = { owned: 0, elsewhere: 0, partial: 0, possible: 0, new: 0, unchecked: 0 };
    for (const match of matches) {
      if (match.state === 'owned') counts.owned++;
      else if (match.state === 'owned-elsewhere') counts.elsewhere++;
      else if (match.state === 'partial') counts.partial++;
      else if (match.state === 'possible') counts.possible++;
      else if (match.state === 'unchecked') counts.unchecked++;
      else counts.new++;
    }

    // 1. Update counts headline & countHelp
    const headline = summary.querySelector('.fanatical-library-summary-counts');
    if (headline) {
      headline.textContent = `Owned ${counts.owned} · Owned elsewhere ${counts.elsewhere} · New ${counts.new} · Partial ${counts.partial} · Possible ${counts.possible}${counts.unchecked ? ` · Check incomplete ${counts.unchecked}` : ''}`;
    }
    const countHelp = summary.querySelector('.fanatical-library-summary-counts + p');
    if (countHelp) {
      countHelp.textContent = 'Possible needs review; Partial overlaps some known contents. New means no match in available data.';
    }

    // 2. Update galactic status row
    let galactic = summary.querySelector('.fanatical-library-galactic-status');
    if (galactic) {
      galactic.classList.remove('fanatical-library-galactic-pending');
      if (state.galacticEnabled) {
        galactic.className = 'fanatical-library-galactic-status ' + (state.failed.size || state.capabilityFailed ? 'library-ui-warning' : 'library-ui-muted');
        galactic.textContent = state.failed.size || state.capabilityFailed
          ? 'Galactic Library: check incomplete. Local results are retained.'
          : state.galactic.size ? 'Galactic Library: checked linked libraries.' : 'Galactic Library: linked; no central checks completed on this page.';
        galactic.title = 'Checks catalog and contents evidence with local Galactic Library. Central Fanatical copies are excluded; rescan local orders if the snapshots disagree.';

        const existingRetry = summary.querySelector('.fanatical-library-retry-galactic');
        if (state.failed.size || state.capabilityFailed) {
          if (!existingRetry) {
            const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'fanatical-library-download fanatical-library-retry-galactic'; retry.textContent = 'Retry Galactic Library checks';
            retry.addEventListener('click', () => {
              if (retry.disabled) return;
              retry.disabled = true;
              summary.setAttribute('aria-busy', 'true');
              state.keepSummaryDuringRetry = true;
              if (state.capabilityFailed) state.capabilityId = null;
              state.revision++; state.summaryDirty = true;
              schedule(true);
            });
            galactic.after(retry);
          } else {
            existingRetry.disabled = false;
          }
        } else if (existingRetry) {
          existingRetry.remove();
        }
      } else {
        galactic.className = 'library-ui-muted fanatical-library-galactic-status';
        galactic.textContent = 'Galactic Library: not linked — local library only.';
      }
    }

    // 3. Update tier list
    const tierList = summary.querySelector('.fanatical-library-tier-list');
    if (tierList) {
      if (parsed.kind === 'standard' && parsed.groups.length) {
        const { tiers } = F.standardTierCoverage(parsed, matches);
        const tierRows = [];
        tiers.forEach(({ price, total, confirmedNew }, index) => {
          const priceText = price !== null ? `$${(price / 100).toFixed(2)} tier` : `Tier ${index + 1}`;
          const perNew = confirmedNew && price !== null ? ` · $${(price / 100 / confirmedNew).toFixed(2)}/new` : '';
          tierRows.push(`${priceText}: ${confirmedNew} new / ${total}${perNew}`);
        });
        const existingLis = tierList.querySelectorAll('li');
        if (existingLis.length === tierRows.length) {
          existingLis.forEach((li, idx) => { li.textContent = tierRows[idx]; });
        } else {
          tierList.replaceChildren(...tierRows.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
        }
      } else if (parsed.kind === 'pick-mix' && parsed.tiers.length) {
        const availableProducts = parsed.products.filter((product) => product.availability.regionAvailable && !product.availability.soldOut);
        const availableNew = availableProducts.filter((product) => matches[parsed.products.findIndex((candidate) => candidate.sourceItemId === product.sourceItemId)]?.state === 'new').length;
        const tierRows = [];
        for (const tier of [...parsed.tiers].sort((left, right) => Number(left.price?.USD ?? Number.MAX_SAFE_INTEGER) - Number(right.price?.USD ?? Number.MAX_SAFE_INTEGER))) {
          const price = Number(tier.price?.USD);
          const priceText = Number.isFinite(price) ? `$${(price / 100).toFixed(2)} tier` : `${tier.quantity}-item tier`;
          const perItem = Number.isFinite(price) && tier.quantity ? ` · $${(price / 100 / tier.quantity).toFixed(2)}/item` : '';
          tierRows.push(`${priceText}: choose ${tier.quantity} item${tier.quantity === 1 ? '' : 's'} from ${availableProducts.length} available (${availableNew} confirmed new)${perItem}`);
        }
        const existingLis = tierList.querySelectorAll('li');
        if (existingLis.length === tierRows.length) {
          existingLis.forEach((li, idx) => { li.textContent = tierRows[idx]; });
        } else {
          tierList.replaceChildren(...tierRows.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
        }
      }
    }

    // 4. Update extra (pick-mix available unowned)
    const extra = summary.querySelector('.fanatical-library-extra');
    const detail = parsed.kind === 'pick-mix' ? ` Available unowned: ${matches.filter((match, i) => match.state === 'new' && parsed.products[i].availability.regionAvailable && !parsed.products[i].availability.soldOut).length}. Selected (page UI): ${selectedCount(parsed.products)}.` : '';
    const rates = parsed.kind === 'pick-mix' ? parsed.tiers.map((tier) => Number.isFinite(tier.price?.USD) ? `${tier.quantity}: $${(tier.price.USD / 100 / tier.quantity).toFixed(2)}/item` : '').filter(Boolean).join(' · ') : '';
    if (extra && (detail || rates)) {
      extra.textContent = `${detail}${rates ? ` USD: ${rates}.` : ''}`;
    }

    // 5. Update title breakdown lists (preserving open state)
    for (const detail of summary.querySelectorAll('.fanatical-library-title-list')) {
      detail.remove();
    }
    const insertBeforeEl = summary.querySelector('.fanatical-library-advanced') || summary.querySelector('.fanatical-library-download');
    for (const [stateKey, label] of [['owned', 'Owned'], ['owned-elsewhere', 'Owned elsewhere'], ['new', 'New'], ['partial', 'Partial'], ['possible', 'Possible matches'], ['unchecked', 'Check incomplete']]) {
      const entries = parsed.products.filter((_product, index) => (stateKey === 'owned-elsewhere' ? matches[index].state === 'owned-elsewhere' : matches[index].state === stateKey));
      if (!entries.length) continue;
      const detailList = document.createElement('details'); detailList.className = 'fanatical-library-title-list'; detailList.dataset.section = stateKey;
      if (savedState?.open?.includes(stateKey)) detailList.open = true;
      const title = document.createElement('summary'); title.textContent = `${label} (${entries.length})`; detailList.append(title);
      const list = document.createElement('ol');
      alphabetize(entries).forEach((product) => {
        const match = matches[parsed.products.findIndex((candidate) => candidate.sourceItemId === product.sourceItemId)];
        const row = document.createElement('li');
        const view = F.presentation.row(product, match);
        row.append(document.createTextNode(product.title + (view.providers.length ? ' — ' + view.providers.join(', ') : '') + (view.fraction ? ' — ' + view.fraction : '')));
        if (view.why) {
          const inspect = document.createElement('button'); inspect.type = 'button'; inspect.className = 'fanatical-library-inspect'; inspect.textContent = 'Why?'; inspect.setAttribute('aria-label', 'Why ' + product.title); inspect.addEventListener('click', () => showEvidence(match, inspect)); row.append(' ', inspect);
        }
        appendRelatedTitles(row, match);
        appendWishlistControl(row, product);
        list.append(row);
      });
      detailList.append(list);
      if (insertBeforeEl) insertBeforeEl.before(detailList);
      else summary.append(detailList);
    }

    // 6. Update advanced section (preserving open state)
    let advanced = summary.querySelector('.fanatical-library-advanced');
    if (advanced) advanced.remove();
    advanced = document.createElement('details'); advanced.className = 'fanatical-library-advanced'; advanced.dataset.section = 'advanced';
    const advancedHeading = document.createElement('summary'); advancedHeading.textContent = 'Advanced'; advanced.append(advancedHeading);
    appendContentsSummary(advanced, parsed, matches);
    if (parsed.products.length) advanced.append(F.createPurchasePlanning(parsed, matches, state));
    appendReadingSummary(advanced, matches);
    if (advanced.children.length > 1 || diagnosticsEnabled) {
      const downloadBtn = summary.querySelector('.fanatical-library-download:not(.fanatical-library-retry-galactic)');
      if (downloadBtn) downloadBtn.before(advanced);
      else summary.append(advanced);
    }

    // 7. Update tier download button click handler
    const existingDownload = summary.querySelector('button.fanatical-library-download:not(.fanatical-library-retry-galactic)');
    if (existingDownload) {
      const freshDownload = document.createElement('button');
      freshDownload.type = 'button';
      freshDownload.className = 'fanatical-library-download';
      freshDownload.textContent = 'Download complete item list';
      freshDownload.addEventListener('click', () => downloadTierList(parsed, matches));
      existingDownload.replaceWith(freshDownload);
    }

    restoreSummaryState(summary, savedState);
  }

  function appendContentsSummary(summary, parsed, matches) {
    const content = F.bundleContents(parsed, matches);
    if (!content.additional.length && !content.covered.length && !content.uncertain.length) return;
    const details = document.createElement('details'); details.className = 'fanatical-library-contents'; details.dataset.section='contents';
    const heading = document.createElement('summary');
    heading.textContent = `Bundle contents and overlap${parsed.kind==='pick-mix'?' (available pool)':''} — ${content.additional.length} additional · ${content.covered.length} covered · ${content.uncertain.length} uncertain`;
    details.append(heading);
    const note = document.createElement('p'); note.textContent = 'Distinct full issues/volumes across checked libraries; overlapping offers count once. Additional means not found, within known run/language scope.'; details.append(note);
    if (content.noContentsProducts) { const row = document.createElement('p'); row.textContent = `${content.noContentsProducts} offers have no enumerable contents; they are outside these unit counts.`; details.append(row); }
    if (content.incompleteProducts) { const row = document.createElement('p'); row.textContent = `${content.incompleteProducts} offers need a complete lookup or readable contents before their added units can be assessed.`; details.append(row); }
    if (parsed.kind === 'pick-mix') {
      const selected = new Set(selectedProducts(parsed.products).map(product => product.sourceItemId));
      const indices = parsed.products.map((product, index) => selected.has(product.sourceItemId) ? index : -1).filter(index => index >= 0);
      const value = F.bundleContents({ ...parsed, products: indices.map(index => parsed.products[index]) }, indices.map(index => matches[index]));
      const availableNew = new Set(content.additional.map(F.contentKey));
      value.additional = value.additional.filter(entry => availableNew.has(F.contentKey(entry)));
      const row = document.createElement('p'); row.className = 'fanatical-library-selected-contents'; row.textContent = `Selected items: ${value.additional.length} distinct additional units (${value.uncertain.length} uncertain). The pool total does not describe your selection.`; details.append(row);
    } else {
      for (const tier of content.tiers) { const row = document.createElement('p'); row.textContent = `${tier.price === null ? 'Unpriced tier' : `$${(tier.price / 100).toFixed(2)} tier`}: ${tier.additional} distinct additional units (cumulative).`; details.append(row); }
    }
    for (const [label, entries] of [['Additional', content.additional], ['Already covered', content.covered], ['Uncertain', content.uncertain]]) {
      if (!entries.length) continue;
      const section=appendPagedUnits(details,entries,entry=>{const row=document.createElement('li');row.textContent=F.unitLabel(entry);return row;},'contents-'+label);
      section.querySelector('summary').textContent=`${label} (${entries.length})`;
    }
    summary.append(details);
  }

  function appendReadingSummary(summary, matches) {
    const rows=state.reading||[];
    if(rows.length||state.readingLimits?.unknownScope){
      const details=document.createElement('details');details.className='fanatical-library-reading';details.dataset.section='series';
      const heading=document.createElement('summary');heading.textContent='Series coverage and gaps';details.append(heading);
      const note=document.createElement('p');note.textContent='Issues and volumes are compared within the same series version and language. Gaps describe this range, not a complete reading order. Annuals and specials appear only when explicitly identified.';details.append(note);
      if(state.readingLimits?.unknownScope){const note=document.createElement('p');note.className='library-ui-warning';note.textContent=`Needs review: ${state.readingLimits.unknownScope} offered units lack confirmed scope; no gaps inferred for them.`;details.append(note);}
      if(state.readingLimits?.limited){const note=document.createElement('p');note.textContent='Comparison bounded to 100 series, 2,000 units per series and 20,000 units total. Unchecked ranges need review.';details.append(note);}
      for(const row of rows){
        const section=document.createElement('details');section.dataset.section='series-'+row.label;
        const heading=document.createElement('summary');heading.textContent=`${row.label}: ${row.coverage.owned}/${row.coverage.total} full units confirmed covered`;section.append(heading);
        const confirmed=new Set(row.coverage.covered.map(F.contentKey)),possible=new Set(row.coverage.possibleCovered.map(F.contentKey));
        const ordered=[...row.entries].sort((a,b)=>Number(F.numberKey(a.number))-Number(F.numberKey(b.number))||titleCollator.compare(a.number,b.number));
        for(const [label,entries]of [['Compared range',ordered],['Offered here',ordered.filter(entry=>row.offeredKeys.has(F.contentKey(entry)))],['Owned elsewhere',row.coverage.covered.filter(entry=>entry.evidence?.some(record=>record.provider!=='fanatical'))],['Missing in compared range',ordered.filter(entry=>!confirmed.has(F.contentKey(entry))&&!possible.has(F.contentKey(entry))&&!row.lookupIncomplete)]])if(entries.length){const note=document.createElement('p');note.textContent=`${label}: ${conciseUnitNumbers(entries)}`;section.append(note);}
        if(row.lookupIncomplete||possible.size){const note=document.createElement('p');note.className='library-ui-warning';note.textContent='Needs review: unconfirmed coverage or incomplete checks cannot establish gaps.';section.append(note);}
        if(row.bounded){const note=document.createElement('p');note.textContent='Large spans show only the bounded explicit units; missing numbers outside the compared range are unknown.';section.append(note);}
        appendPagedUnits(section,ordered,entry=>{const id=F.contentKey(entry),status=confirmed.has(id)?'Covered':possible.has(id)?'Needs review':row.lookupIncomplete?'Check incomplete':'Not confirmed covered';const item=document.createElement('li');item.dataset.coverage=confirmed.has(id)?'covered':possible.has(id)||row.lookupIncomplete?'uncertain':'gap';item.textContent=`${entry.unitType} ${entry.number}: ${status}${row.offeredKeys.has(id)?' · offered here':' · not offered here'}`;return item;},section.dataset.section+'-units');details.append(section);
      }
      summary.append(details);
    }
    if(!state.galacticEnabled)return;
    const details=document.createElement('details');details.className='fanatical-library-reminders';details.dataset.section='galactic';
    const heading=document.createElement('summary');heading.textContent='Galactic Library details';details.append(heading);
    const status=document.createElement('p');status.className=state.failed.size || state.capabilityFailed?'library-ui-warning':'library-ui-muted';status.textContent=state.galacticStatus;details.append(status);
    const hint=document.createElement('p');hint.className='library-ui-muted';hint.textContent='Retry checks missing or failed results. Refresh fetches fresh central evidence, including successful checks. Local evidence is retained.';details.append(hint);
    const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Refresh central evidence';refresh.className='fanatical-library-download';refresh.addEventListener('click',refreshCentralEvidence);details.append(refresh);
    if(state.failed.size||state.capabilityFailed){const retry=document.createElement('button');retry.type='button';retry.textContent='Retry Galactic Library checks';retry.addEventListener('click',()=>document.querySelector('.fanatical-library-retry-galactic')?.click());details.append(retry);}
    const review=document.createElement('button');review.type='button';review.textContent='Review in Galactic Library';review.className='fanatical-library-download';const output=document.createElement('p');output.setAttribute('role','status');review.addEventListener('click',()=>openCentralReview(review,output));details.append(review,output);
    const reminders=F.centralReminders([...matches,...rows]);
    if(reminders.length){const section=appendPagedUnits(details,reminders,reminder=>{const row=document.createElement('li');row.textContent=`${reminder.title} · ${F.presentation.providerName(reminder.provider)}: ${reminder.text}`;return row;},'central-reminders');section.querySelector('summary').textContent=`Evidence reminders (${reminders.length})`;}
    summary.append(details);
  }
  function refreshCentralEvidence() {
    state.galactic.clear();state.failed.clear();state.capabilityId=null;state.keepSummaryDuringRetry=true;state.revision++;state.summaryDirty=true;schedule(true);
  }

  async function render() {
    if (state.rendering) return; const current = route(); if (!current) return;
    const hadExistingSummary = Boolean(document.querySelector('.fanatical-library-summary'));
    const hasStableSummary = !state.summaryDirty && state.url === location.href && Boolean(document.querySelector('[data-fanatical-library-summary]'));
    state.rendering = true;
    const revision = state.revision; const pageUrl = location.href;
    const uiRevision = state.uiRevision ?? 0;
    const startedAt = performance.now();
    observer?.disconnect();
    if (!hasStableSummary && !(state.keepSummaryDuringRetry && state.url === pageUrl && document.querySelector('.fanatical-library-summary'))) showPanel('Fanatical Library: loading ownership status…');
    try {
      const [parsed, stored] = await Promise.all([loadPublicBundle(current), chrome.storage.local.get({ fanaticalLibraryItems: [], fanaticalHistoricalItems: [], fanaticalProfileLabel: '', fanaticalWishlistItems: [], fanaticalImportSummary: null, galacticLibraryExtensionId: '', fanaticalShowNewItemsOnly: false, fanaticalShowDiagnostics: false,fanaticalSummaryPreferences:{} })]);
      if (revision !== state.revision || uiRevision !== (state.uiRevision ?? 0) || pageUrl !== location.href) return;
      state.history = stored.fanaticalProfileLabel ? stored.fanaticalHistoricalItems
        .filter(entry => entry.profileLabel === stored.fanaticalProfileLabel).map(entry => entry.item) : [];
      state.summaryPreferences=F.normalizeSummaryPreferences(stored.fanaticalSummaryPreferences);
      state.wishlist=F.normalizeWishlist(stored.fanaticalWishlistItems);
      state.lastImport = stored.fanaticalImportSummary?.importedAt || null;
      diagnosticsEnabled = Boolean(stored.fanaticalShowDiagnostics);
      if (!state.showNewOnlyLoaded) {
        state.showNewOnly = Boolean(stored.fanaticalShowNewItemsOnly);
        state.showNewOnlyLoaded = true;
      }
      const allProducts = F.flattenProducts(parsed.products);
      const reading = F.readingTargets(parsed.products);
      const identityProducts=F.isCompleteBundleCatalogue(parsed)?parsed.products.filter(product=>F.classify(product,stored.fanaticalLibraryItems).state==='owned'&&!F.offerContents(product).entries.length):[];

      // Phase 1: Local classification & immediate rendering
      const isPendingGalactic = Boolean(F.isExtensionId(F.resolveGalacticId(stored.galacticLibraryExtensionId, chrome.runtime)));
      state.galacticEnabled = isPendingGalactic;
      const ownedOffers = parsed.products.filter(product => F.classify(product, stored.fanaticalLibraryItems).state === 'owned');
      const localUnits = F.localContents([...stored.fanaticalLibraryItems, ...ownedOffers]);
      const localMatches = parsed.products.map(product => F.resolveProduct(product, stored.fanaticalLibraryItems, localUnits, () => null, 0, state.history));

      parsed.products.forEach((product, index) => {
        const card = cardFor(product); if (!card) return;
        let badge;
        badge = F.upsertBadge(card, product.sourceItemId, localMatches[index], card.querySelector('.cover-container') ?? card, () => showEvidence(localMatches[index], badge));
        upsertCardTitle(card, product, localMatches[index]);
      });
      if (parsed.kind === 'pick-mix') {
        if (!state.showNewOnly) sortPickMixCards();
      } else sortStandardBundleCards();

      if (!hadExistingSummary) {
        renderSummary(parsed, localMatches, stored.fanaticalLibraryItems, { pendingGalactic: isPendingGalactic });
      } else if (isPendingGalactic && state.summaryDirty) {
        const galacticStatus = document.querySelector('#fanatical-library-summary .fanatical-library-galactic-status');
        if (galacticStatus) {
          galacticStatus.className = 'library-ui-muted fanatical-library-galactic-status fanatical-library-galactic-pending';
          const bullet = document.createElement('span');
          bullet.className = 'fanatical-library-pending-bullet';
          bullet.textContent = '●';
          galacticStatus.replaceChildren(bullet, ' Checking Galactic Library…');
        }
      }
      applyNewOnlyFilter();

      if (!isPendingGalactic) {
        if (hadExistingSummary) {
          const summaryFingerprint = JSON.stringify([parsed, localMatches, stored.fanaticalLibraryItems, state.wishlist, state.reading, state.readingLimits, state.galacticStatus, diagnosticsEnabled]);
          if (state.summaryDirty || summaryFingerprint !== state.summaryFingerprint || !document.querySelector('[data-fanatical-library-summary]')) {
            renderSummary(parsed, localMatches, stored.fanaticalLibraryItems);
            state.summaryFingerprint = summaryFingerprint;
            state.summaryDirty = false;
          }
        }
        return;
      }

      // Phase 2: Galactic Library Query & Merge
      await queryGalactic([...allProducts.filter(product => F.classify(product, stored.fanaticalLibraryItems).state !== 'owned'),...identityProducts, ...reading.queries.map(query => query.item)], stored.galacticLibraryExtensionId);
      if (revision !== state.revision || uiRevision !== (state.uiRevision ?? 0) || pageUrl !== location.href) return;

      const matches = parsed.products.map((product) => status(product, stored.fanaticalLibraryItems, localUnits));
      F.presentation.reconcileBundle(parsed.products.map((item,index)=>({item,match:matches[index],identityContext:identityProducts.includes(item)?externalResult(item):null,
        contextIncomplete:identityProducts.includes(item)&&state.galacticEnabled&&Boolean(externalResult(item)?.lookupIncomplete),overlapProtected:F.isBundleOverlapProduct(item)})), {complete:F.isCompleteBundleCatalogue(parsed)});
      state.reading = F.readingCoverage(reading, [...localUnits, ...F.editionContentsEvidence(matches)], externalResult, state.galacticEnabled);
      state.readingLimits = reading;
      parsed.products.forEach((product, index) => {
        const card = cardFor(product); if (!card) return;
        let badge;
        badge = F.upsertBadge(card, product.sourceItemId, matches[index], card.querySelector('.cover-container') ?? card, () => showEvidence(matches[index], badge));
        upsertCardTitle(card, product, matches[index]);
      });
      if (parsed.kind === 'pick-mix') {
        if (!state.showNewOnly) sortPickMixCards();
      } else sortStandardBundleCards();

      const summaryFingerprint = JSON.stringify([parsed, matches, stored.fanaticalLibraryItems, state.wishlist, state.reading, state.readingLimits, state.galacticStatus, diagnosticsEnabled]);
      const existingSummary = document.querySelector('[data-fanatical-library-summary]');
      if (!hadExistingSummary && existingSummary?.classList.contains('fanatical-library-summary')) {
        updateSummary(parsed, matches, stored.fanaticalLibraryItems);
        state.summaryFingerprint = summaryFingerprint;
        state.summaryDirty = false;
      } else if (state.summaryDirty || summaryFingerprint !== state.summaryFingerprint || !document.querySelector('[data-fanatical-library-summary]')) {
        renderSummary(parsed, matches, stored.fanaticalLibraryItems);
        state.summaryFingerprint = summaryFingerprint;
        state.summaryDirty = false;
      }
      applyNewOnlyFilter();
      const summary = document.querySelector('[data-fanatical-library-summary]');
      if (summary && !diagnosticsEnabled) summary.querySelector('[data-fanatical-library-diagnostics]')?.remove();
      if (summary && diagnosticsEnabled) {
        const detected = new Set(parsed.products.map((product) => cardFor(product)).filter(Boolean));
        const counts = new Map();
        for (const match of matches) counts.set(match.state, (counts.get(match.state) || 0) + 1);
        updateDiagnostics(summary.querySelector('.fanatical-library-advanced'), [
          `Bundle: ${parsed.kind}; ${parsed.products.length} products parsed; ${detected.size} distinct cards found.`,
          `Local library records compared: ${stored.fanaticalLibraryItems.length}.`,
          `Matches: ${[...counts].map(([kind, total]) => `${kind} ${total}`).join('; ')}.`,
          `Galactic Library: ${state.galacticStatus}`,
          'Sorting: natural alphabetical title across the displayed cards.',
          `Last comparison: ${Math.round(performance.now() - startedAt)} ms.`
        ], [...parsed.products].sort((a, b) => titleCollator.compare(a.title, b.title)).map((product) => {
          const match = matches[parsed.products.indexOf(product)];
          return `${product.title}: ${F.overlayLabel(match)} — ${match.reason || 'no local or returned Galactic ownership match'}${match.provenance ? ` (${match.provenance})` : ''}`;
        }));
      }
    } catch (error) {
      showPanel(`Fanatical Library could not load this bundle: ${String(error?.message ?? 'unknown error')}`, true);
    } finally {
      const rerender = state.pendingRender || revision !== state.revision || uiRevision !== (state.uiRevision ?? 0) || pageUrl !== location.href;
      if (!rerender) state.keepSummaryDuringRetry = false;
      state.rendering = false;
      observer?.observe(document.documentElement, { childList: true, subtree: true });
      if (rerender) {
        state.pendingRender = false;
        schedule(true);
      }
    }
  }

  if (isOrderHistoryPage()) {
    ensureOrderImporter();
    let importerTimer;
    new MutationObserver(() => {
      if (document.querySelector('#fanatical-library-importer')) return;
      clearTimeout(importerTimer);
      importerTimer = setTimeout(ensureOrderImporter, 100);
    }).observe(document.documentElement, { childList: true, subtree: true });
    return;
  }

  const schedule = (force = false) => {
    if (isCataloguePage()) { clearTimeout(state.timer); state.timer = setTimeout(renderCatalogue, 120); return; }
    document.querySelectorAll('[data-fanatical-library-catalogue-for]').forEach((badge) => badge.remove());
    document.querySelectorAll('.fanatical-library-catalogue-card').forEach((card) => card.classList.remove('fanatical-library-catalogue-card'));
    document.querySelectorAll('.fanatical-library-catalogue-filtered').forEach((slot) => slot.classList.remove('fanatical-library-catalogue-filtered'));
    document.querySelector('#fanatical-library-catalogue-controls')?.remove();
    document.querySelector('#fanatical-library-catalogue-diagnostics')?.remove();
    if (!force && state.parsed && state.url === location.href && !cardsNeedAnnotation()) return;
    // Do not lose a storage/UI update when its timer fires during an await.
    if (state.rendering) { state.pendingRender = true; return; }
    clearTimeout(state.timer); state.timer = setTimeout(render, 120);
  };
  observer = new MutationObserver(() => schedule());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if(changes.fanaticalSummaryPreferences){state.uiRevision=(state.uiRevision??0)+1;state.summaryPreferences=F.normalizeSummaryPreferences(changes.fanaticalSummaryPreferences.newValue);document.querySelector('[data-fanatical-library-summary]')?.dispatchEvent(new Event('fanatical-summary-preferences'));}
    // UI dependencies invalidate the summary snapshot, not valid in-flight
    // central ownership results for the same account and GL connection.
    if(changes.fanaticalWishlistItems){state.summaryDirty=true;state.keepSummaryDuringRetry=true;state.uiRevision=(state.uiRevision??0)+1;}
    if(changes.fanaticalShowDiagnostics){state.summaryDirty=true;state.keepSummaryDuringRetry=true;state.uiRevision=(state.uiRevision??0)+1;}
    if (changes.fanaticalLibraryItems || changes.fanaticalHistoricalItems || changes.fanaticalProfileLabel || changes.galacticLibraryExtensionId) {
      state.keepSummaryDuringRetry = false;
      state.summaryDirty = true; state.revision++; state.galactic.clear(); state.failed.clear();
    }
    if (changes.fanaticalLibraryItems || changes.fanaticalShowDiagnostics) catalogueState.items = null;
    if (changes.fanaticalCatalogueFilters) catalogueState.filters = catalogueFilters(changes.fanaticalCatalogueFilters.newValue);
    schedule(true);
  });
  for (const event of ['click', 'change']) document.addEventListener(event, signal => {
    if (state.parsed?.kind !== 'pick-mix' || signal.target.closest('[data-fanatical-library-summary], #fanatical-library-evidence, [data-fanatical-library-for]')) return;
    if (signal.target.closest('article.PickAndMixCard')) { state.summaryDirty = true; schedule(true); }
  });
  F.renderSummary = renderSummary;
  F.updateSummary = updateSummary;
  F.render = render;
  F.state = state;
  schedule();
}());

function appendPagedUnits(host, entries, renderRow, sectionKey) {
  const section=document.createElement('details');section.dataset.section=sectionKey;
  const heading=document.createElement('summary');heading.textContent=`Unit details (${entries.length})`;section.append(heading);
  let page=0,mounted=false;
  const list=document.createElement('ol');list.className='fanatical-library-reading-sequence';
  const controls=document.createElement('div');controls.className='fanatical-library-unit-pages';
  const previous=document.createElement('button'),next=document.createElement('button'),status=document.createElement('span');
  previous.type=next.type='button';previous.textContent='Previous units';next.textContent='Next units';status.setAttribute('role','status');
  const paint=()=>{list.replaceChildren();list.start=page*50+1;for(const entry of entries.slice(page*50,(page+1)*50))list.append(renderRow(entry));previous.disabled=page===0;next.disabled=(page+1)*50>=entries.length;status.textContent=` ${page*50+1}–${Math.min((page+1)*50,entries.length)} of ${entries.length} `;};
  previous.addEventListener('click',()=>{page--;paint();});next.addEventListener('click',()=>{page++;paint();});controls.append(previous,status,next);
  section.addEventListener('toggle',()=>{if(!section.open||mounted)return;mounted=true;section.append(list);if(entries.length>50)section.append(controls);paint();});
  host.append(section);return section;
}
function conciseUnitNumbers(entries) {
  const rows=[...new Set(entries.map(entry=>entry.number))].sort((a,b)=>{const number=value=>Number(globalThis.LibraryMatchingPolicy.unitKey(value));return number(a)-number(b)||String(a).localeCompare(String(b),undefined,{numeric:true});});
  const ranges=[];for(let i=0;i<rows.length;i++){const first=rows[i];let last=first;while(i+1<rows.length&&Number.isInteger(Number(last))&&Number(rows[i+1])===Number(last)+1)last=rows[++i];ranges.push(first===last?String(first):`${first}–${last}`);}
  return ranges.slice(0,12).join(', ')+(ranges.length>12?` … (${rows.length} units)`:'');
}
