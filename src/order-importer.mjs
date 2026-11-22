/* Self-contained: Chrome serializes this exact function into the Fanatical page. */
export async function importFanaticalOrdersInPage({ fullScan = false, knownOrderFingerprints = [], scanHistoryMissing = false, progressId = '', operation = 'import', orderSummaries = [], orderDetails = [], returnFailure = false, allowPartial = false, accountOrderFingerprints = [], progressFormat = 'fan', detailLimit = 0, retryLaterOrderFingerprints = [], orderNavigationRefs } = {}) {
  // Chrome does not propagate MAIN-world exceptions to InjectionResult. Keep
  // errors in an explicit, aggregate-only envelope when called by the worker.
  const listingEvidence={arrayPages:0,objectPages:0,otherPages:0,headersReadablePages:0,linkHeaderPages:0,totalCountHeaderPages:0,contentRangeHeaderPages:0,nextReferencePages:0};
  // Fixed counters only: never export provider statuses, keys, field names or values.
  const compatibility={version:1,counts:Object.fromEntries(['unsupportedStatus','invalidStatus','missingItems','invalidItems','missingBundles','invalidBundles','missingGames','invalidGames','missingNames','summaryConflict','detailRequest','detailStructure','detailIdentity','detailStatus','detailProductMismatch','detailProductIdentity','detailProjection','scheduled','knownSkipped','multipleCopies'].map(key=>[key,0]))};
  const issue=key=>{compatibility.counts[key]++;};
  const valueType=v=>v===undefined?'missing':v===null?'null':Array.isArray(v)?'array':['object','string','number','boolean'].includes(typeof v)?typeof v:'other';
  // Bounded shapes at the failing boundary, never provider keys or values.
  const recordMismatch = (category, expectedCount = 0, observedCount = 0, parentContext) => {
    const report = compatibility.productMismatches ??= { version: 1, records: [], truncated: false };
    if (report.records.length >= 8) { report.truncated = true; return; }
    report.records.push({
      category,
      expectedCount: Number.isSafeInteger(expectedCount) && expectedCount >= 0 ? Math.min(expectedCount, 100000) : 0,
      observedCount: Number.isSafeInteger(observedCount) && observedCount >= 0 ? Math.min(observedCount, 100000) : 0,
      ...(parentContext ? { parentContext } : {})
    });
  };
  const bundleShape=(parent,reason,selectedChild)=>{
    const shapes=compatibility.bundleShapes??={version:1,records:[],truncated:false};
    if(shapes.records.length>=8){shapes.truncated=true;const summary=diagnostic.stage==='details'?shapes.records.findIndex(r=>r.stage==='summaries'):-1;if(summary<0)return;shapes.records.splice(summary,1);}
    const type=valueType;
    const bundles=parent?.bundles;let child,size=null;
    if(Array.isArray(bundles)){size=bundles.length;child=bundles[0];}
    else if(bundles&&typeof bundles==='object'){size=0;for(const key in bundles)if(Object.hasOwn(bundles,key)){if(size===0)child=bundles[key];if(++size===2)break;}}
    if(selectedChild)child=selectedChild.value;
    shapes.records.push({stage:diagnostic.stage==='summaries'?'summaries':'details',reason:reason??(bundles==null?'missing':Array.isArray(bundles)?'empty-array':'non-array'),
      parentType:type(parent),bundlesType:type(bundles),bundlesSize:size===null?'not-container':size===0?'empty':size===1?'one':'many',
      parentId:type(parent?._id),parentName:type(parent?.name),parentGames:type(parent?.games),parentProducts:type(parent?.products),parentItems:type(parent?.items),parentTiers:type(parent?.tiers),
      bundleGames:type(bundles?.games),bundleProducts:type(bundles?.products),bundleItems:type(bundles?.items),bundleTiers:type(bundles?.tiers),
      childType:type(child),childId:type(child?._id),childName:type(child?.name),childGames:type(child?.games),childProducts:type(child?.products),childItems:type(child?.items),childTiers:type(child?.tiers)});
  };
  const diagnostic = {listingEvidence,compatibility,stage:'authentication',pagesAttempted:0,pagesParsed:0,ordersRecognized:0,detailsParsed:0,retries:0,terminalReached:false,authentication:'unknown',httpStatus:null};
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
  // Fanatical's authenticated order UI renders an empty-bundles game item
  // itself (game=item), grouping pickAndMix only for display. This is not a
  // public selection pool. Keep this admission narrow; other empty containers
  // still need independently validated details and remain unresolved.
  const isDirectPurchasedItem = parent => parent && typeof parent === 'object' && !Array.isArray(parent)
    && !isPromotionalLeaf(parent)
    && (
      (parent.type === 'game' && (parent.display_type === undefined || parent.display_type === 'game'))
      || (['book', 'comic', 'audiobook', 'software'].includes(parent.type) && (parent.display_type === undefined || ['book', 'comic', 'audiobook', 'software'].includes(parent.display_type)))
    )
    && typeof parent._id === 'string' && !!safeIdInPage(parent._id) && !!safeTextInPage(parent.name)
    && Array.isArray(parent.bundles) && parent.bundles.length === 0
    && ['games','products','items','tiers'].every(key => !Object.hasOwn(parent,key));
  const isDirectPurchasedGame = isDirectPurchasedItem;
  const isPromotionalLeaf = (leaf) => {
    const name = safeTextInPage(leaf?.name).toLowerCase();
    if (/\b(?:how to redeem|terms and conditions|discount code|coupon|voucher|bonus voucher|wallet top-up|free gift|bonus gift|mystery gift)\b/iu.test(name)) return true;
    if (leaf?.isFreeProduct === true && (leaf?.mystery === true || leaf?.reveal_template === 'present')) return true;
    if (/\b(?:sale - gift)\b/iu.test(name)) return true;
    return false;
  };
  // Only the observed ordinary Steam-key route is classified. Presence is
  // tested without accessing the secret-bearing field's value (even a getter).
  const keyEvidenceInPage = leaf => {
    if(leaf?.type!=='game'||leaf?.drm?.steam!==true)return {};
    const ordinary=leaf.status==='fulfilled'&&(leaf.display_type===undefined||leaf.display_type==='game')
      && ['noKeyDelivery','mystery','mysteryV2','preorder_pending','preorderKeyTime','epic_ska','ubisoft_ska','origin_ska','vaultnKeyless'].every(k=>!leaf[k])
      && (leaf.reveal_template===undefined||leaf.reveal_template==='store')&&leaf.serialExpiry==null;
    return {keyStatus:ordinary&&!Object.hasOwn(leaf,'key')?'unrevealed':'unknown',keyCheckedAt:new Date().toISOString()};
  };
  const keySummaryInPage = origins => {
    const observed=origins.filter(o=>o.keyCheckedAt&&['unrevealed','unknown'].includes(o.keyStatus));
    if(!observed.length)return {};
    const pending=observed.filter(o=>o.keyStatus==='unrevealed'),selected=pending.length?pending:observed;
    return {keyStatus:pending.length?'unrevealed':'unknown',keyCheckedAt:selected.map(o=>o.keyCheckedAt).sort()[0]};
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
    const formats = formatsInPage(leaf), keyEvidence=keyEvidenceInPage(leaf);
    const hasDownloads = (Array.isArray(leaf?.downloads) && leaf.downloads.length > 0)
      || (leaf?.download && typeof leaf.download === 'object')
      || (Array.isArray(leaf?.files) && leaf.files.length > 0)
      || Boolean(leaf?.format || (Array.isArray(leaf?.formats) && leaf.formats.length > 0));
    return {
      source: 'fanatical', sourceItemId, title, ...keyEvidence,
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
        purchaseRef,...keyEvidence,
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
            ...keySummaryInPage([saved,origin]),
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
        purchaseOrigins:[...origins.values()],...keySummaryInPage([...origins.values()])
        ,...(previous?.occurrences||product.occurrences?{occurrences:[...(previous?.occurrences??[]),...(product.occurrences??[])]}:{})
      });
    }
    return [...items.values()].sort((a,b)=>a.sourceItemId.localeCompare(b.sourceItemId));
  };
  if(operation==='project'){
    const completeIds=new Set((Array.isArray(orderSummaries)?orderSummaries:[]).filter(order=>order?.status==='COMPLETE').map(order=>safeIdInPage(order._id)).filter(Boolean)),products=[],seen=new Set(),rejectedList=[];
    for(const order of Array.isArray(orderDetails)?orderDetails:[]){
      const id=safeIdInPage(order?._id);if(!id||seen.has(id)||!completeIds.has(id)||order.status!=='COMPLETE')continue;seen.add(id);const purchaseRef=await fingerprintOrderInPage(id);
      for(const parent of Array.isArray(order.items)?order.items:[]) {
        if (isPromotionalLeaf(parent)) {
          rejectedList.push(recordRejected(parent, parent, order));
          continue;
        }
        for(const group of isDirectPurchasedItem(parent)?[{games:[parent]}]:Array.isArray(parent?.bundles)?parent.bundles:[])for(const leaf of Array.isArray(group?.games)?group.games:[]){
          if (isPromotionalLeaf(leaf)) {
            rejectedList.push(recordRejected(leaf, parent, order));
            continue;
          }
          const product=projectLeafInPage(leaf,parent,order,purchaseRef);
          if(product)products.push(product);
        }
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
  const rejectedList = [];
  const recordRejected = (leaf, parent, order, reason = 'Unclassified promotional or non-product content') => {
    const leafFormats = formatsInPage(leaf);
    const hasDownloads = (Array.isArray(leaf?.downloads) && leaf.downloads.length > 0)
      || (leaf?.download && typeof leaf.download === 'object')
      || (Array.isArray(leaf?.files) && leaf.files.length > 0)
      || Boolean(leaf?.format || (Array.isArray(leaf?.formats) && leaf.formats.length > 0));
    const hasDrm = trueKeysInPage(leaf?.drm).length > 0;
    const hasStreaming = Boolean(leaf?.streaming);
    const delivery = safeTextInPage(leaf?.delivery)
      || (hasStreaming ? 'streaming' : (hasDownloads || leafFormats.length > 0 ? 'direct-download' : (hasDrm ? 'external-key' : undefined)));
    const parentName = safeTextInPage(parent?.name) || safeTextInPage(leaf?.name);
    const parentId = safeIdInPage(parent?._id) || safeIdInPage(leaf?._id);
    return {
      sourceItemId: safeIdInPage(leaf?._id) || `fan_rej_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: safeTextInPage(leaf?.name),
      sourceBundle: parentName,
      bundle: { sourceItemId: parentId, title: parentName, ...(safeTextInPage(parent?.slug ?? leaf?.slug, 300) ? { slug: safeTextInPage(parent?.slug ?? leaf?.slug, 300) } : {}) },
      purchaseDate: safeDateInPage(order?.date),
      reason,
      ...(delivery ? { delivery } : {}),
      ...(hasStreaming ? { streaming: true } : {}),
      ...(leafFormats.length > 0 ? { formats: leafFormats } : {})
    };
  };
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
  // JSON object member order is not purchase evidence. All members and array
  // order still participate; changed statuses, gift metadata or quantities conflict.
  const sameSummary=(a,b,budget={left:10000},depth=0)=>{
    if(--budget.left<0||depth>32)return false;
    if(a===b)return true;
    if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
    if(Array.isArray(a)&&a.length!==b.length)return false;
    const ak=Object.keys(a),bk=Object.keys(b);
    return ak.length===bk.length&&ak.every(key=>Object.hasOwn(b,key)&&sameSummary(a[key],b[key],budget,depth+1));
  };
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
        discoveryComplete=false;note(failure('pagination-order','Repeated purchase identity.'),'listing');if(JSON.stringify(previous)!==JSON.stringify(order)&&!sameSummary(previous,order))conflictingIds.add(order._id);continue;
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
  diagnostic.stage='summaries';
  const listed = new Set();
  const expectedProducts = new Map();
  const sparseSummaries=new Map();
  const parentEvidence=parents=>{
    const names=new Map(),ids=new Map(),direct=new Map(),pickAndMix=new Map(),promotional=new Map(),promotionalIds=new Map(),promotionalDirect=new Map();
    for(const parent of parents){
      const name=safeTextInPage(parent.name);
      if(isPromotionalLeaf(parent)){
        promotional.set(name,(promotional.get(name)??0)+1);
        if(parent._id!==undefined){const key=JSON.stringify([name,parent._id]);promotionalIds.set(key,(promotionalIds.get(key)??0)+1);}
        if(((parent.type==='game'&&(parent.display_type===undefined||parent.display_type==='game'))||(['book','comic','audiobook','software'].includes(parent.type)&&(parent.display_type===undefined||['book','comic','audiobook','software'].includes(parent.display_type))))&&typeof parent._id==='string'&&!!safeIdInPage(parent._id)&&!!name&&Array.isArray(parent.bundles)&&parent.bundles.length===0&&['games','products','items','tiers'].every(key=>!Object.hasOwn(parent,key))){
          const key=JSON.stringify([parent._id,name]);promotionalDirect.set(key,(promotionalDirect.get(key)??0)+1);
        }
        continue;
      }
      names.set(name,(names.get(name)??0)+1);
      if(parent._id!==undefined){const key=JSON.stringify([name,parent._id]);ids.set(key,(ids.get(key)??0)+1);}
      if(isDirectPurchasedItem(parent)){const key=JSON.stringify([parent._id,name]);direct.set(key,(direct.get(key)??0)+1);}
      const pam=safeTextInPage(parent.pickAndMix);if(pam)pickAndMix.set(pam,(pickAndMix.get(pam)??0)+1);
    }
    return {names,ids,direct,pickAndMix,promotional,promotionalIds,promotionalDirect};
  };
  const productCounts = (parents) => {
    const bad=(key,parent,child,reason=key)=>{if(diagnostic.stage==='details')bundleShape(parent,reason,{value:child});issue(diagnostic.stage==='summaries'?key:'detailStructure');throw unreadable();};
    if (!Array.isArray(parents) || !parents.length) bad(parents==null?'missingItems':'invalidItems');
    const counts = new Map();
    for (const parent of parents) {
      if (!safeTextInPage(parent?.name)) bad('missingNames',parent,undefined,'missing-parent-name');
      if (isPromotionalLeaf(parent)) continue;
      if(isDirectPurchasedItem(parent)){const key=JSON.stringify(['direct-game',parent._id,safeTextInPage(parent.name)]);counts.set(key,(counts.get(key)||0)+1);continue;}
      if (!Array.isArray(parent?.bundles) || !parent.bundles.length){if(diagnostic.stage==='summaries')bundleShape(parent);bad(parent?.bundles==null?'missingBundles':'invalidBundles',parent);}
      for (const group of parent.bundles) {
        if (!Array.isArray(group?.games) || !group.games.length) bad(group?.games==null?'missingGames':'invalidGames',parent,group);
        for (const leaf of group.games) {
          if (isPromotionalLeaf(leaf)) continue;
          if (!safeTextInPage(leaf?.name)) bad('missingNames',parent,leaf,'missing-leaf-name');
          const key = JSON.stringify([safeTextInPage(parent.name), safeTextInPage(leaf.name)]);
          counts.set(key, (counts.get(key) || 0) + 1);
        }
      }
    }
    return counts;
  };
  // A sparse summary can locate an authenticated detail request, but is
  // never product evidence or authority to skip that detail on Quick.
  const isSparse=parent=>parent&&typeof parent==='object'&&!Array.isArray(parent)
    &&typeof parent.name==='string'&&!!safeTextInPage(parent.name)
    &&Array.isArray(parent.bundles)&&parent.bundles.length===0
    &&(parent._id===undefined||(typeof parent._id==='string'&&!!safeIdInPage(parent._id)))
    &&['games','products','items','tiers'].every(key=>!Object.hasOwn(parent,key));
  const isPopulated=parent=>parent&&typeof parent==='object'&&!Array.isArray(parent)
    &&typeof parent.name==='string'&&!!safeTextInPage(parent.name)
    &&Array.isArray(parent.bundles)&&parent.bundles.length>0
    &&parent.bundles.every(group=>group&&Array.isArray(group.games)&&group.games.length>0
         &&group.games.every(leaf=>leaf&&typeof leaf.name==='string'&&!!safeTextInPage(leaf.name)));
  const isNamedParent=parent=>parent&&typeof parent==='object'&&!Array.isArray(parent)&&!!safeTextInPage(parent.name);
  // Parents whole-order summary counting accepts.
  const isCountable=parent=>isNamedParent(parent)&&(isPromotionalLeaf(parent)||isDirectPurchasedItem(parent)||isPopulated(parent));
  // A parent-level product catalog may be a selection pool, not a purchase.
  // Such a summary parent never corroborates a detail parent.
  const isCatalogLike=parent=>isNamedParent(parent)&&!isCountable(parent)&&!isSparse(parent)&&['games','products','items','tiers'].some(key=>Object.hasOwn(parent,key));
  // Orders whose summary has an unreadable or unrecognized parent. Readable
  // siblings still locate the detail and corroborate its components.
  const componentSummaries=new Set();
  for (const order of summaries) {
    if (!order || typeof order._id !== 'string' || !safeIdInPage(order._id) || listed.has(order._id)) throw unreadable();
    listed.add(order._id);
    try{
      if(conflictingIds.has(order._id)){issue('summaryConflict');throw unreadable();}
      if(typeof order.status!=='string'||!/^[A-Z][A-Z_]*$/u.test(order.status)){issue('invalidStatus');throw unreadable();}
      if(order.status==='COMPLETE'){
        const sparse=allowPartial&&Array.isArray(order.items)&&order.items.length>0
          &&order.items.some(parent=>isSparse(parent)&&!isDirectPurchasedItem(parent))
          &&order.items.every(parent=>isSparse(parent)||isPopulated(parent));
        if(sparse){
          sparseSummaries.set(order._id,parentEvidence(order.items));
          // Retain independently available product evidence from populated parents.
          const populated=order.items.filter(parent=>isPopulated(parent)||isDirectPurchasedItem(parent));
          expectedProducts.set(order._id,populated.length?productCounts(populated):new Map());
          order.items.filter(parent=>isSparse(parent)&&!isDirectPurchasedItem(parent)).forEach(parent=>bundleShape(parent));
        } else if(allowPartial&&Array.isArray(order.items)&&order.items.some(parent=>isNamedParent(parent)&&!isCatalogLike(parent))&&order.items.some(parent=>!isCountable(parent))){
          // One unrecognized summary parent must not withhold the detail
          // request for its siblings; the detail decides admission. Shape
          // diagnostics name the unrecognized parents, not ordinary sparse ones.
          for(const parent of order.items)if(!isCountable(parent)&&!isSparse(parent))try{productCounts([parent]);}catch(error){if(fatal(error))throw error;}
          componentSummaries.add(order._id);expectedProducts.set(order._id,new Map());
        } else {
          const counts=productCounts(order.items);
          expectedProducts.set(order._id,counts);
          if([...counts.values()].some(n=>n>1))issue('multipleCopies');
        }
      }
      else if(allowPartial){
        if(!['REFUNDED','CANCELLED','CANCELED','PENDING','FAILED'].includes(order.status)){issue('unsupportedStatus');throw unreadable();}
        ineligible.add(await fingerprintOrderInPage(order._id));
      }
    }catch(error){if(!allowPartial||fatal(error))throw error;unresolved.add(await fingerprintOrderInPage(order._id));note(error,'summaries');}
  }
  const complete = summaries.filter(order=>order.status==='COMPLETE'&&expectedProducts.has(order._id));
  // Fingerprints remain the identity used to compare orders and skip known details.
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
  const accountKnown=new Set([...known,...(Array.isArray(accountOrderFingerprints)?accountOrderFingerprints:[]).filter(fp=>typeof fp==='string'&&/^[a-f0-9]{64}$/iu.test(fp)).map(fp=>fp.toLowerCase())].slice(0,100000));
  const accountOverlap=[...accountKnown].some(fp=>listedFingerprints.has(fp));
  if(allowPartial&&accountKnown.size&&listedFingerprints.size&&!accountOverlap)throw failure('account-scope-conflict','The listing does not share saved purchase identity evidence. Confirm or change the account before importing.');
  const historicalOrders=new Set([...known,...(Array.isArray(accountOrderFingerprints)?accountOrderFingerprints:[]).filter(fp=>typeof fp==='string'&&/^[a-f0-9]{64}$/iu.test(fp)).map(fp=>fp.toLowerCase())]);
  if(historicalOrders.size&&[...historicalOrders].some(fp=>!listedFingerprints.has(fp))){
    const error=failure('history-missing-known','Fanatical order history omits previously scanned orders, so complete coverage could not be confirmed. Your library and scan history were not changed.');
    if(!allowPartial)throw error;discoveryComplete=false;note(error,'listing');
  }
  // A bounded batch reads at most detailLimit order details; the rest stay unresolved for a later
  // batch. Within a batched pass, known orders were verified by an earlier batch, so sparse
  // summaries among them are not read again.
  const batched=allowPartial&&Number.isSafeInteger(detailLimit)&&detailLimit>0;
  // Orders that already failed earlier in the same pass are not requested again in it.
  const later=new Set(batched&&Array.isArray(retryLaterOrderFingerprints)?retryLaterOrderFingerprints.filter(fp=>typeof fp==='string'&&/^[a-f0-9]{64}$/u.test(fp)):[]);
  const unread = fullScan ? completeWithFingerprints : completeWithFingerprints.filter(({ order,fingerprint }) => !known.has(fingerprint)||sparseSummaries.has(order._id)&&!batched);
  const candidates = unread.filter(({fingerprint})=>!later.has(fingerprint)),postponed=unread.filter(({fingerprint})=>later.has(fingerprint));
  const toInspect = batched ? candidates.slice(0,detailLimit) : candidates,deferred=batched?candidates.slice(detailLimit).map(({fingerprint})=>fingerprint):[];
  for(const {fingerprint} of postponed)unresolved.add(fingerprint);
  for(const fingerprint of deferred)unresolved.add(fingerprint);
  if(postponed.length+deferred.length)failureCounts.set('details:batch-deferred',{code:'batch-deferred',stage:'details',count:postponed.length+deferred.length});
  const recovery=sparseSummaries.size?{version:1,eligible:sparseSummaries.size,scheduled:toInspect.filter(({order})=>sparseSummaries.has(order._id)).length,recovered:0,unresolved:0,emptyDetailItems:0,detailItemTypes:Object.fromEntries(['missing','null','array','object','string','number','boolean','other'].map(k=>[k,0]))}:null;
  if(recovery)compatibility.summaryRecovery=recovery;
  compatibility.counts.scheduled=toInspect.length;compatibility.counts.knownSkipped=complete.length-unread.length;
  const scope = {fullScan,scanHistoryMissing,total:toInspect.length,skipped:complete.length-unread.length};
  reportProgress({phase:'plan',...scope});
  let completedDetails = 0;
  // Item-level fault isolation. An order is a container of purchase evidence;
  // its authenticated detail (same order ID, COMPLETE) is the ownership
  // evidence. A detail parent is admitted when a summary parent corroborates
  // it: same name and, where the summary states one, the same parent ID (a
  // pick-and-mix selection by its group name). Each product leaf needs its own
  // validated ID. Anything else stays unresolved for retry; nothing is guessed.
  const partialOrders=new Set(),componentScopes=[];
  const componentCategories=['summaryStructure','parentMissing','unexpectedDetailItem','identityMismatch','parentIdentity','parentStructure','childStructure','childIdentity','nestedStructure','productMissing','productUnexpected'];
  const components={version:1,ordersPartiallyResolved:0,ordersResolvedByComponents:0,componentsAdmitted:0,componentsUnresolved:0,componentsRejected:0,unknownStructures:0,bundlesFullyVerified:0,bundlesPartiallyVerified:0,bundlesUnresolved:0,productsAdmittedFromPartialBundles:0,categories:Object.fromEntries(componentCategories.map(key=>[key,0]))};
  const tally=(key,n=1)=>{components[key]=Math.min(100000,components[key]+n);};
  let componentsUsed=false;
  // No container is atomic. A product nested inside another product container
  // is walked to this depth; anything deeper stays unresolved.
  const maxNesting=8;
  const isNestedContainer=leaf=>leaf&&typeof leaf==='object'&&!Array.isArray(leaf)&&Array.isArray(leaf.bundles)&&leaf.bundles.length>0;
  // Collections of product-like entries beside the one a level is read from
  // (a tier list, a product pool) are never read as purchases, and never
  // treated as empty: each one leaves its container incomplete.
  const collectionKeys=['games','bundles','products','items','tiers','children','contents','collections','selections'];
  const unreadCollections=(value,read)=>value&&typeof value==='object'&&!Array.isArray(value)?collectionKeys.filter(key=>!read.includes(key)&&Array.isArray(value[key])&&value[key].some(entry=>entry&&typeof entry==='object'&&(typeof entry._id==='string'||Array.isArray(entry.games)))).length:0;
  const admitComponents=async(order,listedOrder,fingerprint)=>{
    componentsUsed=true;
    // Whole-order verification already recorded detail shapes unless it was skipped.
    const shape=componentSummaries.has(order._id)?bundleShape:()=>{};
    const open=new Map(),rejected=[],pending=[],miss=(category,n=1)=>open.set(category,(open.get(category)??0)+n),scopeBundles=new Map();
    const slots=[];
    for(const parent of Array.isArray(listedOrder.items)?listedOrder.items:[]){
      if(!isNamedParent(parent)){miss('summaryStructure');continue;}
      if(isPromotionalLeaf(parent))continue;
      let leaves=null;
      if(isPopulated(parent)){leaves=new Map();for(const group of parent.bundles)for(const leaf of group.games)if(!isPromotionalLeaf(leaf)){const name=safeTextInPage(leaf.name);leaves.set(name,(leaves.get(name)??0)+1);}}
      slots.push({name:safeTextInPage(parent.name),id:parent._id===undefined?'':typeof parent._id==='string'&&safeIdInPage(parent._id)?parent._id:null,direct:isDirectPurchasedItem(parent),catalog:isCatalogLike(parent),leaves,used:false});
    }
    const isObject=value=>value&&typeof value==='object'&&!Array.isArray(value);
    const parentId=parent=>isObject(parent)&&typeof parent._id==='string'&&safeIdInPage(parent._id)?parent._id:'';
    // A parent is identified by its name, or, when its name is unreadable, by a
    // validated parent ID that the summary states.
    const parents=order.items.map(parent=>({parent,slot:null,named:isNamedParent(parent),valid:isNamedParent(parent)||!!parentId(parent)&&slots.some(s=>s.id===parentId(parent))}));
    // Prefer the same stated ID, then a summary parent without one. A detail
    // parent that omits its ID may take a same-named summary parent that states
    // one: the two do not conflict, and the summary supplies the bundle identity.
    const claim=(name,id,accept=()=>true)=>{
      const slot=(id&&slots.find(s=>!s.used&&s.name===name&&s.id===id&&accept(s)))||slots.find(s=>!s.used&&s.name===name&&s.id===''&&accept(s))||(!id&&slots.find(s=>!s.used&&s.name===name&&s.id&&accept(s)));
      if(slot)slot.used=true;return slot;
    };
    // Ordinary parents first, then pick-and-mix selections by group, then
    // promotional parents, so a gift never takes a purchased parent's place.
    for(const entry of parents){
      if(!entry.valid||isPromotionalLeaf(entry.parent))continue;
      if(entry.named)entry.slot=claim(safeTextInPage(entry.parent.name),parentId(entry.parent));
      else{const slot=slots.find(s=>!s.used&&s.id===parentId(entry.parent));if(slot){slot.used=true;entry.slot=slot;}}
    }
    const groups=new Map();
    for(const entry of parents){
      const group=entry.named&&!entry.slot&&!isPromotionalLeaf(entry.parent)?safeTextInPage(typeof entry.parent.pickAndMix==='string'?entry.parent.pickAndMix:''):'';
      if(!group)continue;
      const unused=slots.find(s=>!s.used&&s.name===group&&!s.direct&&!s.leaves&&!s.catalog);
      if(unused)unused.used=true;
      entry.slot=unused??groups.get(group)??null;
      if(entry.slot)groups.set(group,entry.slot);
    }
    for(const entry of parents){
      if(!entry.valid||!isPromotionalLeaf(entry.parent))continue;
      const name=safeTextInPage(entry.parent.name),id=parentId(entry.parent);
      if(!claim(name,id)&&id){const renamed=slots.find(s=>!s.used&&s.id===id&&!s.direct);if(renamed)renamed.used=true;}
    }
    // Admission order follows whole-order verification, so a fully resolved
    // order keeps the exact occurrence identities of the ordinary path.
    let position=0;
    for(const [pi,{parent,slot,valid}] of parents.entries()){
      if(!valid){miss('parentStructure');tally('unknownStructures');tally('bundlesUnresolved');continue;}
      if(isPromotionalLeaf(parent)){rejected.push(recordRejected(parent,parent,order));continue;}
      const direct=isDirectPurchasedItem(parent);
      // A child's purchase origin needs its parent's validated ID: the detail's
      // own, or the one stated by the summary parent that corroborates it.
      const id=parentId(parent)||slot?.id||'',owner={_id:id,name:safeTextInPage(parent.name)||slot?.name||'',...(typeof parent.slug==='string'?{slug:parent.slug}:{})};
      const children=direct?[{games:[parent]}]:Array.isArray(parent.bundles)&&parent.bundles.length?parent.bundles:null;
      let unresolvedHere=0;const before=pending.length,fail=(category,n=1)=>{miss(category,n);unresolvedHere+=n;};
      if(!slot)fail('unexpectedDetailItem');
      else if(slot.catalog)fail('summaryStructure');
      else if(slot.direct&&(!direct||parentId(parent)!==slot.id))fail('identityMismatch');
      else if(!children){fail('parentStructure');tally('unknownStructures');shape(parent);}
      else if(!id)fail('parentIdentity');
      else{
        const unreadHere=unreadCollections(parent,direct?[]:['bundles']);if(unreadHere){fail('nestedStructure',unreadHere);tally('unknownStructures',unreadHere);}
        // Every group and child is judged on its own evidence; a failure never
        // removes a sibling. A populated summary parent limits its direct children.
        const walk=(groupsOf,depth,path,listed)=>{
          for(const [gi,group] of groupsOf.entries()){
            if(!isObject(group)||!Array.isArray(group.games)||!group.games.length){fail('childStructure');if(depth===0)shape(parent,group?.games==null?'missingGames':'invalidGames',{value:group});continue;}
            const unreadGroup=unreadCollections(group,['games']);if(unreadGroup){fail('nestedStructure',unreadGroup);tally('unknownStructures',unreadGroup);}
            for(const [li,leaf] of group.games.entries()){
              if(isPromotionalLeaf(leaf)){rejected.push(recordRejected(leaf,owner,order));continue;}
              const name=safeTextInPage(leaf?.name);
              if(listed){if(!(listed.get(name)>0)){fail('productUnexpected');continue;}listed.set(name,listed.get(name)-1);}
              if(isNestedContainer(leaf)){
                if(depth+1>=maxNesting){fail('nestedStructure');tally('unknownStructures');continue;}
                const unreadNested=unreadCollections(leaf,['bundles']);if(unreadNested){fail('nestedStructure',unreadNested);tally('unknownStructures',unreadNested);}
                walk(leaf.bundles,depth+1,`${path}${gi}.${li}/`,null);continue;
              }
              // The product itself is admissible; a collection it carries is not read.
              const unreadLeaf=leaf===parent?0:unreadCollections(leaf,[]);if(unreadLeaf){fail('nestedStructure',unreadLeaf);tally('unknownStructures',unreadLeaf);}
              if(!isObject(leaf)||typeof leaf._id!=='string'){fail('childIdentity');continue;}
              const projected=projectLeafInPage(leaf,owner,order,fingerprint);
              if(!projected){fail('childIdentity');continue;}
              pending.push({projected,owner,leaf,index:position++,ref:`${order._id}\u0000component\u0000${pi}\u0000${path}${gi}\u0000${li}\u0000${id}\u0000${leaf._id}`});
            }
          }
        };
        walk(children,0,'',slot.leaves);
        if(slot.leaves)for(const n of slot.leaves.values())if(n>0)fail('productMissing',n);
      }
      const admitted=pending.length-before;
      if(!unresolvedHere)tally('bundlesFullyVerified');
      else if(admitted){tally('bundlesPartiallyVerified');tally('productsAdmittedFromPartialBundles',admitted);}
      else tally('bundlesUnresolved');
      if(unresolvedHere&&id){const scope=scopeBundles.get(id)??{bundle:id,admitted:0,unresolved:0};scope.admitted=Math.min(100000,scope.admitted+admitted);scope.unresolved=Math.min(100000,scope.unresolved+unresolvedHere);scopeBundles.set(id,scope);}
    }
    for(const slot of slots)if(!slot.used)miss('parentMissing');
    const resolved=open.size===0,items=[];
    for(const {projected,owner,leaf,index,ref} of pending){
      // A partial order's occurrences are provisional order/bundle counts: a
      // later complete observation replaces them instead of adding purchases.
      projected.occurrences=[{occurrenceRef:await fingerprintOrderInPage(resolved?`${order._id}\u0000${index}\u0000${owner._id}\u0000${leaf._id}`:ref),...(resolved?{}:{basis:'order-bundle-count'}),orderRef:fingerprint,bundleId:owner._id,bundleTitle:safeTextInPage(owner.name),purchasedAt:safeDateInPage(order.date),...keyEvidenceInPage(leaf)}];
      items.push(projected);
    }
    let total=0;
    for(const [category,n] of open){components.categories[category]=Math.min(100000,components.categories[category]+n);tally('componentsUnresolved',n);total+=n;}
    tally('componentsRejected',rejected.length);
    if(resolved)tally('ordersResolvedByComponents');
    else if(items.length){
      tally('ordersPartiallyResolved');tally('componentsAdmitted',items.length);
      // The order's remaining recovery scope: how much is unresolved, and in
      // which purchased bundles. Fully verified bundles are implied.
      componentScopes.push({order:fingerprint,unresolved:Math.min(100000,total),bundles:[...scopeBundles.values()].sort((a,b)=>a.bundle.localeCompare(b.bundle)).slice(0,1000)});
    }
    return {items,rejected,resolved};
  };
  diagnostic.stage='details';
  activity.pages=diagnostic.pagesParsed;activity.discovered=summaries.length;activity.scheduled=toInspect.length;activityProgress('details',true);
  const details = await boundedMap(toInspect, async ({ order: listedOrder, fingerprint }) => {
    const sparse=sparseSummaries.get(listedOrder._id);
    activity.active++;activityProgress('details',activity.completed===0&&activity.active===Math.min(3,activity.scheduled));
    let detailRead=false,admittedComponents=[];
    try {
    const { data: order } = await request(`/api/user/orders/${encodeURIComponent(listedOrder._id)}`);
    detailRead=true;
    if(sparse){recovery.detailItemTypes[valueType(order?.items)]++;if(Array.isArray(order?.items)&&order.items.length===0)recovery.emptyDetailItems++;}
    if(allowPartial&&typeof order?._id==='string'&&order._id!==listedOrder._id){issue('detailIdentity');throw failure('order-identity-conflict','A purchase response belonged to a different order.');}
    const projectedItems = [];
    if (!order || order._id !== listedOrder._id){issue('detailIdentity');throw unreadable();}
    if(order.status!=='COMPLETE'){issue('detailStatus');throw unreadable();}
    if(!Array.isArray(order.items)||!order.items.length){issue('detailStructure');throw unreadable();}
    // Whole-order verification is the ordinary path and keeps its exact
    // occurrence identities. When it fails, a component failure is isolated
    // below instead of withholding independently verified siblings.
    let isolation=null;const rejectedHere=[];
    try{
    if(componentSummaries.has(order._id))throw unreadable();
    const expected = expectedProducts.get(order._id);
    const actual = productCounts(order.items);
    if(sparse){
      const actualParents=parentEvidence(order.items);
      let mismatchCategory=null,expCount=0,obsCount=0,missingName='';
      // A promotional parent renamed between summary and detail (a revealed gift)
      // stands in only for an otherwise unmatched summary parent carrying the same
      // validated parent ID, one for one, and never for a purchased-product claim.
      const renamedPromotional=new Map(),promotedNames=new Map(),promotedIds=new Map(),promotionalParentIds=new Set();
      for(const parent of order.items)if(isPromotionalLeaf(parent)&&typeof parent._id==='string'&&safeIdInPage(parent._id)){promotionalParentIds.add(parent._id);if(!sparse.names.has(safeTextInPage(parent.name)))renamedPromotional.set(parent._id,(renamedPromotional.get(parent._id)??0)+1);}
      for(const [key,n] of sparse.ids){
        const [name,id]=JSON.parse(key),count=sparse.names.get(name)??0;
        if(typeof id!=='string'||sparse.direct.has(JSON.stringify([id,name]))||(actualParents.pickAndMix.get(name)??0)>=count)continue;
        const nameShort=count-(actualParents.names.get(name)??0)-(actualParents.promotional.get(name)??0)-(promotedNames.get(name)??0);
        const idShort=n-(actualParents.ids.get(key)??0)-(actualParents.promotionalIds.get(key)??0),take=Math.min(nameShort,idShort,renamedPromotional.get(id)??0);
        if(take>0){renamedPromotional.set(id,renamedPromotional.get(id)-take);promotedNames.set(name,(promotedNames.get(name)??0)+take);promotedIds.set(key,take);}
      }
      for(const [name,count] of sparse.names){
        const directCount=actualParents.names.get(name)??0,pamCount=actualParents.pickAndMix.get(name)??0,promoCount=(actualParents.promotional.get(name)??0)+(promotedNames.get(name)??0);
        if(directCount+promoCount<count&&pamCount<count){mismatchCategory='parent-missing';expCount=count;obsCount=directCount+pamCount+promoCount;missingName=name;break;}
      }
      if(!mismatchCategory){
        for(const parent of order.items){
          if(isPromotionalLeaf(parent))continue;
          const name=safeTextInPage(parent.name),pam=safeTextInPage(parent.pickAndMix);
          if(!sparse.names.has(name)&&!(pam&&sparse.names.has(pam))){mismatchCategory='unexpected-detail-item';expCount=0;obsCount=1;break;}
        }
      }
      if(!mismatchCategory){
        for(const [key,n] of sparse.ids){const obs=(actualParents.ids.get(key)??0)+(actualParents.promotionalIds.get(key)??0)+(promotedIds.get(key)??0);if(obs<n){mismatchCategory='id-missing';expCount=n;obsCount=obs;break;}}
      }
      if(!mismatchCategory){
        for(const [key,n] of sparse.direct){const obs=(actualParents.direct.get(key)??0)+(actualParents.promotionalDirect.get(key)??0);if(obs<n){mismatchCategory='direct-missing';expCount=n;obsCount=obs;break;}}
      }
      if(!mismatchCategory){
        for(const [key,n] of expected){const obs=actual.get(key)??0;if(obs<n){mismatchCategory='product-missing';expCount=n;obsCount=obs;break;}}
      }
      if(mismatchCategory){
        let parentContext;
        if(mismatchCategory==='parent-missing'){
          const fold=v=>safeTextInPage(v).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
          const target=fold(missingName);
          let unexpectedDetailParents=0,detailDirectParents=0,detailBundleParents=0,nonStringPickAndMix=0,normalizedNameMatched=false;
          for(const parent of order.items){
            if(Object.hasOwn(parent,'pickAndMix')&&parent.pickAndMix!=null&&typeof parent.pickAndMix!=='string')nonStringPickAndMix++;
            const n=safeTextInPage(parent.name),p=safeTextInPage(parent.pickAndMix),pn=safeTextInPage(parent.pickAndMix?.name);
            if(target&&(fold(n)===target||fold(p)===target||fold(pn)===target))normalizedNameMatched=true;
            if(isPromotionalLeaf(parent))continue;
            if(!sparse.names.has(n)&&!(p&&sparse.names.has(p)))unexpectedDetailParents++;
            if(isDirectPurchasedItem(parent))detailDirectParents++;else detailBundleParents++;
          }
          const sumCounts=map=>Math.min(100000,[...map.values()].reduce((a,b)=>a+b,0));
          const missingIds=[...sparse.ids.keys()].map(key=>JSON.parse(key)).filter(([name,id])=>name===missingName&&typeof id==='string').map(([,id])=>id);
          parentContext={
            summaryParents:sumCounts(sparse.names),
            detailParents:sumCounts(actualParents.names),
            promotionalDetailParents:sumCounts(actualParents.promotional),
            unexpectedDetailParents:Math.min(100000,unexpectedDetailParents),
            detailDirectParents:Math.min(100000,detailDirectParents),
            detailBundleParents:Math.min(100000,detailBundleParents),
            nonStringPickAndMix:Math.min(100000,nonStringPickAndMix),
            // Summary parents classified promotional, and whether a promotional
            // detail parent carries a validated ID: they separate a renamed gift
            // listed without an ID from a purchase the detail omits.
            summaryPromotionalParents:sumCounts(sparse.promotional),
            normalizedNameMatched,
            missingParentHasId:missingIds.length>0,
            promotionalIdMatched:missingIds.some(id=>promotionalParentIds.has(id)),
            promotionalParentHasId:promotionalParentIds.size>0
          };
        }
        recordMismatch(mismatchCategory,expCount,obsCount,parentContext);
        issue('detailProductMismatch');throw unreadable();
      }
    }else if (actual.size !== expected.size || [...expected].some(([key, quantity]) => actual.get(key) !== quantity)){
      if(actual.size!==expected.size){recordMismatch('product-count',expected.size,actual.size);}
      else{const missing=[...expected].find(([key,quantity])=>(actual.get(key)??0)<quantity);recordMismatch('product-missing',missing?missing[1]:1,missing?(actual.get(missing[0])??0):0);}
      issue('detailProductMismatch');throw unreadable();
    }
    let occurrence=0;
    for (const parent of order.items) {
      if (isPromotionalLeaf(parent)) {
        rejectedHere.push(recordRejected(parent, parent, order));
        continue;
      }
      if (!parent || typeof parent._id !== 'string' || !safeIdInPage(parent._id) || !safeTextInPage(parent.name) || !Array.isArray(parent.bundles) || (!parent.bundles.length&&!isDirectPurchasedItem(parent))) throw unreadable();
      if (unreadCollections(parent,isDirectPurchasedItem(parent)?[]:['bundles'])){issue('detailStructure');throw unreadable();}
      for (const group of isDirectPurchasedItem(parent)?[{games:[parent]}]:parent.bundles) {
        if (!group || !Array.isArray(group.games) || !group.games.length) throw unreadable();
        if (unreadCollections(group,['games'])){issue('detailStructure');throw unreadable();}
        for (const leaf of group.games) {
          if (isPromotionalLeaf(leaf)) {
            rejectedHere.push(recordRejected(leaf, parent, order));
            continue;
          }
          // A product that is itself a container is walked by component admission.
          if (isNestedContainer(leaf)||leaf!==parent&&unreadCollections(leaf,[])){issue('detailStructure');throw unreadable();}
          if (typeof leaf?._id !== 'string'){issue('detailProductIdentity');throw unreadable();}
          const projected = projectLeafInPage(leaf, parent, order, fingerprint);
          if (!projected){issue('detailProjection');throw unreadable();}
          projected.occurrences=[{occurrenceRef:await fingerprintOrderInPage(`${order._id}\u0000${occurrence++}\u0000${parent._id}\u0000${leaf._id}`),orderRef:fingerprint,bundleId:parent._id,bundleTitle:safeTextInPage(parent.name),purchasedAt:safeDateInPage(order.date),...keyEvidenceInPage(leaf)}];
          projectedItems.push(projected);
        }
      }
    }
    }catch(error){if(!allowPartial||fatal(error))throw error;isolation=error;}
    if(isolation){
      projectedItems.length=0;
      const admitted=await admitComponents(order,listedOrder,fingerprint);
      rejectedList.push(...admitted.rejected);
      if(!admitted.resolved){admittedComponents=admitted.items;throw isolation;}
      projectedItems.push(...admitted.items);
    }else{rejectedList.push(...rejectedHere);tally('bundlesFullyVerified',order.items.filter(parent=>!isPromotionalLeaf(parent)).length);}
    reportProgress({phase:'details',...scope,completed:++completedDetails});
    diagnostic.detailsParsed=completedDetails;verified.add(fingerprint);
    if(sparse)recovery.recovered++;
    activity.validatedItems+=projectedItems.length;
    return projectedItems;
    }catch(error){if(sparse)recovery.unresolved++;if(!detailRead)issue('detailRequest');activity.failed++;if(!allowPartial||fatal(error))throw error;unresolved.add(fingerprint);note(error,'details');if(admittedComponents.length){partialOrders.add(fingerprint);activity.validatedItems+=admittedComponents.length;}return admittedComponents;}
    finally{activity.active--;activity.completed++;activityProgress('details',activity.completed===activity.scheduled);}
  });
  activityProgress('validating',true);
  const items = combineProducts(details.flat());
  let currentToken='';try{currentToken=String(JSON.parse(localStorage.getItem('bsauth')||'{}')?.token||'');}catch{}
  diagnostic.stage='session';
  if(currentToken!==token)throw failure('session-changed','The signed-in Fanatical session changed during this scan. Start a fresh scan.');
  // `token`, summaries, details, and raw leaves remain in this execution world.
  if(componentsUsed){
    const bounded=n=>Math.min(100000,Math.max(0,n));
    const {version,...counts}=components;
    compatibility.components={version,ordersFullyResolved:bounded(verified.size),...counts,ordersUnresolved:bounded(unresolved.size-partialOrders.size-deferred.length-postponed.length)};
  }
  const outcome=!discoveryComplete?'partial-discovery':unresolved.size?'partial-extraction':'complete';
  const finished=outcome==='complete'||outcome==='partial-discovery'&&diagnostic.paginationEvidence==='array-only'&&diagnostic.pagesParsed===visitedPages.size&&!unresolved.size&&!unidentifiedRecords&&failureCounts.size===1&&[...failureCounts.values()][0].code==='discovery-unverified';
  // FAN alone requests private navigation metadata. A saved purchase can recover
  // its link from an eligible listing without a second detail request.
  const navigationRefs = progressFormat === 'fan' && allowPartial && Array.isArray(orderNavigationRefs)
    ? new Set(orderNavigationRefs.slice(0,100000)) : null;
  if (navigationRefs) for (const item of items) for (const origin of item.purchaseOrigins) {
    if (verified.has(origin.purchaseRef)||partialOrders.has(origin.purchaseRef)) navigationRefs.add(origin.purchaseRef);
  }
  return {
    ...(navigationRefs ? {orderNavigation:completeWithFingerprints
      .filter(({fingerprint})=>navigationRefs.has(fingerprint)&&(!unresolved.has(fingerprint)||partialOrders.has(fingerprint)))
      .map(({order,fingerprint})=>[fingerprint,order._id])} : {}),
    acquisitionContract:{version:1,provider:'fanatical',acquisition:{outcome:finished?'finished':'interrupted'},verified:[...verified].sort(),unresolved:[...unresolved].sort(),ineligible:[...ineligible].sort(),coverage:{status:outcome==='complete'?'verified':finished?'unverified':'incomplete',evidence:[diagnostic.paginationEvidence]},scope:{authority:accountOverlap?'saved-order-match':'declared-scope'},retry:[...unresolved].sort(),persistence:{outcome:'not-attempted'},reconciliation:{authority:'none'}},
    ...(allowPartial?{partialScanVersion:1,outcome,...(batched?{deferredOrderFingerprints:[...deferred].sort()}:{}),verifiedOrderFingerprints:[...verified],unresolvedOrderFingerprints:[...unresolved],...(partialOrders.size?{partialOrderFingerprints:[...partialOrders].sort(),componentScopes:componentScopes.sort((a,b)=>a.order.localeCompare(b.order))}:{}),ineligibleOrderFingerprints:[...ineligible],observedOrderFingerprints:[...listedFingerprints],failures:[...failureCounts.values()],unidentifiedRecords}:{}),
    schemaVersion: 1,
    coverage: { complete: allowPartial?outcome==='complete':true,...(allowPartial?{listingEvidence,compatibility,discoveryComplete,pagesParsed:diagnostic.pagesParsed,accountAffinity:accountOverlap?'saved-order-match':'declared-scope'}:{}), listedOrders: summaries.length, validatedOrders: allowPartial?verified.size:details.length, emptyAccount: summaries.length === 0,
      pagesFetched: visitedPages.size, expectedTotal, paginationEvidence: ranged ? 'range' : expectedTotal !== null ? 'count' : linked ? 'link' : 'array-only', retries, concurrency },
    ordersScanned: allowPartial?verified.size:toInspect.length,
    ordersAvailable: complete.length,
    orderFingerprints: completeWithFingerprints.map(({ fingerprint }) => fingerprint).filter(fp=>!unresolved.has(fp)),
    items,
    ...(rejectedList.length ? { rejectedPurchaseItems: rejectedList } : {})
  };
  } catch (error) {
    if(!returnFailure)throw error;
    // No message, stack, URL, token, order or product data crosses this path.
    return {fanaticalImportFailure:1,code:error?.fanaticalFailureCode??'page-exception',diagnostic};
  }
}
