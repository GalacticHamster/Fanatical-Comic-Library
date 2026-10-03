(function fanaticalPageOverlay() {
  'use strict';
  const F = globalThis.FanaticalLibrary;
  if (!F) return;
  const titleCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
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
    const result = fullScan ? `Full scan checked ${summary.ordersScanned} order${summary.ordersScanned === 1 ? '' : 's'} and rebuilt ${summary.ownedLeafProducts} product${summary.ownedLeafProducts === 1 ? '' : 's'}.`
      : `Quick scan checked ${summary.ordersScanned} new order${summary.ordersScanned === 1 ? '' : 's'}, skipped ${summary.ordersSkipped}, and added ${summary.addedProducts} product${summary.addedProducts === 1 ? '' : 's'}.`;
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
      status.textContent = fullScan ? 'Scanning every completed purchase locally...' : 'Checking for new purchases locally...';
      try {
        const response = await chrome.runtime.sendMessage({ type: 'FANATICAL_IMPORT_PURCHASES', fullScan,profileLabel:profileControls.querySelector('[data-profile-label]').value,confirmed:profileControls.querySelector('[data-profile-confirm]').checked,switchProfile:profileControls.querySelector('[data-profile-switch]').checked });
        status.textContent = response?.ok ? importerResult(response.summary, fullScan||response.summary.scanMode==='full') : (response?.error ?? 'Import failed.');
      } catch {
        status.textContent = 'Import failed. Refresh this signed-in Fanatical Orders page and try again.';
      } finally {
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
    if (pageUrl === location.href) { state.parsed = parsed; state.url = pageUrl; state.capabilityId=null;state.galactic.clear(); state.requests.clear(); state.failed.clear(); }
    return parsed;
  }

  async function queryGalactic(products, extensionId) {
    state.galacticEnabled = F.isExtensionId(extensionId);
    if (!state.galacticEnabled) { state.galacticStatus = 'Not configured.'; return; }
    const revision=state.revision,pageUrl=location.href;
    if(state.capabilityId!==extensionId&&products.some(product=>product.mediaType==='software')){
      state.capabilityId=extensionId;state.softwareSupported=false;state.capabilityFailed=false;
      try{const capabilities=await F.galacticCapabilities(message=>chrome.runtime.sendMessage(extensionId,message));if(revision!==state.revision||pageUrl!==location.href)return;state.softwareSupported=capabilities.mediaTypes.includes('software');}catch{if(revision!==state.revision||pageUrl!==location.href)return;state.capabilityFailed=true;}
    }
    const requests = [...new Map(F.galacticRequestItems(products,state.softwareSupported).map(request => { request.requestId = requestId(request); return [request.requestId, request]; })).values()].filter(request => !state.galactic.has(request.requestId));
    if(state.capabilityFailed&&!requests.length){state.galacticStatus='Incomplete: capability check failed; software ownership was not checked.';return;}
    if (!requests.length && !state.galactic.size) { state.galacticStatus = 'No unresolved supported items to check; pairing has not been tested on this page.'; return; }
    const lookup = await F.queryGalacticItems(requests, message => chrome.runtime.sendMessage(extensionId, message));
    if (revision !== state.revision || pageUrl !== location.href) return;
    for (const [id, result] of lookup.results) { state.galactic.set(id, result); state.failed.delete(id); }
    for (const id of lookup.failed) state.failed.add(id);
    state.lookupFailures=lookup.failures;
    state.galacticStatus = state.capabilityFailed?'Incomplete: software capability check failed.':state.failed.size ? `Incomplete: ${state.failed.size} lookups failed; absence is not established. ${[...state.lookupFailures].join("; ")}.` : `Available. ${state.galactic.size} items checked; not found means not found in synced libraries.`;
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
    const result = externalResult(product);
    const match = F.resolveProduct(product, localItems, localUnits, externalResult, 0, state.history);
    if (state.galacticEnabled && (!result || result.lookupIncomplete) && match.state !== 'owned' && (['game', 'book', 'audiobook'].includes(product.mediaType)||product.mediaType==='software'&&(state.softwareSupported||state.capabilityFailed))) {
      match.lookupIncomplete = true;
      if (match.state === 'new') { match.state = 'unchecked'; match.reason = 'Central lookup incomplete; no absence claim is available.'; }
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

  function panel(failed = false) {
    document.querySelector('[data-fanatical-library-summary]')?.remove();
    const element = document.createElement('aside'); element.dataset.fanaticalLibrarySummary = 'true'; element.className = failed ? 'fanatical-library-progress fanatical-library-progress-error' : 'fanatical-library-summary'; element.setAttribute('role', 'status'); document.body.append(element); return element;
  }

  function showPanel(message, failed = false) {
    panel(failed).textContent = message;
  }

  function appendRelatedTitles(host, match) {
    if(!['possible','partial'].includes(match?.state))return;
    const records=[match.item,match.localMatch?.item,...(match.historicalItems??[]),...(match.candidates??[]),...(match.localMatch?.candidates??[]),...(match.externalResult?.possibleMatches??[]),...(match.externalResult?.partialMatches??[]),...(match.coverage?.covered??[]).flatMap(entry=>entry.evidence??[])].filter(Boolean);
    const titles=[...new Set(records.filter(record=>(record.item??record).title).map(record=>{const item=record.item??record,evidence=record.evidence??item;return [item.title,record.provider??'fanatical',item.historical?'previously recorded; access unconfirmed':record.provider?record.ownership??'ownership unconfirmed':'local purchase',evidence.edition,evidence.isbn?.length?'ISBN '+[evidence.isbn].flat().join(', '):''].filter(Boolean).join(' - ');}))];if(!titles.length)return;
    const note=document.createElement('small');note.className='fanatical-library-related-titles';if(host.classList.contains('fanatical-library-card-title')){note.classList.add('fanatical-library-card-edition-note');}note.textContent=(match.ownershipReview?'Check ownership: ':'Related library item: ')+titles[0];if(host.classList.contains('fanatical-library-card-title')){const relation=match.state==='partial'?(match.offered?.mediaType==='game'?'Partial package ('+match.owned+'/'+match.total+' components)':'Partial contents ('+match.owned+'/'+match.total+' full units)'):match.offered?.mediaType==='game'?'Different edition/package; extras not verified':'Identity needs review';note.textContent+=' - '+relation;}note.title=titles.join('; ');host.append(note);
    if(titles.length>1&&host.tagName==='LI'){const details=document.createElement('details'),heading=document.createElement('summary');heading.textContent='Other related items ('+(titles.length-1)+')';details.append(heading);const list=document.createElement('ul');for(const title of titles.slice(1)){const row=document.createElement('li');row.textContent=title;list.append(row);}details.append(list);host.append(details);}
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
    label.append(checkbox, ' Show new items only');
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
    const list = document.createElement('ul');
    for (const text of F.explanationLines(match, state.lastImport)) { const row = document.createElement('li'); row.textContent = text; list.append(row); }
    dialog.append(heading, close, list);
    const review = document.createElement('button'); review.type = 'button'; review.textContent = 'Review in Galactic Library';
    const output = document.createElement('p'); output.setAttribute('role', 'status');
    review.addEventListener('click', () => openCentralReview(review, output));
    const refresh = document.createElement('button'); refresh.type = 'button'; refresh.textContent = 'Refresh central evidence';
    refresh.addEventListener('click', () => { state.galactic.clear(); state.failed.clear(); state.revision++; state.summaryDirty = true; dialog.close(); schedule(true); });
    dialog.append(review, refresh, output); document.body.append(dialog); dialog.showModal();
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

  function renderSummary(parsed, matches, localItems) {
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
    const heading = document.createElement('strong'); heading.textContent = `Your Fanatical items: ${counts.owned} owned${counts.elsewhere ? ` · ${counts.elsewhere} elsewhere` : ''} · ${counts.new} new${counts.possible ? ` · ${counts.possible} possible` : ''}`; element.append(heading);
    heading.textContent = `Your Fanatical items: ${counts.owned} owned${counts.elsewhere ? ` \u00b7 ${counts.elsewhere} elsewhere` : ''} \u00b7 ${counts.new} new${counts.partial ? ` \u00b7 ${counts.partial} partial` : ''}${counts.possible ? ` \u00b7 ${counts.possible} possible` : ''}`;
    if (counts.unchecked) heading.textContent += ` · ${counts.unchecked} not checked`;
    appendContentsSummary(element, parsed, matches);
    element.append(F.createPurchasePlanning(parsed,matches,state));
    appendReadingSummary(element, matches);
    const purchase = (Array.isArray(localItems) ? localItems : []).flatMap(item=>item.purchaseOrigins?.length?item.purchaseOrigins:[item]).filter(item=>item?.bundle?.sourceItemId===parsed.sourceItemId).sort((a,b)=>(Date.parse(b.purchaseDate)||0)-(Date.parse(a.purchaseDate)||0))[0];
    if (purchase?.purchaseDate) {
      const notice = document.createElement('p'); notice.className = 'fanatical-library-purchased';
      const date = new Date(purchase.purchaseDate);
      notice.textContent = `Already purchased: ${Number.isNaN(date.valueOf()) ? purchase.purchaseDate : date.toLocaleDateString()}`;
      element.append(notice);
    }
    const legend = document.createElement('div'); legend.className = 'fanatical-library-legend';
    for (const [state, label] of [['owned', 'Owned'], ['owned-elsewhere', 'Owned elsewhere'], ['new', 'New'], ['partial', 'Partial'], ['possible', 'Possible'], ['unchecked', 'Not checked']]) { const chip = document.createElement('span'); chip.className = `fanatical-library-legend-${state}`; chip.textContent = label; legend.append(chip); }
    element.append(legend);
    if (state.galacticEnabled) { const galactic = document.createElement('p'); galactic.className = 'fanatical-library-galactic-status'; galactic.textContent = `Galactic Library: ${state.galacticStatus}`; galactic.title = 'Checks catalog and contents evidence with local Galactic Library. Central Fanatical copies are excluded; rescan local orders if the snapshots disagree.'; element.append(galactic); }
    appendNewOnlyFilter(element);
    if (counts.partial) {
      const partial = document.createElement('p'); partial.className = 'fanatical-library-match-note';
      partial.textContent = `${counts.partial} grouped item${counts.partial === 1 ? ' is' : 's are'} only partly owned - not counted as owned or new.`;
      element.append(partial);
    }
    if (counts.possible) {
      const possible = document.createElement('p'); possible.className = 'fanatical-library-match-note';
      possible.textContent = `${counts.possible} possible match${counts.possible === 1 ? '' : 'es'} - not counted as owned.`;
      element.append(possible);
    }
    let tierDownload = null;
    if (parsed.kind === 'standard' && parsed.groups.length) {
      const { tiers, recommendedPrice } = F.standardTierCoverage(parsed, matches);
      const list = document.createElement('ul'); list.className = 'fanatical-library-tier-list';
      tiers.forEach(({ price, total, confirmedNew }, index) => {
        const priceText = price !== null ? `$${(price / 100).toFixed(2)} tier` : `Tier ${index + 1}`; const perNew = confirmedNew && price !== null ? ` · $${(price / 100 / confirmedNew).toFixed(2)} per confirmed-new item` : '';
        const line = document.createElement('li'); line.textContent = `${priceText}: ${confirmedNew} confirmed new / ${total} items${perNew}`; list.append(line);
      });
      element.append(list);
      if (recommendedPrice !== null) {
        const recommendation = document.createElement('p'); recommendation.className = 'fanatical-library-buy-recommendation';
        recommendation.textContent = `Lowest tier containing all confirmed-new items: $${(recommendedPrice / 100).toFixed(2)}`;
        recommendation.title = 'Possible and partially owned items are excluded from this recommendation.';
        element.append(recommendation);
      }
      tierDownload = document.createElement('button'); tierDownload.type = 'button'; tierDownload.className = 'fanatical-library-download'; tierDownload.textContent = 'Download complete tier list'; tierDownload.addEventListener('click', () => downloadTierList(parsed, matches));
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
        row.textContent = `${priceText}: choose ${tier.quantity} item${tier.quantity === 1 ? '' : 's'} from ${availableProducts.length} available (${availableNew} confirmed new)${perItem}`;
        tierList.append(row);
      }
      element.append(tierList);
      tierDownload = document.createElement('button'); tierDownload.type = 'button'; tierDownload.className = 'fanatical-library-download'; tierDownload.textContent = 'Download complete tier list'; tierDownload.addEventListener('click', () => downloadTierList(parsed, matches));
    }
    if (detail || rates) { const extra = document.createElement('div'); extra.textContent = `${detail}${rates ? ` USD: ${rates}.` : ''}`; element.append(extra); }
    for (const [state, label] of [['owned', 'Owned'], ['owned-elsewhere', 'Owned elsewhere'], ['new', 'New'], ['partial', 'Partial'], ['possible', 'Possible matches'], ['unchecked', 'Not checked']]) {
      const entries = parsed.products.filter((_product, index) => (state === 'owned-elsewhere' ? matches[index].state === 'owned-elsewhere' : matches[index].state === state));
      if (!entries.length) continue;
      const detailList = document.createElement('details'); detailList.className = 'fanatical-library-title-list'; const title = document.createElement('summary'); title.textContent = `${label} (${entries.length})`; detailList.append(title); const list = document.createElement('ol'); alphabetize(entries).forEach((product) => {
        const match = matches[parsed.products.findIndex((candidate) => candidate.sourceItemId === product.sourceItemId)];
        const row = document.createElement('li');
        const inspect = document.createElement('button'); inspect.type = 'button'; inspect.className = 'fanatical-library-inspect'; inspect.textContent = 'Explain';inspect.setAttribute('aria-label','Explain '+product.title);
        inspect.addEventListener('click', () => showEvidence(match, inspect)); row.append(document.createTextNode(product.title+' '),inspect);
        appendRelatedTitles(row,match);
        list.append(row);
      }); detailList.append(list); element.append(detailList);
    }
    if (tierDownload) element.append(tierDownload);
    appendSummaryControls(element);
  }

  function appendContentsSummary(summary, parsed, matches) {
    const content = F.bundleContents(parsed, matches);
    if (!content.additional.length && !content.covered.length && !content.uncertain.length) return;
    const details = document.createElement('details'); details.className = 'fanatical-library-contents';
    const heading = document.createElement('summary');
    heading.textContent = `${parsed.kind === 'pick-mix' ? 'Available pool' : 'Bundle'} contents: ${content.additional.length} additional · ${content.covered.length} covered · ${content.uncertain.length} uncertain`;
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
      const list = document.createElement('ul');
      for (const entry of entries.slice(0, 100)) { const row = document.createElement('li'); row.textContent = `${label}: ${F.unitLabel(entry)}`; list.append(row); }
      if (entries.length > 100) { const row = document.createElement('li'); row.textContent = `${entries.length - 100} more ${label.toLowerCase()} units`; list.append(row); }
      details.append(list);
    }
    summary.append(details);
  }

  function appendReadingSummary(summary, matches) {
    const rows = state.reading || [];
    if (rows.length || state.readingLimits?.unknownScope) {
      const details = document.createElement('details'); details.className = 'fanatical-library-reading';
      const heading = document.createElement('summary'); heading.textContent = 'Series coverage and reading gaps'; details.append(heading);
      const note = document.createElement('p'); note.textContent = 'Numeric order within known series/run/language. Gaps cover the compared span, not a complete bibliography or publisher reading order.'; details.append(note);
      if (state.readingLimits?.unknownScope) { const text = document.createElement('p'); text.textContent = `${state.readingLimits.unknownScope} offered units lack confirmed scope; no reading gaps inferred for them.`; details.append(text); }
      if (state.readingLimits?.limited) { const text = document.createElement('p'); text.textContent = 'Large spans were bounded; only the displayed targets were compared.'; details.append(text); }
      for (const row of rows) {
        const title = document.createElement('strong'); title.textContent = `${row.label}: ${row.coverage.owned}/${row.coverage.total} full units confirmed covered`; details.append(title);
        if (row.lookupIncomplete) { const text = document.createElement('p'); text.textContent = 'Central coverage unavailable; gaps cannot be confirmed from this comparison.'; details.append(text); }
        const confirmed = new Set(row.coverage.covered.map(F.contentKey)); const possible = new Set(row.coverage.possibleCovered.map(F.contentKey));
        const list = document.createElement('ol');
        const ordered = [...row.entries].sort((left, right) => {
          const a = Number(left.number); const b = Number(right.number);
          return Number.isFinite(a) && Number.isFinite(b) ? a - b : titleCollator.compare(left.number, right.number);
        });
        for (const entry of ordered.slice(0, 100)) {
          const id = F.contentKey(entry); const status = confirmed.has(id) ? 'Covered' : possible.has(id) ? 'Possible coverage' : row.lookupIncomplete ? 'Not checked' : 'Not confirmed covered';
          const item = document.createElement('li'); item.textContent = `${entry.unitType} ${entry.number}: ${status}${row.offeredKeys.has(id) ? ' · offered here' : ' · not offered here'}`; list.append(item);
        }
        if (ordered.length > 100) { const item = document.createElement('li'); item.textContent = `${ordered.length - 100} more compared units`; list.append(item); }
        details.append(list);
      }
      summary.append(details);
    }
    const reminders = F.centralReminders([...matches, ...rows]);
    if (reminders.length || state.failed.size) {
      const details = document.createElement('details'); details.className = 'fanatical-library-reminders';
      const heading = document.createElement('summary'); heading.textContent = `Central evidence reminders (${reminders.length + (state.failed.size ? 1 : 0)})`; details.append(heading);
      const list = document.createElement('ul');
      if (state.failed.size) { const row = document.createElement('li'); row.textContent = 'Some central lookups failed. Refresh this comparison before deciding that an item is absent.'; list.append(row); }
      for (const reminder of reminders.slice(0, 100)) { const row = document.createElement('li'); row.textContent = `${reminder.title} · ${reminder.provider}: ${reminder.text}`; list.append(row); }
      if (reminders.length > 100) { const row = document.createElement('li'); row.textContent = `${reminders.length - 100} more evidence reminders; open the item inspectors to review them.`; list.append(row); }
      const refresh = document.createElement('button'); refresh.type = 'button'; refresh.textContent = 'Refresh central evidence'; refresh.className = 'fanatical-library-download';
      refresh.addEventListener('click', () => { state.galactic.clear(); state.failed.clear(); state.revision++; state.summaryDirty = true; schedule(true); });
      const review = document.createElement('button'); review.type = 'button'; review.textContent = 'Review in Galactic Library'; review.className = 'fanatical-library-download';
      const output = document.createElement('p'); output.setAttribute('role', 'status'); review.addEventListener('click', () => openCentralReview(review, output));
      details.append(list, refresh, review, output); summary.append(details);
    }
  }

  async function render() {
    if (state.rendering) return; const current = route(); if (!current) return;
    const hasStableSummary = !state.summaryDirty && state.url === location.href && Boolean(document.querySelector('[data-fanatical-library-summary]'));
    state.rendering = true;
    const revision = state.revision; const pageUrl = location.href;
    const startedAt = performance.now();
    observer?.disconnect();
    if (!hasStableSummary) showPanel('Fanatical Library: loading ownership status…');
    try {
      const [parsed, stored] = await Promise.all([loadPublicBundle(current), chrome.storage.local.get({ fanaticalLibraryItems: [], fanaticalHistoricalItems: [], fanaticalProfileLabel: '', fanaticalWishlistItems: [], fanaticalImportSummary: null, galacticLibraryExtensionId: '', fanaticalShowNewItemsOnly: false, fanaticalShowDiagnostics: false,fanaticalSummaryPreferences:{} })]);
      if (revision !== state.revision || pageUrl !== location.href) return;
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
      await queryGalactic([...allProducts.filter(product => F.classify(product, stored.fanaticalLibraryItems).state !== 'owned'), ...reading.queries.map(query => query.item)], stored.galacticLibraryExtensionId);
      if (revision !== state.revision || pageUrl !== location.href) return;
      const ownedOffers = parsed.products.filter(product => F.classify(product, stored.fanaticalLibraryItems).state === 'owned');
      const localUnits = F.localContents([...stored.fanaticalLibraryItems, ...ownedOffers]);
      const matches = parsed.products.map((product) => status(product, stored.fanaticalLibraryItems, localUnits));
      state.reading = F.readingCoverage(reading, [...localUnits, ...F.editionContentsEvidence(matches)], externalResult, state.galacticEnabled);
      state.readingLimits = reading;
      parsed.products.forEach((product, index) => {
        const card = cardFor(product); if (!card) return;
        let badge;
        badge = F.upsertBadge(card, product.sourceItemId, matches[index], card.querySelector('.cover-container') ?? card, () => showEvidence(matches[index], badge));
        upsertCardTitle(card, product, matches[index]);
      });
      // While New-only is active, the visible Pick & Mix rows live in our
      // temporary reflow grid. Sorting that transient grid would also pull
      // the hidden original rows into it, so they would be removed along
      // with the temporary grid when the filter is switched off.
      if (parsed.kind === 'pick-mix') {
        if (!state.showNewOnly) sortPickMixCards();
      } else sortStandardBundleCards();
      if (!hasStableSummary) renderSummary(parsed, matches, stored.fanaticalLibraryItems);
      state.summaryDirty = false;
      applyNewOnlyFilter();
      const summary = document.querySelector('[data-fanatical-library-summary]');
      if (summary && !diagnosticsEnabled) summary.querySelector('[data-fanatical-library-diagnostics]')?.remove();
      if (summary && diagnosticsEnabled) {
        const detected = new Set(parsed.products.map((product) => cardFor(product)).filter(Boolean));
        const counts = new Map();
        for (const match of matches) counts.set(match.state, (counts.get(match.state) || 0) + 1);
        updateDiagnostics(summary, [
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
      state.rendering = false;
      observer?.observe(document.documentElement, { childList: true, subtree: true });
      if (revision !== state.revision || pageUrl !== location.href) schedule(true);
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
    clearTimeout(state.timer); state.timer = setTimeout(render, 120);
  };
  observer = new MutationObserver(() => schedule());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if(changes.fanaticalSummaryPreferences){state.summaryPreferences=F.normalizeSummaryPreferences(changes.fanaticalSummaryPreferences.newValue);document.querySelector('[data-fanatical-library-summary]')?.dispatchEvent(new Event('fanatical-summary-preferences'));}
    if(changes.fanaticalWishlistItems)state.summaryDirty=true;
    if (changes.fanaticalLibraryItems || changes.fanaticalHistoricalItems || changes.fanaticalProfileLabel || changes.galacticLibraryExtensionId) {
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
  schedule();
}());
