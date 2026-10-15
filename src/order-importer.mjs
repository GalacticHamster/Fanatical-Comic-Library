/* Self-contained: Chrome serializes this exact function into the Fanatical page. */
export async function importFanaticalOrdersInPage({ fullScan = false, knownOrderFingerprints = [], scanHistoryMissing = false, progressId = '', operation = 'import', orderSummaries = [], orderDetails = [] } = {}) {
  // Progress is informational only. Send aggregate counts, never account data,
  // order identifiers, titles, authentication tokens or redemption values.
  const reportProgress = (progress) => {
    if (!/^[a-f0-9]{32}$/u.test(progressId) || typeof window === 'undefined') return;
    try { window.postMessage({type:'FANATICAL_IMPORT_PROGRESS',progressId,progress}, 'https://www.fanatical.com'); } catch { /* Progress must not affect scan results. */ }
  };
  const safeTextInPage = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const safeIdInPage = (value) => /^[a-zA-Z0-9_-]{6,128}$/u.test(String(value ?? '')) ? String(value) : '';
  const safeDateInPage = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
  const trueKeysInPage = (value) => Object.entries(value && typeof value === 'object' ? value : {}).filter(([, active]) => active === true).map(([key]) => key).sort();
  const formatsInPage = (downloads) => [...new Set((Array.isArray(downloads) ? downloads : []).flatMap((download) => (Array.isArray(download?.files) ? download.files : []).map((file) => safeTextInPage(file?.format, 32).toLowerCase())).filter(Boolean))].sort();
  const mediaTypeInPage = (value) => {
    const type = safeTextInPage(value).toLowerCase();
    if (type.includes('comic') || ['book', 'ebook', 'manga', 'graphic_novel', 'graphic novel'].includes(type)) return 'book';
    if (type.includes('audio') && type.includes('book')) return 'audiobook';
    if (type === 'game') return 'game';
    if (type.includes('software') || type.includes('asset')) return 'software';
    if (type.includes('video') || type.includes('movie') || type.includes('film')) return 'video';
    if (type.includes('learn') || type.includes('course')) return 'elearning';
    if (type.includes('audio')) return 'audio';
    return 'unclassified';
  };
  const isPromotionalLeaf = (leaf) => {
    const name = safeTextInPage(leaf?.name).toLowerCase();
    return /\b(?:how to redeem|terms and conditions|discount code|coupon|voucher|bonus voucher|wallet top-up)\b/iu.test(name);
  };
  const projectLeafInPage = (leaf, parent, order, purchaseRef) => {
    const sourceItemId = safeIdInPage(leaf?._id); const title = safeTextInPage(leaf?.name);
    if (!sourceItemId || !title) return null;
    const steam = leaf?.steam?.id === undefined || leaf?.steam?.id === null ? '' : String(leaf.steam.id);
    const isbn = safeTextInPage(leaf?.isbn, 32).replace(/[^0-9X]/giu, '');
    const externalIds = { ...(steam ? { steamAppId: steam } : {}), ...(isbn ? { isbn } : {}) };
    const catalog = {};
    for (const name of ['language', 'edition', 'series', 'run', 'volume', 'issue', 'publisher']) {
      if (safeTextInPage(leaf?.[name])) catalog[name] = safeTextInPage(leaf[name]);
    }
    const authors = Array.isArray(leaf?.authors) ? leaf.authors : typeof leaf?.author === 'string' ? [leaf.author] : [];
    const names = [...new Set(authors.map(value => safeTextInPage(value)).filter(Boolean))].slice(0, 50);
    if (names.length) catalog.authors = names;
    return {
      source: 'fanatical', sourceItemId, title,
      ...(safeTextInPage(leaf?.slug, 300) ? { slug: safeTextInPage(leaf.slug, 300) } : {}),
      mediaType: mediaTypeInPage(leaf?.display_type ?? leaf?.type),
      ...(safeTextInPage(leaf?.delivery) ? { delivery: safeTextInPage(leaf.delivery) } : {}),
      ...(leaf?.streaming ? { streaming: true } : {}),
      ...(Object.keys(externalIds).length ? { externalIds } : {}),
      ...catalog,
      ...(trueKeysInPage(leaf?.drm).length ? { drm: trueKeysInPage(leaf.drm) } : {}),
      ...(trueKeysInPage(leaf?.platforms ?? leaf?.os).length ? { platforms: trueKeysInPage(leaf.platforms ?? leaf.os) } : {}),
      ...(formatsInPage(leaf?.downloads).length ? { formats: formatsInPage(leaf.downloads) } : {}),
      bundle: { sourceItemId: safeIdInPage(parent?._id), title: safeTextInPage(parent?.name), ...(safeTextInPage(parent?.slug, 300) ? { slug: safeTextInPage(parent.slug, 300) } : {}) },
      purchaseDate: safeDateInPage(order?.date),
      purchaseOrigins: [{ purchaseRef, bundle: { sourceItemId: safeIdInPage(parent?._id), title: safeTextInPage(parent?.name), ...(safeTextInPage(parent?.slug,300) ? {slug:safeTextInPage(parent.slug,300)} : {}) }, purchaseDate: safeDateInPage(order?.date), quantity: 1 }]
    };
  };
  const fingerprintOrderInPage = async (id) => {
    const bytes = new TextEncoder().encode(String(id));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, '0')).join('');
  };
  const combineProducts = (products) => {
    const items=new Map();
    for(const product of products){
      const previous=items.get(product.sourceItemId),origins=new Map();
      for(const origin of [...(previous?.purchaseOrigins??[]),...product.purchaseOrigins]){
        const key=JSON.stringify([origin.purchaseRef,origin.bundle.sourceItemId]);const saved=origins.get(key);origins.set(key,saved?{...origin,quantity:saved.quantity+origin.quantity}:origin);
      }
      const latest=previous&&Date.parse(previous.purchaseDate)>Date.parse(product.purchaseDate)?previous:product;
      items.set(product.sourceItemId,{...latest,purchaseOrigins:[...origins.values()]});
    }
    return [...items.values()].sort((a,b)=>a.sourceItemId.localeCompare(b.sourceItemId));
  };
  if(operation==='project'){
    const completeIds=new Set((Array.isArray(orderSummaries)?orderSummaries:[]).filter(order=>order?.status==='COMPLETE').map(order=>safeIdInPage(order._id)).filter(Boolean)),products=[],seen=new Set(),rejectedList=[];
    for(const order of Array.isArray(orderDetails)?orderDetails:[]){
      const id=safeIdInPage(order?._id);if(!id||seen.has(id)||!completeIds.has(id)||order.status!=='COMPLETE')continue;seen.add(id);const purchaseRef=await fingerprintOrderInPage(id);
      for(const parent of Array.isArray(order.items)?order.items:[])for(const group of Array.isArray(parent?.bundles)?parent.bundles:[])for(const leaf of Array.isArray(group?.games)?group.games:[]){
        if (isPromotionalLeaf(leaf)) {
          rejectedList.push({
            sourceItemId: safeIdInPage(leaf?._id) || `fan_rej_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            title: safeTextInPage(leaf?.name),
            sourceBundle: safeTextInPage(parent?.name),
            bundle: { sourceItemId: safeIdInPage(parent?._id), title: safeTextInPage(parent?.name), ...(safeTextInPage(parent?.slug, 300) ? { slug: safeTextInPage(parent.slug, 300) } : {}) },
            purchaseDate: safeDateInPage(order?.date),
            reason: 'Unclassified promotional or non-product content',
            delivery: (Array.isArray(leaf?.downloads) && leaf.downloads.length) ? 'direct-download' : 'external-key',
            formats: formatsInPage(leaf?.downloads)
          });
          continue;
        }
        const product=projectLeafInPage(leaf,parent,order,purchaseRef);
        if(product)products.push(product);
      }
    }
    const result = {schemaVersion:1,ordersScanned:completeIds.size,items:combineProducts(products)};
    if (rejectedList.length) result.rejectedPurchaseItems = rejectedList;
    return result;
  }
  let token = '';
  try { token = String(JSON.parse(localStorage.getItem('bsauth') || '{}')?.token || ''); } catch { /* no signed-in token */ }
  if (!token) throw new Error('Sign in to Fanatical before importing purchases.');
  const unreadable = () => new Error('Fanatical returned unreadable or incomplete order data. Your library and scan history were not changed.');
  const incomplete = (reason) => new Error(`Fanatical scan incomplete; order-history coverage could not be confirmed: ${reason} Your library and scan history were not changed.`);
  const scanController = new AbortController();
  const concurrency = 3; const maxAttempts = 3; const maxPages = 1000; const maxOrders = 100000;
  let retries = 0; let cooldownUntil = 0;
  const pause = (ms) => new Promise((resolve, reject) => {
    if (scanController.signal.aborted) { reject(incomplete('Scan stopped after a failed request.')); return; }
    const abort = () => { clearTimeout(timer); reject(incomplete('Scan stopped after a failed request.')); };
    const timer = setTimeout(() => { scanController.signal.removeEventListener('abort', abort); resolve(); }, ms);
    scanController.signal.addEventListener('abort', abort, { once: true });
  });
  const retryDelay = (header, attempt) => {
    const backoff = 500 * (2 ** attempt) + Math.floor(Math.random() * 250);
    if (!header) return backoff;
    const delay = /^\d+$/u.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
    // Do not retry earlier than Retry-After, or keep the page busy indefinitely.
    if (delay > 30000) throw incomplete('Fanatical requested a longer retry delay. Please try scanning again later.');
    if (!Number.isFinite(delay)) return backoff;
    return Math.max(backoff, delay);
  };
  const request = async (path) => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      while (cooldownUntil > Date.now()) await pause(cooldownUntil - Date.now());
      if (scanController.signal.aborted) throw incomplete('Scan stopped after a failed request.');
      const controller = new AbortController();
      const abort = () => controller.abort();
      scanController.signal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => controller.abort(), 20000);
      let response; let transportFailed = false;
      try {
        try {
          response = await fetch(path, { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal, headers: { accept: 'application/json', authorization: token } });
        } catch { transportFailed = true; }
        if (scanController.signal.aborted) throw incomplete('Scan stopped after a failed request.');
        if (response?.status === 200) {
          let data;
          try { data = await response.json(); } catch (error) {
            if (!controller.signal.aborted && error?.name !== 'TypeError') throw unreadable();
            transportFailed = true;
          }
          if (!transportFailed) return { data, headers: response.headers };
        }
        // Do not leave retry/error response streams downloading in the background.
        try { await response?.body?.cancel(); } catch { /* No ownership data is read from error bodies. */ }
        if (!transportFailed && ![408, 429, 500, 502, 503, 504].includes(response?.status)) {
          if (response?.status === 401 || response?.status === 403) throw incomplete('Fanatical session expired or access was denied. Sign in and try again.');
          throw unreadable();
        }
      } finally {
        clearTimeout(timer); scanController.signal.removeEventListener('abort', abort);
      }
      if (attempt === maxAttempts - 1) throw incomplete('An order request failed after three attempts. Please try again later.');
      const delay = retryDelay(response?.headers?.get('retry-after'), attempt);
      retries++;
      reportProgress({phase:'retry',attempt:attempt+2});
      if ([429, 503].includes(response?.status)) cooldownUntil = Math.max(cooldownUntil, Date.now() + delay);
      await pause(delay);
    }
    throw incomplete('An order request did not finish.');
  };
  const pagePath = (target, current) => {
    let url;
    try { url = new URL(target, `https://www.fanatical.com${current}`); } catch { throw incomplete('A pagination link was unreadable.'); }
    if (url.origin !== 'https://www.fanatical.com' || url.pathname !== '/api/user/orders' || url.username || url.password || url.hash) throw incomplete('An unsupported pagination link was returned.');
    url.searchParams.sort();
    return url.pathname + url.search;
  };
  // Split Link entries/parameters without splitting commas in quoted dates or
  // semicolons inside an angle-bracketed URL. Reject ambiguous header syntax.
  const splitHeader = (value, separator) => {
    const parts = []; let start = 0; let quoted = false; let angle = false; let escaped = false;
    for (let i = 0; i < value.length; i++) {
      const char = value[i];
      if (escaped) { escaped = false; continue; }
      if (quoted && char === '\\') { escaped = true; continue; }
      if (!angle && char === '"') quoted = !quoted;
      if (!quoted && char === '<') { if (angle) throw unreadable(); angle = true; }
      if (!quoted && char === '>') { if (!angle) throw unreadable(); angle = false; }
      if (!quoted && !angle && char === separator) { parts.push(value.slice(start, i).trim()); start = i + 1; }
    }
    if (quoted || angle || escaped) throw unreadable();
    parts.push(value.slice(start).trim()); return parts;
  };
  const paginationLinks = (header, current) => {
    const links = {};
    if (!header) return links;
    for (const entry of splitHeader(header, ',')) {
      const match = /^<([^<>]+)>(.*)$/u.exec(entry);
      if (!match) throw unreadable();
      const parameters = splitHeader(match[2], ';');
      if (parameters.shift() !== '') throw unreadable();
      let relations = null;
      for (const parameter of parameters) {
        const param = /^([a-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s";]+))$/iu.exec(parameter);
        if (!param || param[1].toLowerCase() === 'anchor') throw unreadable();
        if (param[1].toLowerCase() === 'rel') {
          if (relations !== null) throw unreadable();
          relations = (param[2] ?? param[3]).toLowerCase().split(/\s+/u);
        }
      }
      if (!relations) throw unreadable();
      for (const relation of relations.filter((rel) => ['next', 'last'].includes(rel))) {
        if (links[relation]) throw incomplete('Pagination returned ambiguous next/last links.');
        links[relation] = pagePath(match[1], current);
      }
    }
    return links;
  };
  const summaries = []; const visitedPages = new Set(); const pageOrderIds = new Set();
  let path = '/api/user/orders'; let expectedTotal = null; let ranged = false; let linked = false; let declaredLast = null;
  const acceptTotal = (value) => {
    if (!Number.isSafeInteger(value) || value < 0 || value > maxOrders || (expectedTotal !== null && value !== expectedTotal)) throw incomplete('Pagination totals changed or were unreadable.');
    expectedTotal = value;
  };
  while (path) {
    if (visitedPages.has(path)) throw incomplete('Pagination repeated a page.');
    if (visitedPages.size >= maxPages) throw incomplete('The 1,000-page safety limit was reached.');
    visitedPages.add(path);
    reportProgress({phase:'list',page:visitedPages.size});
    const { data, headers } = await request(path);
    // Envelopes/query conventions are not guessed from a fabricated contract.
    if (!Array.isArray(data)) throw unreadable();
    const total = headers?.get('x-total-count');
    if (total !== null && total !== undefined) {
      if (!/^\d+$/u.test(total)) throw unreadable();
      acceptTotal(Number(total));
    }
    const range = headers?.get('content-range');
    if (ranged && !range) throw incomplete('Pagination omitted a previously supplied range.');
    if (range) {
      ranged = true;
      if (data.length === 0 && summaries.length === 0 && /^(?:items|orders)\s+\*\/0$/iu.test(range)) acceptTotal(0);
      else {
        const match = /^(?:items|orders)\s+(\d+)-(\d+)\/(\d+)$/iu.exec(range);
        if (!match || Number(match[1]) !== summaries.length || Number(match[2]) - Number(match[1]) + 1 !== data.length || Number(match[2]) >= Number(match[3])) throw incomplete('Pagination ranges have gaps, overlaps or unreadable bounds.');
        acceptTotal(Number(match[3]));
      }
    }
    if (summaries.length + data.length > maxOrders) throw incomplete('The 100,000-order safety limit was reached.');
    for (const order of data) {
      if (!order || typeof order._id !== 'string' || !safeIdInPage(order._id) || pageOrderIds.has(order._id)) throw incomplete('Pagination returned an unreadable or repeated order.');
      pageOrderIds.add(order._id);
      summaries.push(order);
    }
    if (summaries.length > maxOrders || (expectedTotal !== null && summaries.length > expectedTotal)) throw incomplete('Pagination exceeded its total or the 100,000-order safety limit.');
    const links = paginationLinks(headers?.get('link'), path);
    if (links.last) {
      if (declaredLast && declaredLast !== links.last) throw incomplete('Pagination changed its advertised last page.');
      declaredLast = links.last;
    }
    if (links.next) {
      if (!data.length || (expectedTotal !== null && summaries.length >= expectedTotal)) throw incomplete('Pagination supplied a next page after an empty or final page.');
      linked = true;
    } else if ((expectedTotal !== null && summaries.length !== expectedTotal) || (declaredLast && declaredLast !== path)) {
      throw incomplete('Fanatical returned only part of the history without a usable next-page link.');
    }
    path = links.next || null;
  }
  const listed = new Set();
  const expectedProducts = new Map();
  const productCounts = (parents) => {
    if (!Array.isArray(parents) || !parents.length) throw unreadable();
    const counts = new Map();
    for (const parent of parents) {
      if (!safeTextInPage(parent?.name) || !Array.isArray(parent?.bundles) || !parent.bundles.length) throw unreadable();
      for (const group of parent.bundles) {
        if (!Array.isArray(group?.games) || !group.games.length) throw unreadable();
        for (const leaf of group.games) {
          if (!safeTextInPage(leaf?.name)) throw unreadable();
          const key = JSON.stringify([safeTextInPage(parent.name), safeTextInPage(leaf.name)]);
          counts.set(key, (counts.get(key) || 0) + 1);
        }
      }
    }
    return counts;
  };
  for (const order of summaries) {
    if (!order || typeof order._id !== 'string' || !safeIdInPage(order._id) || typeof order.status !== 'string' || !/^[A-Z][A-Z_]*$/u.test(order.status) || listed.has(order._id)) throw unreadable();
    listed.add(order._id);
    if (order.status === 'COMPLETE') expectedProducts.set(order._id, productCounts(order.items));
  }
  const complete = summaries.filter((order) => order.status === 'COMPLETE');
  // Only opaque SHA-256 fingerprints leave the page world. This lets a quick
  // scan identify unseen orders without persisting Fanatical order IDs.
  const boundedMap = async (input, task) => {
    const results = new Array(input.length); let cursor = 0; let failure = null;
    const worker = async () => {
      while (!failure && cursor < input.length) {
        const index = cursor++;
        try { results[index] = await task(input[index], index); }
        catch (error) { if (!failure) { failure = error; scanController.abort(); } }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, input.length) }, worker));
    if (failure) throw failure;
    return results;
  };
  const completeWithFingerprints = await boundedMap(complete, async (order) => ({ order, fingerprint: await fingerprintOrderInPage(order._id) }));
  const known = new Set((Array.isArray(knownOrderFingerprints) ? knownOrderFingerprints : []).filter((fingerprint) => /^[a-f0-9]{64}$/iu.test(String(fingerprint))).map((fingerprint) => String(fingerprint).toLowerCase()));
  const listedFingerprints = new Set(await boundedMap([...listed], fingerprintOrderInPage));
  if ([...known].some((fingerprint) => !listedFingerprints.has(fingerprint))) {
    throw new Error('Fanatical order history omits previously scanned orders, so complete coverage could not be confirmed. Your library and scan history were not changed.');
  }
  const toInspect = fullScan ? completeWithFingerprints : completeWithFingerprints.filter(({ fingerprint }) => !known.has(fingerprint));
  const scope = {fullScan,scanHistoryMissing,total:toInspect.length,skipped:complete.length-toInspect.length};
  reportProgress({phase:'plan',...scope});
  let completedDetails = 0;
  const details = await boundedMap(toInspect, async ({ order: listedOrder, fingerprint }) => {
    const { data: order } = await request(`/api/user/orders/${encodeURIComponent(listedOrder._id)}`);
    const projectedItems = [];
    if (!order || order._id !== listedOrder._id || order.status !== 'COMPLETE' || !Array.isArray(order.items) || !order.items.length) throw unreadable();
    const expected = expectedProducts.get(order._id);
    const actual = productCounts(order.items);
    if (actual.size !== expected.size || [...expected].some(([key, quantity]) => actual.get(key) !== quantity)) throw unreadable();
    for (const parent of order.items) {
      if (!parent || typeof parent._id !== 'string' || !safeIdInPage(parent._id) || !safeTextInPage(parent.name) || !Array.isArray(parent.bundles) || !parent.bundles.length) throw unreadable();
      for (const group of parent.bundles) {
        if (!group || !Array.isArray(group.games) || !group.games.length) throw unreadable();
        for (const leaf of group.games) {
          if (typeof leaf?._id !== 'string') throw unreadable();
          const projected = projectLeafInPage(leaf, parent, order, fingerprint);
          if (!projected) throw unreadable();
          projectedItems.push(projected);
        }
      }
    }
    reportProgress({phase:'details',...scope,completed:++completedDetails});
    return projectedItems;
  });
  const items = combineProducts(details.flat());
  let currentToken='';try{currentToken=String(JSON.parse(localStorage.getItem('bsauth')||'{}')?.token||'');}catch{}
  if(currentToken!==token)throw new Error('The signed-in Fanatical session changed during this scan. Start a fresh scan.');
  // `token`, summaries, details, and raw leaves remain in this execution world.
  return {
    schemaVersion: 1,
    coverage: { complete: true, listedOrders: summaries.length, validatedOrders: details.length, emptyAccount: summaries.length === 0,
      pagesFetched: visitedPages.size, expectedTotal, paginationEvidence: ranged ? 'range' : expectedTotal !== null ? 'count' : linked ? 'link' : 'array-only', retries, concurrency },
    ordersScanned: toInspect.length,
    ordersAvailable: complete.length,
    orderFingerprints: completeWithFingerprints.map(({ fingerprint }) => fingerprint),
    items
  };
}
