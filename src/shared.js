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

  function makeIndexes(items) {
    const byId = new Map(); const bySteam = new Map(); const byIsbn = new Map(); const byTitle = new Map();
    for (const item of items ?? []) {
      if (!item || !item.sourceItemId) continue;
      byId.set(String(item.sourceItemId), item);
      const ids = externalIds(item);
      if (ids.steamAppId) bySteam.set(ids.steamAppId, item);
      if (ids.isbn) byIsbn.set(ids.isbn, item);
      const key = `${mediaType(item.mediaType ?? item.type)}:${titleKey(item.title)}`;
      if (item.title) byTitle.set(key, item);
    }
    return { byId, bySteam, byIsbn, byTitle };
  }

  function relationshipMatch(item, library) {
    const candidateBase = editionBase(item.title);
    if (!candidateBase || candidateBase.split(' ').length < 2) return null;
    for (const owned of library) {
      if (!compatibleMedia(item.mediaType ?? item.type, owned.mediaType ?? owned.type)) continue;
      const ownedBase = editionBase(owned.title);
      if (ownedBase !== candidateBase) continue;
      const differs = titleKey(item.title) !== titleKey(owned.title);
      if (differs) return { item: owned, reason: /\b(?:edition|deluxe|gold|complete|ultimate|revised|updated)\b/iu.test(`${item.title} ${owned.title}`) ? 'edition relationship' : 'qualified title relationship' };
    }
    return null;
  }

  function classify(item, libraryItems) {
    const library = Array.isArray(libraryItems) ? libraryItems : [];
    const indexes = makeIndexes(library);
    const id = String(item?.sourceItemId ?? item?._id ?? '');
    if (id && indexes.byId.has(id)) return { state: 'owned', provenance: 'fanatical', item: indexes.byId.get(id), reason: 'exact Fanatical product ID' };
    const ids = externalIds(item);
    const media = mediaType(item?.mediaType ?? item?.type);
    const steam = ids.steamAppId && indexes.bySteam.get(ids.steamAppId);
    if (steam && compatibleMedia(media, steam.mediaType ?? steam.type)) return { state: 'owned', provenance: 'fanatical', item: steam, reason: 'exact Steam App ID' };
    const isbn = ids.isbn && indexes.byIsbn.get(ids.isbn);
    if (isbn && compatibleMedia(media, isbn.mediaType ?? isbn.type)) return { state: 'owned', provenance: 'fanatical', item: isbn, reason: 'exact ISBN' };
    const exact = indexes.byTitle.get(`${media}:${titleKey(item?.title)}`);
    if (exact) return { state: 'owned', provenance: 'fanatical', item: exact, reason: 'exact normalized title' };
    const components = Array.isArray(item?.components) ? item.components : [];
    if (components.length) {
      const owned = components.filter((component) => classify({ ...component, components: [] }, library).state === 'owned').length;
      if (owned === components.length) return { state: 'owned', provenance: 'fanatical', reason: 'all enumerable components owned' };
      if (owned) return { state: 'partial', provenance: 'fanatical', owned, total: components.length, reason: 'some enumerable components owned' };
    }
    const relation = relationshipMatch(item ?? {}, library);
    if (relation) return { state: 'possible', provenance: 'fanatical', item: relation.item, reason: relation.reason };
    return { state: 'new', provenance: null };
  }

  function galacticOwned(result) {
    return (Array.isArray(result?.matches) ? result.matches : []).find((match) => match?.ownership === 'owned' || match?.ownership === 'claimed');
  }

  function galacticOwnershipReview(result) {
    return (Array.isArray(result?.matches) ? result.matches : []).find((match) => match?.ownership && match.ownership !== 'owned' && match.ownership !== 'claimed');
  }

  function galacticPossible(result) {
    return (Array.isArray(result?.possibleMatches) ? result.possibleMatches : []).find((match) => match?.ownership === 'owned' || match?.ownership === 'claimed');
  }

  function mergeGalactic(local, result) {
    // Exact local ownership is always authoritative; external data never turns
    // a Fanatical item into a claim about Fanatical ownership.
    if (local?.state === 'owned' || local?.state === 'partial') return local;
    const exact = galacticOwned(result);
    if (exact) return { state: 'owned-elsewhere', provenance: exact.provider, reason: 'exact Galactic Library match' };
    if (local?.state === 'possible') return local;
    const review = galacticOwnershipReview(result);
    if (review) return { state: 'possible', provenance: review.provider, ownershipReview: true, reason: `exact Galactic Library match with ${review.ownership} ownership status` };
    const possible = galacticPossible(result);
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

  global.FanaticalLibrary = { normalizeTitle, titleKey, mediaType, compatibleMedia, trueKeys, externalIds, classify, mergeGalactic, galacticRequestItems, overlayLabel, upsertBadge, isExtensionId, catalogueOffer, cataloguePageKind, purchasedBundleSlugs, catalogueDaysLeft };
}(globalThis));
