/* Pure browser helpers shared by the page overlay and extension pages. */
(function attachFanaticalLibrary(global) {
  'use strict';

  const ROMAN = new Map([['i', '1'], ['ii', '2'], ['iii', '3'], ['iv', '4'], ['v', '5'], ['vi', '6'], ['vii', '7'], ['viii', '8'], ['ix', '9'], ['x', '10']]);
  const FORMAT_WORDS = /\b(?:pdf|cbz|cbr|epub|mobi|kindle|digital\s+edition|soundtrack)\b/giu;
  const EDITION_WORDS = /\b(?:\d+(?:st|nd|rd|th)|first|second|third|revised|updated|expanded|deluxe|gold|complete|ultimate|collector'?s?)\s*(?:edition|ed\.?|version)?\b/giu;

  function normalizeTitle(value) {
    let result = String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/gu, '')
      .toLowerCase().replace(/&/gu, ' and ').replace(FORMAT_WORDS, ' ')
      .replace(/\bvolume\b|\bvol\.?\b/giu, ' vol ').replace(/[’'`]/gu, '')
      .replace(/[^a-z0-9]+/gu, ' ').trim();
    result = result.replace(/\b(i|ii|iii|iv|v|vi|vii|viii|ix|x)\b/gu, (word) => ROMAN.get(word) ?? word);
    return result.replace(/\s+/gu, ' ');
  }

  function titleKey(value) {
    return normalizeTitle(value).replace(/\b(?:the|a|an)\b/gu, ' ').replace(/\s+/gu, ' ').trim();
  }

  function mediaType(value) {
    const type = String(value ?? '').toLowerCase();
    if (type.includes('comic') || type === 'book') return 'book';
    if (type.includes('audio') && type.includes('book')) return 'audiobook';
    if (type.includes('audio')) return 'audio';
    if (type.includes('software') || type.includes('asset')) return 'software';
    if (type.includes('learn') || type.includes('course')) return 'elearning';
    return type === 'game' ? 'game' : 'other';
  }

  function compatibleMedia(a, b) {
    return mediaType(a) === mediaType(b);
  }

  function trueKeys(value) {
    if (!value || typeof value !== 'object') return [];
    return Object.entries(value).filter(([, enabled]) => enabled === true).map(([name]) => name).sort();
  }

  function externalIds(item) {
    const steam = item?.externalIds?.steamAppId ?? item?.steam?.id;
    const isbn = item?.externalIds?.isbn ?? item?.isbn;
    return {
      ...(steam !== undefined && steam !== null && String(steam) !== '' ? { steamAppId: String(steam) } : {}),
      ...(isbn ? { isbn: String(isbn).replace(/[^0-9X]/giu, '') } : {})
    };
  }

  function editionBase(value) {
    return titleKey(value).replace(EDITION_WORDS, ' ').replace(/\s+/gu, ' ').trim();
  }

  function gamePackageIdentity(title) {
    const key = String(title ?? '').normalize('NFKD').toLowerCase().replace(/[’']/gu, '').replace(/[^a-z0-9]+/gu, ' ').trim();
    const qualifiers = new Set();
    for (const match of key.matchAll(/\b(deluxe|gold|complete|ultimate|definitive|premium|collectors?|goty|enhanced|anniversary|remaster(?:ed)?|soundtrack|dlc|expansion|pack|package|bundle|collection|upgrade)\b/gu)) qualifiers.add(match[1].replace(/^collector$/u, 'collectors').replace(/^remaster$/u, 'remastered'));
    if (/\bgame of the year\b/u.test(key)) qualifiers.add('goty');
    if (/\bseason pass\b/u.test(key)) qualifiers.add('season pass');
    if (/\bbonus content\b/u.test(key)) qualifiers.add('bonus content');
    if (/\bdirectors? cut\b/u.test(key)) qualifiers.add('directors cut');
    for (const match of key.matchAll(/\b([a-z0-9]+) edition\b/gu)) {
      const name = match[1].replace(/^collector$/u, 'collectors').replace(/^remaster$/u, 'remastered');
      if (!['standard', 'base', 'digital'].includes(name) && !(name === 'year' && qualifiers.has('goty')) && !(name === 'cut' && qualifiers.has('directors cut')) && !(name === 'pass' && qualifiers.has('season pass'))) qualifiers.add(name);
    }
    return [...qualifiers].sort().join('|');
  }

  function differentGamePackage(candidate, owned) {
    return mediaType(candidate?.mediaType ?? candidate?.type) === 'game'
      && mediaType(owned?.mediaType ?? owned?.type) === 'game'
      && gamePackageIdentity(candidate?.title) !== gamePackageIdentity(owned?.title);
  }

  function packageRelationship(candidate, owned, evidence = 'Related game') {
    return { state: 'possible', provenance: 'fanatical', item: owned, editionDifference: true,
      reason: `${evidence}: owned "${owned.title}"; offered "${candidate.title}". Different edition/package; included extras are not verified.` };
  }

  // Only explicitly supplied component metadata is used. Never infer DLC
  // ownership from a parent/base App ID or from marketing text.
  function componentMetadata(raw, fallbackMedia = 'game', depth = 0) {
    if (raw == null || (Array.isArray(raw) && !raw.length)) return {};
    if (!Array.isArray(raw) || depth >= 4) return { componentCoverageUnknown: true };
    let incomplete = false;
    const components = [];
    if (raw.length > 2000) return { componentCoverageUnknown: true };
    for (const entry of raw) {
      const title = typeof (entry?.title ?? entry?.name) === 'string' ? (entry.title ?? entry.name).trim().slice(0, 500) : '';
      if (!title) { incomplete = true; continue; }
      components.push({ sourceItemId: String(entry.sourceItemId ?? entry._id ?? ''), title,
        mediaType: mediaType(entry.mediaType ?? entry.display_type ?? entry.type ?? fallbackMedia), externalIds: externalIds(entry),
        ...bibliographicFields(entry), ...contentsMetadata(entry),
        ...componentMetadata(entry.components, fallbackMedia, depth + 1) });
    }
    return { components, ...(incomplete ? { componentCoverageUnknown: true } : {}) };
  }

  function validIsbn(value) {
    const isbn = String(value ?? '').replace(/[^0-9X]/giu, '').toUpperCase();
    if (/^\d{9}[\dX]$/u.test(isbn)) {
      if ([...isbn].reduce((sum, digit, index) => sum + (digit === 'X' ? 10 : Number(digit)) * (10 - index), 0) % 11) return '';
      const base = `978${isbn.slice(0, 9)}`;
      return base + ((10 - [...base].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0) % 10) % 10);
    }
    return /^97[89]\d{10}$/u.test(isbn) && [...isbn].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0) % 10 === 0 ? isbn : '';
  }

  // Only catalog identity leaves survive. No raw metadata, purchase IDs or URLs.
  function bibliographicFields(raw) {
    const result = {};
    for (const name of ['language', 'edition', 'series', 'run', 'volume', 'issue', 'publisher']) {
      if (typeof raw?.[name] === 'string' && raw[name].trim()) result[name] = raw[name].trim().slice(0, 500);
    }
    const authors = Array.isArray(raw?.authors) ? raw.authors : typeof raw?.author === 'string' ? [raw.author] : [];
    const names = [...new Set(authors.filter(value => typeof value === 'string').map(value => value.trim().slice(0, 500)).filter(Boolean))].slice(0, 50);
    if (names.length) result.authors = names;
    return result;
  }

  function scopeKey(value) {
    return String(value ?? '').normalize('NFKC').toLowerCase().replace(/&/gu, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/gu, ' ');
  }
  function numberKey(value) {
    const text = String(value ?? '').trim();
    const fraction = /^(\d+)\/(\d+)$/u.exec(text);
    if (fraction && Number(fraction[2])) return String(Number(fraction[1]) / Number(fraction[2]));
    return /^\d+(?:\.\d+)?$/u.test(text) ? String(Number(text)) : scopeKey(text);
  }
  function contentKey(entry) {
    return JSON.stringify([scopeKey(entry.series), scopeKey(entry.run), entry.unitType, numberKey(entry.number), scopeKey(entry.language)]);
  }
  function contentsMetadata(raw) {
    if (raw?.contents === undefined) return {};
    if (!Array.isArray(raw.contents) || raw.contents.length > 2000) return { contentsCoverageUnknown: true };
    let incomplete = false;
    const contents = [];
    for (const entry of raw.contents) {
      if (!entry || typeof entry.series !== 'string' || !entry.series.trim()
        || !['issue', 'volume', 'annual', 'special', 'component'].includes(entry.unitType)
        || typeof entry.number !== 'string' || !entry.number.trim()
        || !['full', 'excerpt'].includes(entry.completeness)
        || ['issue', 'volume', 'annual'].includes(entry.unitType) && (!/^\d+(?:\.\d+|\/\d+)?$/u.test(entry.number.trim()) || /\/0+$/u.test(entry.number.trim()))) { incomplete = true; continue; }
      const unit = { series: entry.series.trim().slice(0, 500), run: typeof entry.run === 'string' ? entry.run.trim().slice(0, 500) : '',
        unitType: entry.unitType, number: numberKey(entry.number).slice(0, 500), language: typeof entry.language === 'string' ? entry.language.trim().slice(0, 500) : '', completeness: entry.completeness };
      if (unit.number) contents.push(unit); else incomplete = true;
    }
    return { contents: [...new Map(contents.map(entry => [contentKey(entry) + ':' + entry.completeness, entry])).values()],
      contentsComplete: raw.contentsComplete === true && !incomplete,
      ...(incomplete ? { contentsCoverageUnknown: true } : {}) };
  }

  function plainProduct(raw) {
    if (!raw?._id || typeof raw.name !== 'string' || !raw.name.trim()) return null;
    return { sourceItemId: String(raw._id), title: raw.name.trim().slice(0, 500), slug: typeof raw.slug === 'string' ? raw.slug.trim() : '',
      mediaType: mediaType(raw.display_type ?? raw.type), externalIds: externalIds(raw), drm: trueKeys(raw.drm), platforms: trueKeys(raw.platforms ?? raw.os),
      ...bibliographicFields(raw), ...contentsMetadata(raw), ...componentMetadata(raw.components, raw.display_type ?? raw.type),
      componentsComplete: raw.componentsComplete === true,
      availability: { soldOut: raw.soldOut === true, lowStock: raw.low_stock === true, regionAvailable: raw.regionAvailable !== false, storeVisible: raw.storeVisible !== false } };
  }
  function parseBundle(raw, routeKind = 'standard') {
    if (!raw || !raw._id || typeof raw.name !== 'string' || !raw.name.trim()) throw new Error('Fanatical bundle response is missing its identity.');
    const pickMix = routeKind === 'pick-mix' || Array.isArray(raw.products) && Array.isArray(raw.tiers);
    const groups = pickMix ? [] : (Array.isArray(raw.bundles) ? raw.bundles : []).map((group, index) => ({ index, price: group?.price ?? null, products: (Array.isArray(group?.games) ? group.games : []).map(plainProduct).filter(Boolean) }));
    const products = pickMix ? (Array.isArray(raw.products) ? raw.products : []).map(plainProduct).filter(Boolean) : groups.flatMap(group => group.products);
    const tiers = pickMix ? (Array.isArray(raw.tiers) ? raw.tiers : []).map(tier => ({ id: String(tier?._id ?? ''), quantity: Number(tier?.quantity ?? 0), price: tier?.price ?? {} })).filter(tier => tier.quantity > 0) : groups.map(group => ({ id: String(group.index), price: group.price }));
    const bundle = { sourceItemId: String(raw._id), title: raw.name.trim(), slug: typeof raw.slug === 'string' ? raw.slug.trim() : '' };
    return { kind: pickMix ? 'pick-mix' : 'standard', ...bundle, bundle, products, groups, tiers, order: pickMix && Array.isArray(raw.ordering) ? raw.ordering.map(String) : [] };
  }

  function makeIndexes(items) {
    const byId = new Map(); const bySteam = new Map(); const byIsbn = new Map(); const byTitle = new Map();
    for (const item of items ?? []) {
      if (!item || !item.sourceItemId) continue;
      byId.set(String(item.sourceItemId), item);
      const ids = externalIds(item);
      if (ids.steamAppId) bySteam.set(ids.steamAppId, [...(bySteam.get(ids.steamAppId) ?? []), item]);
      if (ids.isbn) byIsbn.set(ids.isbn, item);
      const key = `${mediaType(item.mediaType ?? item.type)}:${titleKey(item.title)}`;
      if (item.title) byTitle.set(key, [...(byTitle.get(key) ?? []), item]);
    }
    return { byId, bySteam, byIsbn, byTitle };
  }

  function relationshipMatch(item, library) {
    const candidateBase = editionBase(item.title);
    if (!candidateBase) return null;
    for (const owned of library) {
      if (!compatibleMedia(item.mediaType ?? item.type, owned.mediaType ?? owned.type)) continue;
      const ownedBase = editionBase(owned.title);
      if (ownedBase !== candidateBase) continue;
      const differs = titleKey(item.title) !== titleKey(owned.title);
      if (differs) return { item: owned, reason: /\b(?:edition|deluxe|gold|complete|ultimate|revised|updated)\b/iu.test(`${item.title} ${owned.title}`) ? 'edition relationship' : 'qualified title relationship' };
    }
    return null;
  }

  function classify(item, libraryItems, ancestors = new Set(), componentProof = false) {
    if (ancestors.has(item)) return { state: 'possible', provenance: null, reason: 'Component coverage could not be verified.' };
    const visited = new Set(ancestors); visited.add(item);
    const library = Array.isArray(libraryItems) ? libraryItems : [];
    const indexes = makeIndexes(library);
    const id = String(item?.sourceItemId ?? item?._id ?? '');
    if (id && indexes.byId.has(id)) return { state: 'owned', provenance: 'fanatical', item: indexes.byId.get(id), reason: 'exact Fanatical product ID' };
    const ids = externalIds(item);
    const media = mediaType(item?.mediaType ?? item?.type);
    const steamMatches = (indexes.bySteam.get(ids.steamAppId) ?? []).filter((owned) => compatibleMedia(media, owned.mediaType ?? owned.type));
    const steamDifference = steamMatches.find((owned) => differentGamePackage(item, owned));
    const components = Array.isArray(item?.components) ? item.components : [];
    const uniqueComponents = [...new Map(components.map((component) => [component?.sourceItemId || `${mediaType(component?.mediaType)}:${titleKey(component?.title)}`, component])).values()];
    if (uniqueComponents.length) {
      const componentMatches = uniqueComponents.map((component) => classify(component, library, visited, true));
      const owned = componentMatches.filter((match) => match.state === 'owned').length;
      if (owned === uniqueComponents.length && !item.componentCoverageUnknown) return { state: 'owned', provenance: 'fanatical', reason: 'all enumerable components owned' };
      if (owned) {
        const evidence = steamDifference ?? componentMatches.find((match) => match.state === 'owned' && match.item)?.item;
        return { state: item.componentCoverageUnknown ? 'possible' : 'partial', provenance: 'fanatical', owned, total: uniqueComponents.length,
          reason: 'some enumerable components owned', ...(media === 'game' && evidence ? { item: evidence, editionDifference: true,
            reason: `Verified ${owned}/${uniqueComponents.length} listed components; owned "${evidence.title}"; offered "${item.title}". Full package coverage is not verified.${item.componentCoverageUnknown ? ' Additional component metadata is unreadable.' : ''}` } : {}) };
      }
    }
    const hasComponents = uniqueComponents.length > 0 || item?.componentCoverageUnknown === true;
    const titleMatches = indexes.byTitle.get(`${media}:${titleKey(item?.title)}`) ?? [];
    const exact = titleMatches.find((owned) => !differentGamePackage(item, owned));
    if (exact && !hasComponents) return { state: 'owned', provenance: 'fanatical', item: exact, reason: 'exact normalized title' };
    const steam = steamMatches.find((owned) => !differentGamePackage(item, owned));
    const steamProvesProduct = steam && !hasComponents && !componentProof && (media !== 'game' || !gamePackageIdentity(item?.title));
    if (steamProvesProduct) return { state: 'owned', provenance: 'fanatical', item: steam, reason: 'exact Steam App ID' };
    const isbn = ids.isbn && indexes.byIsbn.get(ids.isbn);
    if (isbn && compatibleMedia(media, isbn.mediaType ?? isbn.type)) return { state: 'owned', provenance: 'fanatical', item: isbn, reason: 'exact ISBN' };
    if (steamDifference) return packageRelationship(item, steamDifference, 'Shared Steam App ID identifies the base game only');
    const titleDifference = titleMatches.find((owned) => differentGamePackage(item, owned));
    if (titleDifference) return packageRelationship(item, titleDifference, 'Normalized title hides a package difference');
    if (hasComponents && (steam || exact)) return packageRelationship(item, steam || exact, 'Package component coverage is unknown');
    if (steam) return packageRelationship(item, steam, 'Shared Steam App ID does not verify this product/component');
    const relation = relationshipMatch(item ?? {}, library);
    if (relation) return media === 'game' ? packageRelationship(item, relation.item, relation.reason) : { state: 'possible', provenance: 'fanatical', item: relation.item, reason: relation.reason };
    return { state: 'new', provenance: null };
  }

  function galacticOwnershipReview(result) {
    return (Array.isArray(result?.matches) ? result.matches : []).find((match) => match?.ownership && match.ownership !== 'owned' && match.ownership !== 'claimed');
  }

  function galacticPossible(result) {
    return (Array.isArray(result?.possibleMatches) ? result.possibleMatches : []).find((match) => match?.ownership === 'owned' || match?.ownership === 'claimed');
  }

  function mergeGalactic(local, result, product) {
    // Exact local ownership is always authoritative; external data never turns
    // a Fanatical item into a claim about Fanatical ownership.
    if (local?.state === 'owned' || local?.state === 'partial') return local;
    const ownedMatches = (Array.isArray(result?.matches) ? result.matches : []).filter((match) => match?.ownership === 'owned' || match?.ownership === 'claimed');
    const differs = (match) => product && match?.title && differentGamePackage(product, { ...match, mediaType: product.mediaType ?? product.type });
    const exact = ownedMatches.find((match) => !differs(match) && !(local?.editionDifference && !match?.title));
    if (exact) return { state: 'owned-elsewhere', provenance: exact.provider, reason: 'exact Galactic Library match' };
    if (local?.state === 'possible') return local;
    const editionMatch = ownedMatches.find(differs);
    if (editionMatch) return { ...packageRelationship(product, editionMatch, 'Galactic Library game relationship'), provenance: editionMatch.provider };
    const review = galacticOwnershipReview(result);
    if (review) return { state: 'possible', provenance: review.provider, ownershipReview: true, reason: `exact Galactic Library match with ${review.ownership} ownership status` };
    const possible = galacticPossible(result);
    if (possible && differs(possible)) return { ...packageRelationship(product, possible, 'Galactic Library edition relationship'), provenance: possible.provider };
    return possible ? { state: 'possible', provenance: possible.provider, reason: 'possible Galactic Library relationship' } : (local ?? { state: 'new', provenance: null });
  }

  function galacticRequestItems(products) {
    const supported = new Set(['game', 'book', 'audiobook']);
    return (Array.isArray(products) ? products : []).filter((product) => product?.sourceItemId && typeof product?.title === 'string' && supported.has(mediaType(product.mediaType))).map((product) => ({ requestId: String(product.sourceItemId), title: product.title.trim().slice(0, 500), mediaType: mediaType(product.mediaType) })).filter((product) => product.title);
  }

  function overlayLabel(match) {
    if (match?.state === 'owned') return 'Owned';
    if (match?.state === 'owned-elsewhere') {
      const provider = String(match.provenance ?? 'another library');
      return `Owned elsewhere — ${provider === 'gog' ? 'GOG' : provider.replace(/^./u, (letter) => letter.toUpperCase())}`;
    }
    if (match?.state === 'partial') return `Partial (${match.owned}/${match.total})`;
    return match?.state === 'possible' ? (match.ownershipReview ? 'Check ownership' : 'Possible') : 'New';
  }

  function upsertBadge(card, productId, match, badgeHost = card) {
    if (!card || !badgeHost || !productId || !global.document?.createElement) return null;
    // Fanatical's SPA can recycle a card node for a different product. Any
    // previous extension badge on that node is therefore stale, regardless
    // of its old product ID.
    for (const node of card.querySelectorAll?.('[data-fanatical-library-for]') ?? []) node.remove();
    const badge = global.document.createElement('span');
    badge.dataset.fanaticalLibraryFor = productId;
    const state = match?.state ?? 'new';
    const statusClasses = ['owned', 'owned-elsewhere', 'partial', 'possible', 'new'];
    for (const node of [card, ...(card.querySelectorAll?.('.fanatical-library-badge-host') ?? [])]) {
      for (const name of statusClasses) node.classList?.remove(`fanatical-library-card-${name}`, `fanatical-library-${name}-item`);
      node.classList?.remove('fanatical-library-badge-host');
      if (node !== card) { delete node.dataset?.fanaticalLibraryBadge; node.removeAttribute?.('title'); }
    }
    card.classList?.add(`fanatical-library-card-${state}`, `fanatical-library-${state}-item`);
    badgeHost.classList?.add('fanatical-library-badge-host');
    if (card.dataset) card.dataset.fanaticalLibraryBadge = state === 'owned-elsewhere' ? 'Owned elsewhere' : state === 'partial' ? `${match.owned}/${match.total} Owned` : overlayLabel(match);
    card.title = match?.reason ? `Fanatical Library: ${overlayLabel(match)} — ${match.reason}` : `Fanatical Library: ${overlayLabel(match)}`;
    badge.className = `fanatical-library-${state}-badge`;
    badge.textContent = overlayLabel(match);
    badge.setAttribute?.('aria-label', `Fanatical Library: ${badge.textContent}`);
    badgeHost.append(badge);
    return badge;
  }

  function isExtensionId(value) {
    const id = String(value ?? '').trim();
    return /^[a-p]{32}$/u.test(id) || /^[a-z0-9](?:[a-z0-9._+-]*[a-z0-9])?@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/iu.test(id);
  }

  function standardTierCoverage(parsed, matches) {
    const confirmedNewIds = new Set(parsed.products.filter((_product, index) => matches[index]?.state === 'new').map((product) => product.sourceItemId));
    const priceFor = (group) => {
      const value = group.price?.USD;
      if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) return null;
      const price = Number(value);
      return Number.isFinite(price) && price >= 0 ? price : null;
    };
    const ordered = parsed.groups.map((group) => ({ group, price: priceFor(group) }))
      .sort((left, right) => (left.price ?? Infinity) - (right.price ?? Infinity));
    const coveredIds = new Set();
    const coveredNewIds = new Set();
    let recommendedPrice = null;
    const tiers = ordered.map(({ group, price }) => {
      for (const product of group.products) {
        coveredIds.add(product.sourceItemId);
        if (confirmedNewIds.has(product.sourceItemId)) coveredNewIds.add(product.sourceItemId);
      }
      // Tiers are cumulative. Stop at the cheapest priced tier covering the
      // complete confirmed-new set, not the last tier with any new products.
      if (recommendedPrice === null && price !== null && confirmedNewIds.size > 0 && coveredNewIds.size === confirmedNewIds.size) recommendedPrice = price;
      return { group, price, total: coveredIds.size, confirmedNew: coveredNewIds.size };
    });
    return { tiers, recommendedPrice };
  }

  function catalogueOffer(href, origin = 'https://www.fanatical.com') {
    let url;
    try { url = new URL(href, origin); } catch { return null; }
    if (url.origin !== origin) return null;
    const match = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(bundle|pick-and-mix)\/([a-z0-9-]+)\/?$/iu.exec(url.pathname);
    if (!match || (match[1] === 'bundle' && ['all', 'games', 'books', 'other', 'mystery'].includes(match[2].toLowerCase()))) return null;
    return { kind: match[1] === 'pick-and-mix' ? 'pick-mix' : 'standard', slug: match[2].toLowerCase() };
  }

  function cataloguePageKind(pathname) {
    const match = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?bundle(?:\/(all|games|books|other|mystery))?\/?$/iu.exec(String(pathname ?? ''));
    return match ? (match[1]?.toLowerCase() ?? 'main') : null;
  }

  function purchasedBundleSlugs(items) {
    const bundles = new Map();
    for (const item of Array.isArray(items) ? items : []) {
      const bundle = item?.bundle;
      const slug = String(bundle?.slug ?? '').trim().toLowerCase();
      if (!/^[a-z0-9-]+$/u.test(slug) || !bundle?.sourceItemId || item?.source !== 'fanatical') continue;
      if (!bundles.has(slug)) bundles.set(slug, { sourceItemId: String(bundle.sourceItemId), title: String(bundle.title ?? ''), purchaseDate: item.purchaseDate ?? null });
    }
    return bundles;
  }

  function catalogueDaysLeft(value) {
    const text = String(value ?? '').replace(/\s+/gu, ' ').trim().toLowerCase();
    const days = /\b(\d+)\s*days?\s*left\b/u.exec(text);
    if (days) return Number(days[1]);
    const clock = /\b(?:(\d+)\s*d\s*:\s*)?(\d{1,2})\s*h\s*:\s*(\d{2})\s*m(?:\s*:\s*(\d{2})\s*s)?\b/u.exec(text);
    if (clock) {
      const [, dayPart, hourPart, minutePart, secondPart] = clock;
      return Number(dayPart ?? 0) + Number(hourPart) / 24 + Number(minutePart) / 1440 + Number(secondPart ?? 0) / 86400;
    }
    const hours = /\b(\d+)\s*hours?\s*left\b/u.exec(text);
    return hours ? Number(hours[1]) / 24 : null;
  }

  global.FanaticalLibrary = { normalizeTitle, titleKey, mediaType, compatibleMedia, trueKeys, externalIds, componentMetadata, validIsbn, bibliographicFields, scopeKey, numberKey, contentKey, contentsMetadata, plainProduct, parseBundle, classify, mergeGalactic, galacticRequestItems, overlayLabel, upsertBadge, isExtensionId, standardTierCoverage, catalogueOffer, cataloguePageKind, purchasedBundleSlugs, catalogueDaysLeft };
}(globalThis));
