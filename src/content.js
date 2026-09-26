(function fanaticalPageOverlay() {
  'use strict';
  const F = globalThis.FanaticalLibrary;
  if (!F) return;
  const state = { url: '', parsed: null, rendering: false, timer: null, galactic: new Map(), galacticEnabled: false, galacticStatus: 'Not configured.', showNewOnly: false, pickMixReflow: [] };
  let observer = null;

  function route() {
    const path = location.pathname.replace(/\/+$/u, ''); const slug = path.split('/').pop();
    if (!slug || !/^[a-z0-9-]+$/iu.test(slug)) return null;
    if (path.includes('/pick-and-mix/')) return { kind: 'pick-mix', slug, endpoint: `/api/pick-and-mix/${encodeURIComponent(slug)}/en` };
    if (path.includes('/bundle/') || path.includes('/products-group/')) return { kind: 'standard', slug, endpoint: `/api/products-group/${encodeURIComponent(slug)}/en` };
    return null;
  }

  function plainProduct(raw) {
    if (!raw?._id || typeof raw?.name !== 'string') return null;
    const externalIds = {};
    if (raw?.steam?.id !== undefined && raw.steam.id !== null) externalIds.steamAppId = String(raw.steam.id);
    if (raw?.isbn) externalIds.isbn = String(raw.isbn).replace(/[^0-9X]/giu, '');
    return { sourceItemId: String(raw._id), title: raw.name.trim(), slug: String(raw.slug ?? ''), mediaType: F.mediaType(raw.display_type ?? raw.type), externalIds, availability: { soldOut: raw.soldOut === true, regionAvailable: raw.regionAvailable !== false } };
  }

  function parse(raw, kind) {
    const pickMix = kind === 'pick-mix' || (Array.isArray(raw?.products) && Array.isArray(raw?.tiers));
    const groups = pickMix ? [] : (Array.isArray(raw?.bundles) ? raw.bundles : []).map((group) => ({ price: group?.price ?? {}, products: (Array.isArray(group?.games) ? group.games : []).map(plainProduct).filter(Boolean) }));
    const products = pickMix ? raw.products.map(plainProduct).filter(Boolean) : groups.flatMap((group) => group.products);
    const tiers = pickMix ? raw.tiers.map((tier) => ({ quantity: Number(tier?.quantity ?? 0), price: tier?.price ?? {} })).filter((tier) => tier.quantity > 0) : [];
    return { kind: pickMix ? 'pick-mix' : 'standard', sourceItemId: String(raw?._id ?? ''), title: String(raw?.name ?? ''), products, groups, tiers };
  }

  async function loadPublicBundle(current) {
    if (state.url === location.href && state.parsed) return state.parsed;
    const response = await chrome.runtime.sendMessage({ type: 'FANATICAL_GET_PUBLIC_BUNDLE', path: current.endpoint });
    if (!response?.ok) throw new Error(response?.error ?? 'Fanatical bundle data is unavailable.');
    state.parsed = parse(response.bundle, current.kind); state.url = location.href; state.galactic.clear();
    return state.parsed;
  }

  async function queryGalactic(products, extensionId) {
    state.galacticEnabled = F.isExtensionId(extensionId);
    if (!state.galacticEnabled) { state.galacticStatus = 'Not configured.'; return; }
    const requests = F.galacticRequestItems(products);
    if (!requests.length) { state.galacticStatus = 'No compatible new items to check.'; return; }
    let timeout;
    state.galacticStatus = `Checking ${requests.length} item${requests.length === 1 ? '' : 's'}…`;
    try {
      for (let offset = 0; offset < requests.length; offset += 500) {
        const response = await Promise.race([chrome.runtime.sendMessage(extensionId, { type: 'MATCH_ITEMS', apiVersion: 1, items: requests.slice(offset, offset + 500) }), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('timeout')), 3500); })]);
        if (response?.ok && response.apiVersion === 1 && Array.isArray(response.results)) for (const result of response.results) state.galactic.set(String(result?.requestId), result);
      }
      const exact = [...state.galactic.values()].filter((result) => (Array.isArray(result?.matches) ? result.matches : []).some((match) => match?.ownership === 'owned' || match?.ownership === 'claimed')).length;
      state.galacticStatus = `Available. ${exact} exact external match${exact === 1 ? '' : 'es'}.`;
    } catch { state.galacticStatus = 'Unavailable; showing local Fanatical results only.'; } finally { clearTimeout(timeout); }
  }

  function status(product, localItems) {
    const local = F.classify(product, localItems);
    return F.mergeGalactic(local, state.galactic.get(product.sourceItemId));
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
    return products.filter((product) => {
      const card = cardFor(product); const classes = String(card?.className ?? '');
      return /\b(?:selected|chosen|active)\b/iu.test(classes) || Boolean(card?.querySelector('input:checked, [aria-pressed="true"], [aria-selected="true"]'));
    }).length;
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
      }
    }
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
    for (const row of savedRows) row.node.style.setProperty('display', 'none', 'important');
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

  function downloadTierList(parsed, matches) {
    const stateFor = (product) => matches[parsed.products.findIndex((candidate) => candidate.sourceItemId === product.sourceItemId)]?.state ?? 'new';
    const lines = [`Fanatical Library — ${parsed.title}`, ''];
    if (parsed.kind === 'standard') parsed.groups.forEach((group, index) => {
      const price = Number(group.price?.USD); lines.push(`${Number.isFinite(price) ? `$${(price / 100).toFixed(2)}` : `Tier ${index + 1}`} tier`);
      group.products.forEach((product) => lines.push(`[${stateFor(product)}] ${product.title}`)); lines.push('');
    });
    else parsed.products.forEach((product) => lines.push(`[${stateFor(product)}] ${product.title}`));
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${parsed.title.replace(/[^a-z0-9]+/giu, '-').replace(/^-|-$/gu, '').toLowerCase() || 'fanatical-bundle'}-tier-list.txt`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0);
  }

  function renderSummary(parsed, matches, localItems) {
    const counts = { owned: 0, elsewhere: 0, possible: 0, new: 0 };
    for (const match of matches) { if (match.state === 'owned') counts.owned++; else if (match.state === 'owned-elsewhere') counts.elsewhere++; else if (match.state === 'possible' || match.state === 'partial') counts.possible++; else counts.new++; }
    const detail = parsed.kind === 'pick-mix' ? ` Available unowned: ${matches.filter((match, i) => match.state === 'new' && parsed.products[i].availability.regionAvailable && !parsed.products[i].availability.soldOut).length}. Selected (page UI): ${selectedCount(parsed.products)}.` : '';
    const rates = parsed.kind === 'pick-mix' ? parsed.tiers.map((tier) => Number.isFinite(tier.price?.USD) ? `${tier.quantity}: $${(tier.price.USD / 100 / tier.quantity).toFixed(2)}/item` : '').filter(Boolean).join(' · ') : '';
    const element = panel();
    const heading = document.createElement('strong'); heading.textContent = `Your Fanatical items: ${counts.owned} owned${counts.elsewhere ? ` · ${counts.elsewhere} elsewhere` : ''} · ${counts.new} new${counts.possible ? ` · ${counts.possible} possible` : ''}`; element.append(heading);
    const legend = document.createElement('div'); legend.className = 'fanatical-library-legend';
    for (const [state, label] of [['owned', 'Owned'], ['owned-elsewhere', 'Owned elsewhere'], ['new', 'New'], ['partial', 'Partial'], ['possible', 'Possible']]) { const chip = document.createElement('span'); chip.className = `fanatical-library-legend-${state}`; chip.textContent = label; legend.append(chip); }
    element.append(legend);
    if (state.galacticEnabled) { const galactic = document.createElement('p'); galactic.className = 'fanatical-library-galactic-status'; galactic.textContent = `Galactic Library: ${state.galacticStatus}`; galactic.title = 'Galactic Library receives only current Fanatical titles and returns narrow ownership matches from connected providers.'; element.append(galactic); }
    const purchase = (Array.isArray(localItems) ? localItems : []).find((item) => item?.bundle?.sourceItemId === parsed.sourceItemId);
    if (purchase?.purchaseDate) { const notice = document.createElement('p'); notice.className = 'fanatical-library-purchased'; const date = new Date(purchase.purchaseDate); notice.textContent = `Already purchased: ${Number.isNaN(date.valueOf()) ? purchase.purchaseDate : date.toLocaleDateString()}`; element.append(notice); }
    if (parsed.kind === 'standard' && parsed.groups.length) {
      const byId = new Map(parsed.products.map((product, index) => [product.sourceItemId, matches[index]]));
      const list = document.createElement('ul'); list.className = 'fanatical-library-tier-list';
      let cumulativeTotal = 0; let cumulativeOwned = 0; let cumulativeElsewhere = 0; let cumulativePossible = 0;
      parsed.groups.forEach((group, index) => {
        const groupCounts = { owned: 0, elsewhere: 0, possible: 0, new: 0 };
        for (const product of group.products) { const match = byId.get(product.sourceItemId); if (match?.state === 'owned') groupCounts.owned++; else if (match?.state === 'owned-elsewhere') groupCounts.elsewhere++; else if (match?.state === 'possible' || match?.state === 'partial') groupCounts.possible++; else groupCounts.new++; }
        cumulativeTotal += group.products.length; cumulativeOwned += groupCounts.owned; cumulativeElsewhere += groupCounts.elsewhere; cumulativePossible += groupCounts.possible;
        const confirmedNew = cumulativeTotal - cumulativeOwned - cumulativeElsewhere - cumulativePossible;
        const price = Number(group.price?.USD); const priceText = Number.isFinite(price) ? `$${(price / 100).toFixed(2)} tier` : `Tier ${index + 1}`; const perNew = confirmedNew && Number.isFinite(price) ? ` · $${(price / 100 / confirmedNew).toFixed(2)} per confirmed-new item` : '';
        const line = document.createElement('li'); line.textContent = `${priceText}: ${confirmedNew} confirmed new / ${cumulativeTotal} items${perNew}`; list.append(line);
      });
      element.append(list);
      const download = document.createElement('button'); download.type = 'button'; download.className = 'fanatical-library-download'; download.textContent = 'Download complete tier list'; download.addEventListener('click', () => downloadTierList(parsed, matches)); element.append(download);
    }
    if (detail || rates) { const extra = document.createElement('div'); extra.textContent = `${detail}${rates ? ` USD: ${rates}.` : ''}`; element.append(extra); }
    const showNew = document.createElement('label'); showNew.className = 'fanatical-library-bundle-filter'; const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = state.showNewOnly; checkbox.addEventListener('change', () => { state.showNewOnly = checkbox.checked; applyNewOnlyFilter(); }); showNew.append(checkbox, ' Show new items only'); element.append(showNew);
    for (const [state, label] of [['owned', 'Owned'], ['owned-elsewhere', 'Owned elsewhere'], ['new', 'New'], ['partial', 'Partially owned'], ['possible', 'Possible matches']]) {
      const entries = parsed.products.filter((_product, index) => (state === 'owned-elsewhere' ? matches[index].state === 'owned-elsewhere' : matches[index].state === state));
      if (!entries.length) continue;
      const detailList = document.createElement('details'); detailList.className = 'fanatical-library-title-list'; const title = document.createElement('summary'); title.textContent = `${label} (${entries.length})`; detailList.append(title); const list = document.createElement('ol'); entries.sort((left, right) => left.title.localeCompare(right.title)).forEach((product) => { const row = document.createElement('li'); row.textContent = product.title; list.append(row); }); detailList.append(list); element.append(detailList);
    }
  }

  async function render() {
    if (state.rendering) return; const current = route(); if (!current) return;
    if (state.url !== location.href) state.showNewOnly = false;
    const hasStableSummary = state.url === location.href && Boolean(document.querySelector('[data-fanatical-library-summary]'));
    state.rendering = true;
    observer?.disconnect();
    if (!hasStableSummary) showPanel('Fanatical Library: loading ownership status…');
    try {
      const [parsed, stored] = await Promise.all([loadPublicBundle(current), chrome.storage.local.get({ fanaticalLibraryItems: [], galacticLibraryExtensionId: '' })]);
      await queryGalactic(parsed.products.filter((product) => F.classify(product, stored.fanaticalLibraryItems).state === 'new'), stored.galacticLibraryExtensionId);
      const matches = parsed.products.map((product) => status(product, stored.fanaticalLibraryItems));
      parsed.products.forEach((product, index) => {
        const card = cardFor(product); if (!card) return;
        F.upsertBadge(card, product.sourceItemId, matches[index], card.querySelector('.cover-container') ?? card);
      });
      if (!hasStableSummary) renderSummary(parsed, matches, stored.fanaticalLibraryItems);
      applyNewOnlyFilter();
    } catch (error) {
      showPanel(`Fanatical Library could not load this bundle: ${String(error?.message ?? 'unknown error')}`, true);
    } finally {
      state.rendering = false;
      observer?.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  const schedule = (force = false) => {
    if (!force && state.parsed && !cardsNeedAnnotation()) return;
    clearTimeout(state.timer); state.timer = setTimeout(render, 120);
  };
  observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  chrome.storage.onChanged.addListener(() => schedule(true));
  schedule();
}());
