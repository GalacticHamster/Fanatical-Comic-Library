/* Self-contained: Chrome serializes this exact function into the Fanatical page. */
export async function importFanaticalOrdersInPage({ fullScan = false, knownOrderFingerprints = [], scanHistoryMissing = false, progressId = '', operation = 'import', orderSummaries = [], orderDetails = [], returnFailure = false, allowPartial = false, accountOrderFingerprints = [], progressFormat = 'fan' } = {}) {
  // Chrome does not propagate MAIN-world exceptions to InjectionResult. Keep
  // errors in an explicit, aggregate-only envelope when called by the worker.
  const listingEvidence={arrayPages:0,objectPages:0,otherPages:0,headersReadablePages:0,linkHeaderPages:0,totalCountHeaderPages:0,contentRangeHeaderPages:0,nextReferencePages:0};
  const diagnostic = {listingEvidence,stage:'authentication',pagesAttempted:0,pagesParsed:0,ordersRecognized:0,detailsParsed:0,retries:0,terminalReached:false,authentication:'unknown',httpStatus:null};
  const unresolved=new Set(),ineligible=new Set(),verified=new Set(),failureCounts=new Map();
  let discoveryComplete=true,unidentifiedRecords=0;
  const activity={sequence:0,phase:'activity',stage:'listing',pages:0,discovered:0,scheduled:0,completed:0,failed:0,active:0,retries:0,validatedItems:0},began=Date.now();
  let progressAt=0,progressStage='';
  const activityProgress=(stage=activity.stage,force=false)=>{
    activity.stage=stage;const now=Date.now();if(!force&&stage===progressStage&&now-progressAt<150)return;
    progressAt=now;progressStage=stage;
    if(!/^[a-f0-9]{32}$/u.test(progressId)||typeof window==='undefined')return;
    try{const value={...activity,sequence:++activity.sequence,elapsedMs:now-began};window.postMessage(progressFormat==='gl'?{channel:'gl-fanatical-progress',progressId,progress:{...value,phase:stage}}:{type:'FANATICAL_IMPORT_PROGRESS',progressId,progress:value},'https://www.fanatical.com');}catch{/* Progress cannot affect acquisition. */}
  };
  const fatal=error=>['authentication-missing','authentication-rejected','session-changed','order-identity-conflict','account-scope-conflict'].includes(error?.fanaticalFailureCode);
  const note=(error,stage)=>{const code=error?.fanaticalFailureCode??'details-unreadable',key=stage+':'+code,old=failureCounts.get(key);failureCounts.set(key,{code,stage,count:(old?.count??0)+1});};
  const failure = (code, message) => Object.assign(new Error(message), {fanaticalFailureCode:code});
  try {
  // Progress is informational only. Send aggregate counts, never account data,
  // order identifiers, titles, authentication tokens or redemption values.
  let legacyProgressAt=0;
  const reportProgress = (progress) => {
    if (progressFormat==='gl'||!/^[a-f0-9]{32}$/u.test(progressId) || typeof window === 'undefined') return;
    if(progress.phase==='details'&&progress.completed!==progress.total&&Date.now()-legacyProgressAt<150)return;
    legacyProgressAt=Date.now();
    try { window.postMessage({type:'FANATICAL_IMPORT_PROGRESS',progressId,progress}, 'https://www.fanatical.com'); } catch { /* Progress must not affect scan results. */ }
  };
  const safeTextInPage = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const safeIdInPage = (value) => /^[a-zA-Z0-9_-]{6,128}$/u.test(String(value ?? '')) ? String(value) : '';
  const safeDateInPage = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
  const trueKeysInPage = (value) => Object.entries(value && typeof value === 'object' ? value : {}).filter(([, active]) => active === true).map(([key]) => key).sort();
  const GENERIC_CATEGORY_OR_DELIVERY = /^(?:audio|video|ebook|book|comic|software|game|download|direct\s+download|web|torrent|bittorrent|stream|streaming|external\s+key|steam\s+key|key)$/iu;

  const normalizeExtInPage = (raw, isExplicitFormatField = false) => {
    if (!raw || typeof raw !== 'string') return '';
    const trimmed = raw.trim();
    if (!trimmed || GENERIC_CATEGORY_OR_DELIVERY.test(trimmed)) return '';

    const mimeMatch = trimmed.match(/^(?:application|video|audio|image)\/([a-z0-9.+_-]+)$/iu);
    if (mimeMatch) {
      const sub = mimeMatch[1].toLowerCase();
      if (sub === 'pdf') return 'pdf';
      if (sub.includes('epub')) return 'epub';
      if (sub.includes('cbz') || sub.includes('x-cbz')) return 'cbz';
      if (sub.includes('cbr') || sub.includes('x-cbr')) return 'cbr';
      if (sub.includes('mobi')) return 'mobi';
      if (sub === 'mp4') return 'mp4';
      if (sub === 'flac') return 'flac';
      if (sub === 'mpeg' || sub === 'mp3') return 'mp3';
      if (sub === 'wav' || sub.includes('wave')) return 'wav';
      if (sub === 'zip') return 'zip';
      if (sub.includes('octet-stream')) return '';
    }

    if (/^https?:\/\//iu.test(trimmed) || trimmed.includes('/') || trimmed.includes('\\')) {
      const queryMatch = trimmed.match(/[?&](?:filename|file|name)=([^&#]+)/iu);
      if (queryMatch) {
        const fromQuery = normalizeExtInPage(decodeURIComponent(queryMatch[1]), isExplicitFormatField);
        if (fromQuery) return fromQuery;
      }
      const pathPart = trimmed.split(/[?#]/)[0];
      const extMatch = pathPart.match(/\.([a-z0-9]{2,16})$/iu);
      if (extMatch && !GENERIC_CATEGORY_OR_DELIVERY.test(extMatch[1])) {
        return extMatch[1].toLowerCase();
      }
      return '';
    }

    const parenMatch = trimmed.match(/\((?:[a-z0-9\s_-]*\.)?([a-z0-9]{2,16})\)/iu)
      || trimmed.match(/\[(?:[a-z0-9\s_-]*\.)?([a-z0-9]{2,16})\]/iu);
    if (parenMatch) {
      const cand = parenMatch[1].toLowerCase();
      if (/^(?:pdf|epub|cbz|cbr|mobi|azw3|djvu|zip|rar|7z|tar|gz|exe|dmg|pkg|deb|rpm|appimage|mp4|mkv|mov|avi|webm|m4v|flv|mp3|flac|wav|m4a|m4b|ogg|opus|blend|unitypackage|uproject|uasset|gmz|yyz)$/iu.test(cand)) {
        return cand;
      }
    }

    const keywordMatch = trimmed.match(/\b(pdf|epub|cbz|cbr|mobi|azw3|djvu|zip|rar|7z|tar\.gz|exe|dmg|pkg|deb|rpm|appimage|mp4|mkv|mov|avi|webm|m4v|mp3|flac|wav|m4a|m4b|ogg|opus|blend|unitypackage)\b/iu);
    if (keywordMatch) {
      return keywordMatch[1].toLowerCase();
    }

    let clean = trimmed.toLowerCase();
    if (clean.startsWith('.')) clean = clean.slice(1);
    if (/^[a-z0-9]{2,16}$/iu.test(clean) && !GENERIC_CATEGORY_OR_DELIVERY.test(clean)) {
      return clean;
    }

    if (isExplicitFormatField && trimmed.length <= 40 && !GENERIC_CATEGORY_OR_DELIVERY.test(trimmed)) {
      return trimmed;
    }
    return '';
  };

  const formatsInPage = (leafOrDownloads) => {
    if (!leafOrDownloads) return [];
    const formats = new Set();
    const scanItem = (item) => {
      if (!item || typeof item !== 'object') return;
      const f1 = normalizeExtInPage(item.format, true); if (f1) formats.add(f1);
      const f2 = normalizeExtInPage(item.filetype, true); if (f2) formats.add(f2);
      const f3 = normalizeExtInPage(item.file_type, true); if (f3) formats.add(f3);
      const f4 = normalizeExtInPage(item.extension, true); if (f4) formats.add(f4);
      const f5 = normalizeExtInPage(item.file_extension, true); if (f5) formats.add(f5);
      const f6 = normalizeExtInPage(item.ext, true); if (f6) formats.add(f6);
      const f7 = normalizeExtInPage(item.mime_type, true); if (f7) formats.add(f7);
      const f8 = normalizeExtInPage(item.name, false); if (f8) formats.add(f8);
      const f9 = normalizeExtInPage(item.filename, false); if (f9) formats.add(f9);
      const f10 = normalizeExtInPage(item.file_name, false); if (f10) formats.add(f10);
      if (typeof item.url === 'string') {
        const f11 = normalizeExtInPage(item.url, false); if (f11) formats.add(f11);
      }
      if (Array.isArray(item.files)) item.files.forEach(scanItem);
      if (Array.isArray(item.items)) item.items.forEach(scanItem);
      if (Array.isArray(item.downloads)) item.downloads.forEach(scanItem);
    };

    if (Array.isArray(leafOrDownloads)) {
      leafOrDownloads.forEach(scanItem);
    } else if (typeof leafOrDownloads === 'object') {
      if (Array.isArray(leafOrDownloads.downloads)) leafOrDownloads.downloads.forEach(scanItem);
      if (leafOrDownloads.download && typeof leafOrDownloads.download === 'object') scanItem(leafOrDownloads.download);
      if (Array.isArray(leafOrDownloads.files)) leafOrDownloads.files.forEach(scanItem);
      if (typeof leafOrDownloads.format === 'string') {
        const f = normalizeExtInPage(leafOrDownloads.format, true); if (f) formats.add(f);
      }
      if (Array.isArray(leafOrDownloads.formats)) {
        for (const fmt of leafOrDownloads.formats) {
          const f = normalizeExtInPage(fmt, true); if (f) formats.add(f);
        }
      }
      if (leafOrDownloads.metadata && typeof leafOrDownloads.metadata === 'object') {
        if (typeof leafOrDownloads.metadata.format === 'string') {
          const f = normalizeExtInPage(leafOrDownloads.metadata.format, true); if (f) formats.add(f);
        }
        if (Array.isArray(leafOrDownloads.metadata.formats)) {
          for (const fmt of leafOrDownloads.metadata.formats) {
            const f = normalizeExtInPage(fmt, true); if (f) formats.add(f);
          }
        }
      }
    }
    return [...formats].sort((a, b) => a.localeCompare(b));
  };
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
    const formats = formatsInPage(leaf);
    const hasDownloads = (Array.isArray(leaf?.downloads) && leaf.downloads.length > 0)
      || (leaf?.download && typeof leaf.download === 'object')
      || (Array.isArray(leaf?.files) && leaf.files.length > 0)
      || Boolean(leaf?.format || (Array.isArray(leaf?.formats) && leaf.formats.length > 0));
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
      ...(hasDownloads || formats.length > 0 ? { formats } : {}),
      bundle: { sourceItemId: safeIdInPage(parent?._id), title: safeTextInPage(parent?.name), ...(safeTextInPage(parent?.slug, 300) ? { slug: safeTextInPage(parent.slug, 300) } : {}) },
      purchaseDate: safeDateInPage(order?.date),
      purchaseOrigins: [{
        purchaseRef,
        bundle: { sourceItemId: safeIdInPage(parent?._id), title: safeTextInPage(parent?.name), ...(safeTextInPage(parent?.slug, 300) ? { slug: safeTextInPage(parent.slug, 300) } : {}) },
        purchaseDate: safeDateInPage(order?.date),
        quantity: 1,
        ...(safeTextInPage(leaf?.delivery) ? { delivery: safeTextInPage(leaf.delivery) } : {}),
        ...(leaf?.streaming ? { streaming: true } : {}),
        ...(hasDownloads || formats.length > 0 ? { formats } : {})
      }]
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
        const key=JSON.stringify([origin.purchaseRef,origin.bundle?.sourceItemId]);
        const saved=origins.get(key);
        if (saved) {
          const combinedFormats = Array.isArray(saved.formats) || Array.isArray(origin.formats)
            ? [...new Set([...(saved.formats || []), ...(origin.formats || [])])].sort()
            : undefined;
          const mergedDelivery = origin.delivery || saved.delivery;
          const mergedStreaming = Boolean(origin.streaming || saved.streaming);
          origins.set(key, {
            ...saved,
            ...origin,
            quantity: saved.quantity + origin.quantity,
            ...(mergedDelivery ? { delivery: mergedDelivery } : {}),
            ...(mergedStreaming ? { streaming: true } : {}),
            ...(combinedFormats !== undefined ? { formats: combinedFormats } : {})
          });
        } else {
          origins.set(key, origin);
        }
      }
      const latest=previous&&Date.parse(previous.purchaseDate)>Date.parse(product.purchaseDate)?previous:product;
      const combinedItemFormats = Array.isArray(previous?.formats) || Array.isArray(product.formats)
        ? [...new Set([...(previous?.formats || []), ...(product.formats || [])])].sort()
        : undefined;
      const mergedItemDelivery = product.delivery || previous?.delivery;
      const mergedItemStreaming = Boolean(product.streaming || previous?.streaming);
      items.set(product.sourceItemId,{
        ...latest,
        ...(mergedItemDelivery ? { delivery: mergedItemDelivery } : {}),
        ...(mergedItemStreaming ? { streaming: true } : {}),
        ...(combinedItemFormats !== undefined ? { formats: combinedItemFormats } : {}),
        purchaseOrigins:[...origins.values()]
        ,...(previous?.occurrences||product.occurrences?{occurrences:[...(previous?.occurrences??[]),...(product.occurrences??[])]}:{})
      });
    }
    return [...items.values()].sort((a,b)=>a.sourceItemId.localeCompare(b.sourceItemId));
  };
  if(operation==='project'){
    const completeIds=new Set((Array.isArray(orderSummaries)?orderSummaries:[]).filter(order=>order?.status==='COMPLETE').map(order=>safeIdInPage(order._id)).filter(Boolean)),products=[],seen=new Set(),rejectedList=[];
    for(const order of Array.isArray(orderDetails)?orderDetails:[]){
      const id=safeIdInPage(order?._id);if(!id||seen.has(id)||!completeIds.has(id)||order.status!=='COMPLETE')continue;seen.add(id);const purchaseRef=await fingerprintOrderInPage(id);
      for(const parent of Array.isArray(order.items)?order.items:[])for(const group of Array.isArray(parent?.bundles)?parent.bundles:[])for(const leaf of Array.isArray(group?.games)?group.games:[]){
        if (isPromotionalLeaf(leaf)) {
          const leafFormats = formatsInPage(leaf);
          const hasDownloads = (Array.isArray(leaf?.downloads) && leaf.downloads.length > 0)
            || (leaf?.download && typeof leaf.download === 'object')
            || (Array.isArray(leaf?.files) && leaf.files.length > 0)
            || Boolean(leaf?.format || (Array.isArray(leaf?.formats) && leaf.formats.length > 0));
          const hasDrm = trueKeysInPage(leaf?.drm).length > 0;
          const hasStreaming = Boolean(leaf?.streaming);
          const delivery = safeTextInPage(leaf?.delivery)
            || (hasStreaming ? 'streaming' : (hasDownloads || leafFormats.length > 0 ? 'direct-download' : (hasDrm ? 'external-key' : undefined)));
          rejectedList.push({
            sourceItemId: safeIdInPage(leaf?._id) || `fan_rej_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            title: safeTextInPage(leaf?.name),
            sourceBundle: safeTextInPage(parent?.name),
            bundle: { sourceItemId: safeIdInPage(parent?._id), title: safeTextInPage(parent?.name), ...(safeTextInPage(parent?.slug, 300) ? { slug: safeTextInPage(parent.slug, 300) } : {}) },
            purchaseDate: safeDateInPage(order?.date),
            reason: 'Unclassified promotional or non-product content',
            delivery,
            ...(hasStreaming ? { streaming: true } : {}),
            formats: leafFormats
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
  if (!token) throw failure('authentication-missing','Sign in to Fanatical before importing purchases.');
  diagnostic.authentication='token-present';
  const unreadable = () => failure(diagnostic.stage+'-unreadable','Fanatical returned unreadable or incomplete order data. Your library and scan history were not changed.');
  const incomplete = (reason, code=diagnostic.stage+'-incomplete') => failure(code,`Fanatical scan incomplete; order-history coverage could not be confirmed: ${reason} Your library and scan history were not changed.`);
  const scanController = new AbortController();
  const concurrency = 3; const maxAttempts = 3; const maxPages = 1000; const maxOrders = 100000;
  let retries = 0; let cooldownUntil = 0;
  const pause = (ms) => new Promise((resolve, reject) => {
    if (scanController.signal.aborted) { reject(incomplete('Scan stopped after a failed request.','request-aborted')); return; }
    const abort = () => { clearTimeout(timer); reject(incomplete('Scan stopped after a failed request.','request-aborted')); };
    const timer = setTimeout(() => { scanController.signal.removeEventListener('abort', abort); resolve(); }, ms);
    scanController.signal.addEventListener('abort', abort, { once: true });
  });
  const retryDelay = (header, attempt) => {
    const backoff = 500 * (2 ** attempt) + Math.floor(Math.random() * 250);
    if (!header) return backoff;
    const delay = /^\d+$/u.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
    // Do not retry earlier than Retry-After, or keep the page busy indefinitely.
    if (delay > 30000) throw incomplete('Fanatical requested a longer retry delay. Please try scanning again later.','retry-later');
    if (!Number.isFinite(delay)) return backoff;
    return Math.max(backoff, delay);
  };
  const request = async (path) => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      while (cooldownUntil > Date.now()) await pause(cooldownUntil - Date.now());
      if (scanController.signal.aborted) throw incomplete('Scan stopped after a failed request.','request-aborted');
      const controller = new AbortController();
      const abort = () => controller.abort();
      scanController.signal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => controller.abort(), 20000);
      let response; let transportFailed = false;
      try {
        try {
          response = await fetch(path, { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal, headers: { accept: 'application/json', authorization: token } });
        } catch { transportFailed = true; }
        if (scanController.signal.aborted) throw incomplete('Scan stopped after a failed request.','request-aborted');
        diagnostic.httpStatus=Number.isInteger(response?.status)?response.status:null;
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
          if (response?.status === 401 || response?.status === 403) {diagnostic.authentication='rejected';throw incomplete('Fanatical session expired or access was denied. Sign in and try again.','authentication-rejected');}
          throw unreadable();
        }
      } finally {
        clearTimeout(timer); scanController.signal.removeEventListener('abort', abort);
      }
      if (attempt === maxAttempts - 1) throw incomplete('An order request failed after three attempts. Please try again later.','request-exhausted');
      const delay = retryDelay(response?.headers?.get('retry-after'), attempt);
      retries++;
      diagnostic.retries=retries;
      reportProgress({phase:'retry',attempt:attempt+2});
      activity.retries=retries;activityProgress('retry',true);
      if ([429, 503].includes(response?.status)) cooldownUntil = Math.max(cooldownUntil, Date.now() + delay);
      await pause(delay);
    }
    throw incomplete('An order request did not finish.','request-exhausted');
  };
  const pagePath = (target, current) => {
    let url;
    try { url = new URL(target, `https://www.fanatical.com${current}`); } catch { throw incomplete('A pagination link was unreadable.','pagination-unsafe'); }
    if (url.origin !== 'https://www.fanatical.com' || url.pathname !== '/api/user/orders' || url.username || url.password || url.hash) throw incomplete('An unsupported pagination link was returned.','pagination-unsafe');
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
        if (links[relation]) throw incomplete('Pagination returned ambiguous next/last links.','pagination-ambiguous');
        links[relation] = pagePath(match[1], current);
      }
    }
    return links;
  };
  const summaries = []; const visitedPages = new Set(); const pageOrderIds = new Set();
  const summaryById=new Map(),conflictingIds=new Set();
  let path = '/api/user/orders'; let expectedTotal = null; let ranged = false; let linked = false; let declaredLast = null;
  const acceptTotal = (value) => {
    if (!Number.isSafeInteger(value) || value < 0 || value > maxOrders || (expectedTotal !== null && value !== expectedTotal)) throw incomplete('Pagination totals changed or were unreadable.','pagination-total');
    expectedTotal = value;
    diagnostic.paginationEvidence=ranged?'range':'count';
  };
  const admitOrders=data=>{
    if(summaries.length+data.length>maxOrders)throw incomplete('The 100,000-order safety limit was reached.','order-limit');
    const ids=new Set(),accepted=[];
    for(const order of data){
      if(!order||typeof order._id!=='string'||!safeIdInPage(order._id)){unidentifiedRecords++;throw incomplete('Pagination returned an unreadable order.','pagination-order');}
      const previous=summaryById.get(order._id);
      if(previous){
        if(!allowPartial)throw incomplete('Pagination returned a repeated order.','pagination-order');
        discoveryComplete=false;note(failure('pagination-order','Repeated purchase identity.'),'listing');if(JSON.stringify(previous)!==JSON.stringify(order))conflictingIds.add(order._id);continue;
      }
      ids.add(order._id);summaryById.set(order._id,order);accepted.push(order);
    }
    for(const order of accepted){pageOrderIds.add(order._id);summaries.push(order);}
    diagnostic.ordersRecognized=summaries.length;
  };
  diagnostic.stage='listing';
  try {
  while (path) {
    if (visitedPages.has(path)) throw incomplete('Pagination repeated a page.','pagination-repeated');
    if (visitedPages.size >= maxPages) throw incomplete('The 1,000-page safety limit was reached.','page-limit');
    visitedPages.add(path);
    diagnostic.pagesAttempted=visitedPages.size;
    reportProgress({phase:'list',page:visitedPages.size});
    activity.pages=diagnostic.pagesParsed;activity.discovered=diagnostic.ordersRecognized;activityProgress('listing',true);
    const { data, headers } = await request(path);
    listingEvidence[Array.isArray(data)?'arrayPages':data&&typeof data==='object'?'objectPages':'otherPages']++;
    if(typeof headers?.get==='function'){
      listingEvidence.headersReadablePages++;
      for(const [header,key]of [['link','linkHeaderPages'],['x-total-count','totalCountHeaderPages'],['content-range','contentRangeHeaderPages']])if(headers.get(header)!==null&&headers.get(header)!==undefined)listingEvidence[key]++;
    }
    // Envelopes/query conventions are not guessed from a fabricated contract.
    if (!Array.isArray(data)) throw unreadable();
    diagnostic.authentication='accepted-response';
    const pageOffset=summaries.length;
    if(allowPartial)admitOrders(data);
    const total = headers?.get('x-total-count');
    if (total !== null && total !== undefined) {
      if (!/^\d+$/u.test(total)) throw unreadable();
      acceptTotal(Number(total));
    }
    const range = headers?.get('content-range');
    if (ranged && !range) throw incomplete('Pagination omitted a previously supplied range.','pagination-range');
    if (range) {
      ranged = true;
      if (data.length === 0 && summaries.length === 0 && /^(?:items|orders)\s+\*\/0$/iu.test(range)) acceptTotal(0);
      else {
        const match = /^(?:items|orders)\s+(\d+)-(\d+)\/(\d+)$/iu.exec(range);
        if (!match || Number(match[1]) !== pageOffset || Number(match[2]) - Number(match[1]) + 1 !== data.length || Number(match[2]) >= Number(match[3])) throw incomplete('Pagination ranges have gaps, overlaps or unreadable bounds.','pagination-range');
        acceptTotal(Number(match[3]));
      }
    }
    if(!allowPartial)admitOrders(data);
    if (summaries.length > maxOrders || (expectedTotal !== null && summaries.length > expectedTotal)) throw incomplete('Pagination exceeded its total or the 100,000-order safety limit.','pagination-total');
    const links = paginationLinks(headers?.get('link'), path);
    if(links.next)listingEvidence.nextReferencePages++;
    if(links.next&&expectedTotal===null)diagnostic.paginationEvidence='link';
    if (links.last) {
      if (declaredLast && declaredLast !== links.last) throw incomplete('Pagination changed its advertised last page.','pagination-last');
      declaredLast = links.last;
    }
    if (links.next) {
      if (!data.length || (expectedTotal !== null && summaries.length >= expectedTotal)) throw incomplete('Pagination supplied a next page after an empty or final page.','pagination-final');
      linked = true;
    } else if ((expectedTotal !== null && summaries.length !== expectedTotal) || (declaredLast && declaredLast !== path)) {
      throw incomplete('Fanatical returned only part of the history without a usable next-page link.','pagination-missing-next');
    }
    diagnostic.pagesParsed++;
    path = links.next || null;
  }
  }catch(error){
    if(!allowPartial||fatal(error)||!error?.fanaticalFailureCode||!summaries.length)throw error;
    discoveryComplete=false;note(error,'listing');
  }
  diagnostic.terminalReached=discoveryComplete;
  diagnostic.paginationEvidence=ranged?'range':expectedTotal!==null?'count':linked?'link':'array-only';
  if(allowPartial&&diagnostic.paginationEvidence==='array-only'){discoveryComplete=false;note(failure('discovery-unverified','No independent history end was supplied.'),'listing');}
  diagnostic.stage='summaries';
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
    if (!order || typeof order._id !== 'string' || !safeIdInPage(order._id) || listed.has(order._id)) throw unreadable();
    listed.add(order._id);
    try{
      if(conflictingIds.has(order._id))throw unreadable();
      if(typeof order.status!=='string'||!/^[A-Z][A-Z_]*$/u.test(order.status))throw unreadable();
      if(order.status==='COMPLETE')expectedProducts.set(order._id,productCounts(order.items));
      else if(allowPartial){
        if(!['REFUNDED','CANCELLED','CANCELED','PENDING','FAILED'].includes(order.status))throw unreadable();
        ineligible.add(await fingerprintOrderInPage(order._id));
      }
    }catch(error){if(!allowPartial||fatal(error))throw error;unresolved.add(await fingerprintOrderInPage(order._id));note(error,'summaries');}
  }
  const complete = summaries.filter(order=>order.status==='COMPLETE'&&expectedProducts.has(order._id));
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
  const accountKnown=new Set([...known,...(Array.isArray(accountOrderFingerprints)?accountOrderFingerprints:[]).filter(fp=>typeof fp==='string'&&/^[a-f0-9]{64}$/u.test(fp)).slice(0,100000)]);
  const accountOverlap=[...accountKnown].some(fp=>listedFingerprints.has(fp));
  // Absence supplies neither continuity nor conflict evidence. Only a clean
  // headerless empty acquisition can finish without resolving saved absence;
  // it grants no complete-history or reconciliation authority.
  const unverifiedEmpty=allowPartial&&!listedFingerprints.size&&diagnostic.paginationEvidence==='array-only'&&diagnostic.pagesParsed===visitedPages.size&&!unidentifiedRecords&&failureCounts.size===1&&[...failureCounts.values()][0].code==='discovery-unverified';
  if(allowPartial&&accountKnown.size&&listedFingerprints.size&&!accountOverlap)throw failure('account-scope-conflict','The listing does not share saved purchase identity evidence. Confirm or change the account before importing.');
  if (!unverifiedEmpty&&[...known].some((fingerprint) => !listedFingerprints.has(fingerprint))) {
    const error=failure('history-missing-known','Fanatical order history omits previously scanned orders, so complete coverage could not be confirmed. Your library and scan history were not changed.');
    if(!allowPartial)throw error;discoveryComplete=false;note(error,'listing');
  }
  const toInspect = fullScan ? completeWithFingerprints : completeWithFingerprints.filter(({ fingerprint }) => !known.has(fingerprint));
  const scope = {fullScan,scanHistoryMissing,total:toInspect.length,skipped:complete.length-toInspect.length};
  reportProgress({phase:'plan',...scope});
  let completedDetails = 0;
  diagnostic.stage='details';
  activity.pages=diagnostic.pagesParsed;activity.discovered=summaries.length;activity.scheduled=toInspect.length;activityProgress('details',true);
  const details = await boundedMap(toInspect, async ({ order: listedOrder, fingerprint }) => {
    activity.active++;activityProgress('details',activity.completed===0&&activity.active===Math.min(3,activity.scheduled));
    try {
    const { data: order } = await request(`/api/user/orders/${encodeURIComponent(listedOrder._id)}`);
    if(allowPartial&&typeof order?._id==='string'&&order._id!==listedOrder._id)throw failure('order-identity-conflict','A purchase response belonged to a different order.');
    const projectedItems = [];
    if (!order || order._id !== listedOrder._id || order.status !== 'COMPLETE' || !Array.isArray(order.items) || !order.items.length) throw unreadable();
    const expected = expectedProducts.get(order._id);
    const actual = productCounts(order.items);
    if (actual.size !== expected.size || [...expected].some(([key, quantity]) => actual.get(key) !== quantity)) throw unreadable();
    let occurrence=0;
    for (const parent of order.items) {
      if (!parent || typeof parent._id !== 'string' || !safeIdInPage(parent._id) || !safeTextInPage(parent.name) || !Array.isArray(parent.bundles) || !parent.bundles.length) throw unreadable();
      for (const group of parent.bundles) {
        if (!group || !Array.isArray(group.games) || !group.games.length) throw unreadable();
        for (const leaf of group.games) {
          if (typeof leaf?._id !== 'string') throw unreadable();
          const projected = projectLeafInPage(leaf, parent, order, fingerprint);
          if (!projected) throw unreadable();
          projected.occurrences=[{occurrenceRef:await fingerprintOrderInPage(`${order._id}\u0000${occurrence++}\u0000${parent._id}\u0000${leaf._id}`),orderRef:fingerprint,bundleId:parent._id,bundleTitle:safeTextInPage(parent.name),purchasedAt:safeDateInPage(order.date)}];
          projectedItems.push(projected);
        }
      }
    }
    reportProgress({phase:'details',...scope,completed:++completedDetails});
    diagnostic.detailsParsed=completedDetails;verified.add(fingerprint);
    activity.validatedItems+=projectedItems.length;
    return projectedItems;
    }catch(error){activity.failed++;if(!allowPartial||fatal(error))throw error;unresolved.add(fingerprint);note(error,'details');return [];}
    finally{activity.active--;activity.completed++;activityProgress('details',activity.completed===activity.scheduled);}
  });
  activityProgress('validating',true);
  const items = combineProducts(details.flat());
  let currentToken='';try{currentToken=String(JSON.parse(localStorage.getItem('bsauth')||'{}')?.token||'');}catch{}
  diagnostic.stage='session';
  if(currentToken!==token)throw failure('session-changed','The signed-in Fanatical session changed during this scan. Start a fresh scan.');
  // `token`, summaries, details, and raw leaves remain in this execution world.
  const outcome=!discoveryComplete?'partial-discovery':unresolved.size?'partial-extraction':'complete';
  const finished=outcome==='complete'||outcome==='partial-discovery'&&diagnostic.paginationEvidence==='array-only'&&diagnostic.pagesParsed===visitedPages.size&&!unresolved.size&&!unidentifiedRecords&&failureCounts.size===1&&[...failureCounts.values()][0].code==='discovery-unverified';
  return {
    acquisitionContract:{version:1,provider:'fanatical',acquisition:{outcome:finished?'finished':'interrupted'},verified:[...verified].sort(),unresolved:[...unresolved].sort(),ineligible:[...ineligible].sort(),coverage:{status:outcome==='complete'?'verified':finished?'unverified':'incomplete',evidence:[diagnostic.paginationEvidence]},scope:{authority:accountOverlap?'saved-order-match':'declared-scope'},retry:[...unresolved].sort(),persistence:{outcome:'not-attempted'},reconciliation:{authority:'none'}},
    ...(allowPartial?{partialScanVersion:1,outcome,verifiedOrderFingerprints:[...verified],unresolvedOrderFingerprints:[...unresolved],ineligibleOrderFingerprints:[...ineligible],observedOrderFingerprints:[...listedFingerprints],failures:[...failureCounts.values()],unidentifiedRecords}:{}),
    schemaVersion: 1,
    coverage: { complete: allowPartial?outcome==='complete':true,...(allowPartial?{listingEvidence,discoveryComplete,pagesParsed:diagnostic.pagesParsed,accountAffinity:accountOverlap?'saved-order-match':'declared-scope'}:{}), listedOrders: summaries.length, validatedOrders: allowPartial?verified.size:details.length, emptyAccount: summaries.length === 0,
      pagesFetched: visitedPages.size, expectedTotal, paginationEvidence: ranged ? 'range' : expectedTotal !== null ? 'count' : linked ? 'link' : 'array-only', retries, concurrency },
    ordersScanned: allowPartial?verified.size:toInspect.length,
    ordersAvailable: complete.length,
    orderFingerprints: completeWithFingerprints.map(({ fingerprint }) => fingerprint).filter(fp=>!unresolved.has(fp)),
    items
  };
  } catch (error) {
    if(!returnFailure)throw error;
    // No message, stack, URL, token, order or product data crosses this path.
    return {fanaticalImportFailure:1,code:error?.fanaticalFailureCode??'page-exception',diagnostic};
  }
}
