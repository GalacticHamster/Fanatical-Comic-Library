/* Pure browser helpers shared by the page overlay and extension pages. */
(function attachFanaticalLibrary(global) {
  'use strict';

  const ROMAN = new Map([['i', '1'], ['ii', '2'], ['iii', '3'], ['iv', '4'], ['v', '5'], ['vi', '6'], ['vii', '7'], ['viii', '8'], ['ix', '9'], ['x', '10']]);
  const FORMAT_WORDS = /\b(?:pdf|cbz|cbr|epub|mobi)\b/giu;
  const indexCache = new WeakMap();

  function normalizeTitle(value) {
    let result = String(value ?? '').normalize('NFKC')
      .toLowerCase().replace(/&/gu, ' and ').replace(FORMAT_WORDS, ' ')
      .replace(/\bvolume\b|\bvol\.?\b/giu, ' vol ').replace(/[’'`]/gu, '')
      .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim();
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
      ...(validIsbn(isbn) ? { isbn: validIsbn(isbn) } : {})
    };
  }

  function editionBase(value) {
    return normalizeTitle(value).replace(/\s+(?:(?:base(?: game)?|standard|digital deluxe|deluxe|gold|platinum|complete|ultimate|definitive|premium|collectors?|anniversary|remastered|enhanced|goty|game of the year)(?: edition)?|(?:\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|revised|updated|expanded|annotated|new)(?:\s+(?:revised|updated))?\s+(?:edition|ed)|soundtrack|dlc|expansion|season pass|bonus content|complete pack|ultimate collection|collection|trilogy)$/iu, '').trim();
  }

  function gamePackageIdentity(title) {
    const key = scopeKey(title);
    const qualifiers = new Set();
    for (const match of key.matchAll(/\b(deluxe|gold|platinum|complete|ultimate|definitive|premium|collectors?|goty|enhanced|anniversary|remaster(?:ed)?|soundtrack|dlc|expansion|pack|package|bundle|collection|upgrade)\b/gu)) qualifiers.add(match[1].replace(/^collector$/u, 'collectors').replace(/^remaster$/u, 'remastered'));
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
        ...bibliographicFields(entry), ...contentsMetadata(entry), componentsComplete: entry.componentsComplete === true,
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
    const excerptKeys = new Set(contents.filter(entry => entry.completeness === 'excerpt').map(contentKey));
    if (contents.some(entry => entry.completeness === 'full' && excerptKeys.has(contentKey(entry)))) incomplete = true;
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
    if (indexCache.has(items)) return indexCache.get(items);
    const byId = new Map(); const bySteam = new Map(); const byIsbn = new Map(); const byTitle = new Map(); const byBase = new Map();
    for (const item of items ?? []) {
      if (!item) continue;
      if (item.sourceItemId) byId.set(String(item.sourceItemId), item);
      const ids = externalIds(item);
      if (ids.steamAppId) bySteam.set(ids.steamAppId, [...(bySteam.get(ids.steamAppId) ?? []), item]);
      if (ids.isbn) byIsbn.set(ids.isbn, [...(byIsbn.get(ids.isbn) ?? []), item]);
      const key = `${mediaType(item.mediaType ?? item.type)}:${titleKey(item.title)}`;
      if (item.title) byTitle.set(key, [...(byTitle.get(key) ?? []), item]);
      const base = `${mediaType(item.mediaType ?? item.type)}:${editionBase(item.title)}`;
      if (item.title) byBase.set(base, [...(byBase.get(base) ?? []), item]);
    }
    const index = { byId, bySteam, byIsbn, byTitle, byBase };
    indexCache.set(items, index);
    return index;
  }

  function identityConflicts(candidate, owned, edition = false) {
    const left = bibliographicFields(candidate); const right = bibliographicFields(owned.evidence ? { ...owned.evidence, title: owned.title } : owned);
    const reasons = [];
    if (left.authors?.length && right.authors?.length && !left.authors.some(author => right.authors.map(scopeKey).includes(scopeKey(author)))) reasons.push('Different known authors');
    for (const field of ['series', 'run', 'issue', 'volume', ...(edition ? ['edition', 'language'] : [])]) {
      if (left[field] && right[field] && scopeKey(left[field]) !== scopeKey(right[field])) reasons.push(`Different ${field}`);
    }
    if (edition) {
      const l = externalIds(candidate).isbn; const r = externalIds(owned).isbn || validIsbn(owned.evidence?.isbn?.[0]);
      if (l && r && l !== r) reasons.push('Different validated ISBNs');
      if (editionBase(candidate.title) === editionBase(owned.title) && normalizeTitle(candidate.title) !== normalizeTitle(owned.title)
        && (mediaType(candidate.mediaType) !== 'game' || gamePackageIdentity(candidate.title) !== gamePackageIdentity(owned.title))) reasons.push('Different edition/package wording');
    }
    return reasons;
  }

  function relationshipMatch(item, library) {
    const candidateBase = editionBase(item.title);
    if (!candidateBase) return null;
    for (const owned of makeIndexes(library).byBase.get(`${mediaType(item.mediaType ?? item.type)}:${candidateBase}`) ?? []) {
      if (!compatibleMedia(item.mediaType ?? item.type, owned.mediaType ?? owned.type)) continue;
      const ownedBase = editionBase(owned.title);
      if (ownedBase !== candidateBase) continue;
      if (identityConflicts(item, owned).length) continue;
      const differs = titleKey(item.title) !== titleKey(owned.title);
      if (differs) return { item: owned, reason: `Owned "${owned.title}"; offered "${item.title}". Related edition/package; ${identityConflicts(item, owned, true).join('; ') || 'edition identity needs review'}.` };
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
      if (owned === uniqueComponents.length && !item.componentCoverageUnknown && item.componentsComplete === true) return { state: 'owned', provenance: 'fanatical', reason: 'all enumerable components owned' };
      if (owned) {
        const evidence = steamDifference ?? componentMatches.find((match) => match.state === 'owned' && match.item)?.item;
        return { state: item.componentCoverageUnknown ? 'possible' : 'partial', provenance: 'fanatical', owned, total: uniqueComponents.length,
          reason: 'some enumerable components owned', ...(media === 'game' && evidence ? { item: evidence, editionDifference: true,
            reason: `Verified ${owned}/${uniqueComponents.length} listed components; owned "${evidence.title}"; offered "${item.title}". Full package coverage is not verified.${item.componentCoverageUnknown ? ' Additional component metadata is unreadable.' : ''}` } : {}) };
      }
    }
    const hasComponents = uniqueComponents.length > 0 || item?.componentCoverageUnknown === true;
    const titleMatches = indexes.byTitle.get(`${media}:${titleKey(item?.title)}`) ?? [];
    const compatibleTitles = titleMatches.filter(owned => !identityConflicts(item, owned).length);
    const literal = value => String(value ?? '').normalize('NFKC').trim().toLowerCase();
    const exact = compatibleTitles.find((owned) => !differentGamePackage(item, owned) && !identityConflicts(item, owned, true).length
      && (media === 'game' && normalizeTitle(item.title) === normalizeTitle(owned.title)
        || compatibleTitles.length === 1 && literal(item.title) === literal(owned.title)
        || normalizeTitle(item.title) === normalizeTitle(owned.title) && bibliographicFields(item).authors?.some(author => bibliographicFields(owned).authors?.map(scopeKey).includes(scopeKey(author)))));
    if (exact && !hasComponents) return { state: 'owned', provenance: 'fanatical', item: exact, reason: 'exact normalized title' };
    const steam = steamMatches.find((owned) => !differentGamePackage(item, owned));
    const steamProvesProduct = steam && !hasComponents && !componentProof && !identityConflicts(item, steam, true).length && (media !== 'game' || !gamePackageIdentity(item?.title));
    if (steamProvesProduct) return { state: 'owned', provenance: 'fanatical', item: steam, reason: 'exact Steam App ID' };
    const isbn = ids.isbn && (indexes.byIsbn.get(ids.isbn) ?? []).find(owned => !identityConflicts(item, owned, true).length);
    if (isbn && compatibleMedia(media, isbn.mediaType ?? isbn.type)) return { state: 'owned', provenance: 'fanatical', item: isbn, reason: 'exact ISBN' };
    if (steamDifference) return packageRelationship(item, steamDifference, 'Shared Steam App ID identifies the base game only');
    const titleDifference = titleMatches.find((owned) => differentGamePackage(item, owned));
    if (titleDifference) return packageRelationship(item, titleDifference, 'Normalized title hides a package difference');
    if (hasComponents && (steam || exact)) return packageRelationship(item, steam || exact, 'Package component coverage is unknown');
    if (steam) return packageRelationship(item, steam, 'Shared Steam App ID does not verify this product/component');
    if (compatibleTitles.length) return { state: 'possible', provenance: 'fanatical', item: compatibleTitles[0], reason: `Owned "${compatibleTitles[0].title}"; offered "${item.title}". ${identityConflicts(item, compatibleTitles[0], true).join('; ') || 'Normalized title needs edition/author evidence'}.` };
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

  function legacyMergeGalactic(local, result, product) {
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

  function offerContents(item) {
    const explicit = contentsMetadata(item);
    if (explicit.contents?.length || explicit.contentsCoverageUnknown) return { entries: explicit.contents ?? [], complete: explicit.contentsComplete === true, uncertain: explicit.contentsCoverageUnknown === true, source: 'Explicit catalog contents' };
    // Title ranges are comparison targets, never an owned collection assertion.
    const match = /^(.*?)\s+(?:\(([^)]+)\)\s*)?(?:(vol(?:ume)?s?\.?|issues?)\s*|#)(\d+(?:\.\d+|\/\d+)?)(?:\s*[-–]\s*(\d+))?\s*$/iu.exec(String(item?.title ?? ''));
    if (!match || !match[1].trim()) return { entries: [], complete: false, uncertain: false };
    const series = item.series || match[1].trim(); const run = item.run || match[2] || ''; const language = item.language || '';
    const first = numberKey(match[4]); const last = match[5] ? Number(match[5]) : null;
    if (last !== null && (!Number.isInteger(Number(first)) || last < Number(first) || last - Number(first) >= 2000)) return { entries: [], complete: false, uncertain: true };
    const numbers = last === null ? [first] : Array.from({ length: last - Number(first) + 1 }, (_, index) => String(Number(first) + index));
    return { entries: numbers.map(number => ({ series, run, language, unitType: /^vol/iu.test(match[3] || '') ? 'volume' : 'issue', number, completeness: 'full' })), complete: false, uncertain: false, source: 'Title-derived comparison targets' };
  }

  const permanent = record => ['owned', 'claimed'].includes(record?.ownership);
  function localContents(items) {
    const entries = [];
    for (const item of items) {
      const target = offerContents(item);
      if (target.uncertain || /\b(?:sample|excerpt|preview)\b/iu.test(item.title)) continue;
      // Explicit metadata or a single purchased issue/volume supplies evidence.
      if (!item.contents?.length && target.entries.length !== 1) continue;
      const conflicts = new Set(target.entries.filter(entry => entry.completeness === 'excerpt').map(contentKey));
      for (const entry of target.entries) if (entry.completeness === 'full' && !conflicts.has(contentKey(entry))) entries.push({ ...entry, evidence: [{ provider: 'fanatical', ownership: 'owned', title: item.title, relationship: 'contains', item,
        reason: target.source, evidence: { source: 'Fanatical purchase metadata', checkedAt: item.purchaseDate || null } }] });
    }
    return entries;
  }
  function coverageFor(target, local, result) {
    const unitToken = entry => JSON.stringify([scopeKey(entry.series), entry.unitType, numberKey(entry.number)]);
    const index = new Map();
    for (const entry of [...local, ...(result?.coverage?.covered ?? []), ...(result?.coverage?.possibleCovered ?? []).map(entry => ({ ...entry, uncertain: true }))]) {
      const id = unitToken(entry); const rows = index.get(id) ?? []; rows.push(entry); index.set(id, rows);
    }
    const units = [...new Map(target.entries.filter(entry => entry.completeness === 'full').map(entry => [contentKey(entry), entry])).values()];
    const covered = []; const missing = []; const possibleCovered = [];
    for (const entry of units) {
      const confirmed = []; const possible = [];
      for (const candidate of index.get(unitToken(entry)) ?? []) {
        if (candidate.completeness !== 'full') continue;
        if (entry.run && candidate.run && scopeKey(entry.run) !== scopeKey(candidate.run) || entry.language && candidate.language && scopeKey(entry.language) !== scopeKey(candidate.language)) continue;
        const evidence = (candidate.evidence ?? []).filter(record => permanent(record) && (record.provider !== 'fanatical' || record.item));
        if (!candidate.uncertain && entry.run && entry.language && candidate.run && candidate.language && contentKey(entry) === contentKey(candidate)) confirmed.push(...evidence);
        else possible.push(...evidence);
      }
      if (confirmed.length) covered.push({ ...entry, evidence: confirmed });
      else { missing.push(entry); if (possible.length) possibleCovered.push({ ...entry, evidence: possible }); }
    }
    const scopeUncertain = target.uncertain || units.some(entry => !entry.run || !entry.language) || possibleCovered.length > 0;
    return { total: units.length, owned: covered.length, complete: units.length > 0 && units.length === covered.length && !scopeUncertain,
      contentsComplete: target.complete, scopeUncertain, covered, possibleCovered, missing };
  }

  function mergeGalactic(local, result, product, coverage = null) {
    if (!product) return legacyMergeGalactic(local, result, product);
    const records = (result?.matches ?? []).filter(record => record.provider !== 'fanatical');
    const exact = records.find(record => permanent(record) && !(local.editionDifference && !record.title) && record.relationship !== 'same-work' && record.relationship !== 'contains'
      && !identityConflicts(product, record, true).length && !differentGamePackage(product, { ...record, mediaType: product.mediaType }));
    let match = local;
    if (local.state !== 'owned') {
      if (exact) match = { state: 'owned-elsewhere', provenance: exact.provider, item: exact, reason: exact.reason || 'exact Galactic Library match' };
      else if (coverage?.owned) {
        const external = coverage.covered.flatMap(entry => entry.evidence).find(record => record.provider !== 'fanatical');
        match = { state: coverage.complete && coverage.contentsComplete ? (external ? 'owned-elsewhere' : 'owned') : 'partial',
          provenance: external?.provider || 'fanatical', owned: coverage.owned, total: coverage.total, reason: 'Verified full contents across owned collections' };
      }
      else if (local.state === 'new') {
        const possible = [...records, ...(result?.possibleMatches ?? [])].find(record => record.provider !== 'fanatical');
        if (possible) match = { state: 'possible', provenance: possible.provider, item: possible, ownershipReview: !permanent(possible),
          reason: `Library item "${possible.title || 'Unnamed record'}": ${possible.reason || possible.relationship || 'Related edition needs review'}${!permanent(possible) ? `; ${possible.ownership || 'unknown'} ownership` : ''}.`, editionDifference: true };
        else if (coverage?.possibleCovered.length) match = { state: 'possible', provenance: coverage.possibleCovered[0]?.evidence[0]?.provider, reason: 'Potential contents coverage needs run/language confirmation' };
      }
    }
    return { ...match, offered: product, localMatch: local, externalResult: result, coverage };
  }
  function galacticRequestItems(products) {
    const supported = new Set(['game', 'book', 'audiobook']);
    return (Array.isArray(products) ? products : []).filter((product) => product?.sourceItemId && typeof product?.title === 'string' && supported.has(mediaType(product.mediaType))).map((product) => {
      const data = bibliographicFields(product); delete data.publisher;
      const isbn = externalIds(product).isbn; const target = offerContents(product);
      return { requestId: String(product.sourceItemId).slice(0, 500), title: product.title.trim().slice(0, 500), mediaType: mediaType(product.mediaType), excludeProviders: ['fanatical'], ...data,
        ...(isbn ? { identifiers: { isbn } } : {}), ...(target.entries.length ? { contents: target.entries, contentsComplete: target.complete } : {}) };
    }).filter(product => product.title);
  }

  function galacticBatches(requests) {
    const batches = []; let batch = []; let units = 0;
    for (const item of requests) {
      const size = item.contents?.length || 0;
      if (size > 2000) throw new Error('Too many contents targets');
      if (batch.length === 500 || units + size > 20000) { batches.push(batch); batch = []; units = 0; }
      batch.push(item); units += size;
    }
    if (batch.length) batches.push(batch);
    return batches;
  }
  function flattenProducts(products) {
    const rows = []; const seen = new Set();
    const visit = (item, depth) => { if (!item || seen.has(item) || depth > 4) return; seen.add(item); rows.push(item); for (const component of item.components ?? []) visit(component, depth + 1); };
    for (const item of products) visit(item, 0);
    return rows;
  }
  function resolveProduct(product, library, localUnits, lookup, depth = 0) {
    const local = classify(product, library);
    const result = lookup(product);
    const target = offerContents(product);
    const coverage = target.entries.length ? coverageFor(target, localUnits, result) : null;
    const resolved = mergeGalactic(local, result, product, coverage);
    if (depth > 4 || ['owned', 'owned-elsewhere'].includes(resolved.state) || !product.components?.length) return resolved;
    const components = [...new Map(product.components.map(item => [item.sourceItemId || `${item.mediaType}:${normalizeTitle(item.title)}`, item])).values()];
    const matches = components.map(item => resolveProduct(item, library, localUnits, lookup, depth + 1));
    const owned = matches.filter(match => ['owned', 'owned-elsewhere'].includes(match.state)).length;
    resolved.componentMatches = matches;
    if (owned) {
      resolved.state = owned === components.length && product.componentsComplete === true && !product.componentCoverageUnknown ? 'owned-elsewhere' : 'partial';
      resolved.owned = owned; resolved.total = components.length;
      resolved.reason = `Verified ${owned}/${components.length} listed components${product.componentsComplete === true ? '' : '; full package contents are not established'}.`;
      if (resolved.item?.title) resolved.reason += ` owned "${resolved.item.title}"; offered "${product.title}".`;
    } else if (matches.some(match => match.state === 'possible') && resolved.state === 'new') {
      resolved.state = 'possible'; resolved.reason = 'Related library items for listed components need review.';
    }
    return resolved;
  }
  async function queryGalacticItems(requests, send, timeoutMs = 3500) {
    const results = new Map(); const failed = new Set();
    for (const batch of galacticBatches(requests)) {
      let timeout;
      try {
        const response = await Promise.race([send({ type: 'MATCH_ITEMS', apiVersion: 1, items: batch }), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('timeout')), timeoutMs); })]);
        if (!response?.ok || response.apiVersion !== 1 || !Array.isArray(response.results)) throw new Error('Unsuccessful companion lookup');
        for (const request of batch) {
          const rows = response.results.filter(result => result?.requestId === request.requestId);
          if (rows.length !== 1 || !Array.isArray(rows[0].matches)) failed.add(request.requestId);
          else results.set(request.requestId, rows[0]);
        }
      } catch { batch.forEach(request => failed.add(request.requestId)); }
      finally { clearTimeout(timeout); }
    }
    return { results, failed };
  }

  function overlayLabel(match) {
    if (match?.state === 'unchecked') return 'Not checked';
    if (match?.state === 'owned') return 'Owned';
    if (match?.state === 'owned-elsewhere') {
      const provider = String(match.provenance ?? 'another library');
      return `Owned elsewhere — ${provider === 'gog' ? 'GOG' : provider.replace(/^./u, (letter) => letter.toUpperCase())}`;
    }
    if (match?.state === 'partial') return `Partial (${match.owned}/${match.total})`;
    return match?.state === 'possible' ? (match.ownershipReview ? 'Check ownership' : 'Possible') : 'New';
  }

  function upsertBadge(card, productId, match, badgeHost = card, onInspect = null) {
    if (!card || !badgeHost || !productId || !global.document?.createElement) return null;
    // Fanatical's SPA can recycle a card node for a different product. Any
    // previous extension badge on that node is therefore stale, regardless
    // of its old product ID.
    for (const node of card.querySelectorAll?.('[data-fanatical-library-for]') ?? []) node.remove();
    const badge = global.document.createElement('button');
    badge.type = 'button';
    if (onInspect) {
      badge.addEventListener?.('click', event => { event.preventDefault(); event.stopPropagation(); onInspect(); });
      badge.addEventListener?.('keydown', event => { if (['Enter', ' '].includes(event.key)) event.stopPropagation(); });
    }
    badge.dataset.fanaticalLibraryFor = productId;
    const state = match?.state ?? 'new';
    const statusClasses = ['owned', 'owned-elsewhere', 'partial', 'possible', 'new', 'unchecked'];
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

  function unitLabel(entry) {
    return `${entry.series}${entry.run ? ` (${entry.run})` : ''} ${entry.unitType} ${entry.number}${entry.language ? ` [${entry.language}]` : ''}`;
  }
  function explanationLines(match, lastImport = null) {
    const offered = match.offered || {};
    const lines = [`Offered: ${offered.title || 'Unknown title'}`, `Status: ${overlayLabel(match)}`, `Basis: ${match.reason || 'Not found in checked libraries'}`];
    const describe = (label, item) => {
      const data = bibliographicFields(item);
      const isbn = externalIds(item).isbn || (Array.isArray(item?.isbn) ? item.isbn.map(validIsbn).filter(Boolean).join(', ') : validIsbn(item?.isbn));
      if (isbn) data.isbn = isbn;
      const fields = Object.entries(data).map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : value}`);
      lines.push(`${label}: ${fields.join(' · ') || 'No bibliographic identity supplied'}`);
    };
    describe('Offered evidence', offered);
    if (match.lookupIncomplete) lines.push('Central lookup incomplete. An unavailable or omitted result is not proof of absence.');
    lines.push(`Fanatical last successful import: ${lastImport || 'unknown'}. Synced libraries may not cover the entire purchase history.`);
    if (match.localMatch?.reason && match.localMatch.reason !== match.reason) lines.push(`Local comparison: ${match.localMatch.reason}`);
    const records = [match.item, match.localMatch?.item, ...(match.externalResult?.matches || []), ...(match.externalResult?.possibleMatches || []), ...(match.externalResult?.partialMatches || []),
      ...(match.coverage?.covered || []).flatMap(entry => entry.evidence || []), ...(match.coverage?.possibleCovered || []).flatMap(entry => entry.evidence || [])].filter(Boolean);
    const seen = new Set();
    for (const record of records) {
      const item = record.item || record; const provider = record.provider || 'fanatical';
      const key = `${provider}:${record.itemRef || item.sourceItemId || item.title}`;
      if (seen.has(key)) continue; seen.add(key);
      lines.push(`Library item: ${item.title || 'Unnamed record'} · ${provider} · ${record.ownership || 'purchased locally'}`);
      describe('Library evidence', record.evidence ? record.evidence : item);
      const conflicts = identityConflicts(offered, record.evidence ? { ...record.evidence, title: item.title } : item, true);
      if (conflicts.length) lines.push(`Differences: ${conflicts.join('; ')}`);
      lines.push(`Relationship: ${record.relationship || 'local product/edition comparison'} · ${record.reason || match.localMatch?.reason || 'Local purchase assertion'}`);
      if (typeof record.confidence === 'number' && Number.isFinite(record.confidence)) lines.push(`Confidence rule score: ${record.confidence}; this is not a calibrated probability.`);
      lines.push(`Source: ${record.evidence?.source || 'Fanatical purchase import'} · observed ${record.evidence?.checkedAt || 'unknown'} · contents verified ${record.verifiedAt || 'unknown'}`);
      if (item.purchaseDate) lines.push(`Purchase date: ${item.purchaseDate}`);
      if (item.bundle?.title) lines.push(`Purchased bundle: ${item.bundle.title}`);
    }
    if (match.coverage?.total) {
      lines.push(`Contents: ${match.coverage.owned}/${match.coverage.total} full units covered.`);
      lines.push(match.coverage.contentsComplete ? 'Explicit contents describe the full offered content; this does not identify the physical/digital edition.' : 'Comparison targets do not establish the whole edition or its extras.');
      if (match.coverage.scopeUncertain) lines.push('Run/language or contents scope needs confirmation.');
      for (const [label, entries] of [['Covered', match.coverage.covered], ['Possible coverage', match.coverage.possibleCovered], ['Not confirmed covered', match.coverage.missing]]) {
        if (entries.length) lines.push(`${label}: ${entries.slice(0, 100).map(unitLabel).join('; ')}${entries.length > 100 ? `; ${entries.length - 100} more` : ''}`);
      }
    }
    for (const component of match.componentMatches || []) lines.push(`Component: ${component.offered?.title || 'Unknown'} · ${overlayLabel(component)} · ${component.reason || 'No matching evidence'}`);
    return lines;
  }

  function centralReviewUrl(id) {
    return /^[a-p]{32}$/u.test(String(id || '')) ? `chrome://extensions/?options=${id}` : null;
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

  global.FanaticalLibrary = { normalizeTitle, titleKey, mediaType, compatibleMedia, trueKeys, externalIds, componentMetadata, validIsbn, bibliographicFields, scopeKey, numberKey, contentKey, contentsMetadata, plainProduct, parseBundle, classify, identityConflicts, offerContents, localContents, coverageFor, mergeGalactic, galacticRequestItems, galacticBatches, queryGalacticItems, flattenProducts, resolveProduct, overlayLabel, upsertBadge, unitLabel, explanationLines, centralReviewUrl, isExtensionId, standardTierCoverage, catalogueOffer, cataloguePageKind, purchasedBundleSlugs, catalogueDaysLeft };
}(globalThis));
