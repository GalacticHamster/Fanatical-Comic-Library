// BEGIN SHARED MATCHING POLICY
(function installLibraryMatchingPolicy(global) {
  'use strict';
  const roman = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
  function presentationTitle(value, kind = 'book') {
    let title = String(value ?? '').normalize('NFKC').toLowerCase().trim();
    if (kind === 'book') {
      const format = /\s+(?:[\[(]\s*)?(?:pdf|cbz|cbr|epub|mobi|kindle|tp|tpb|hc|hardcover|paperback|trade paperback|digital edition)(?:\s*[\])])?\s*$/iu;
      while (format.test(title)) title = title.replace(format, '').trim();
    }
    return title.replace(/&/gu, ' and ').replace(/\bvolume\b|\bvol\.?\b/giu, ' vol ')
      .replace(/['\u2018\u2019\u0060]/gu, '')
      .replace(/\d+(?:[.\-\u2013\u2014]\d+)+|[^\p{L}\p{N}\p{M}+#/]+/gu,
        part => /^\d/u.test(part) ? part.replace(/[\u2013\u2014]/gu, '-') : ' ')
      .replace(/\b(vol|issue)\s+(i|ii|iii|iv|v|vi|vii|viii|ix|x)\b/gu, (_match, unit, number) => unit + ' ' + roman[number])
      .replace(/\s+/gu, ' ').trim();
  }
  function ownershipTitleKeys(title, kind = 'book') {
    const keys = [presentationTitle(title, kind)];
    if (kind === 'book' && /\s*\(plus extra content\)\s*$/iu.test(title)) {
      keys.push(presentationTitle(String(title).replace(/\s*\(plus extra content\)\s*$/iu, ''), kind));
    }
    return [...new Set(keys.filter(Boolean))];
  }
  function fullTitleMatches(offered, stored, kind = 'book') {
    const key = presentationTitle(offered, kind);
    return Boolean(key && ownershipTitleKeys(stored, kind).includes(key));
  }
  function relatedPresentationReason(left, right, kind = 'book') {
    const a = presentationTitle(left, kind), b = presentationTitle(right, kind);
    if (!a || !b || a === b) return '';
    const articles = value => value.replace(/\b(?:the|a|an)\b/gu, ' ').replace(/\s+/gu, ' ').trim();
    if (articles(a) && articles(a) === articles(b)) return 'The titles differ by an article; compare the library title.';
    const accents = value => value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').normalize('NFC');
    if (accents(a) === accents(b)) return 'The titles differ in accents; identity needs review.';
    const numbering = value => value.replace(/(?<=\d)[.\-/](?=\d)/gu, ' ');
    if (numbering(a) === numbering(b)) return 'Numbering punctuation differs; review the library item.';
    const numerals = value => value.replace(/\b(i|ii|iii|iv|v|vi|vii|viii|ix|x)\b/gu, word => roman[word]);
    if (numerals(a) === numerals(b)) return 'The titles differ in general Roman numeral wording; identity needs review.';
    return '';
  }
  function relatedTitleKeys(value, kind = 'book') {
    const title = presentationTitle(value, kind);
    return [...new Set([
      title.replace(/\b(?:the|a|an)\b/gu, ' ').replace(/\s+/gu, ' ').trim(),
      title.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').normalize('NFC'),
      title.replace(/(?<=\d)[.\-/](?=\d)/gu, ' '),
      title.replace(/\b(i|ii|iii|iv|v|vi|vii|viii|ix|x)\b/gu, word => roman[word])
    ].filter(Boolean))].map(key => 'presentation:' + key);
  }
  // Discovery only: these parts never supply exact-title or edition identity.
  // Prefer explicit structure/semantic markers to a list of accepted titles.
  function revisionTitleParts(value, kind = 'book') {
    const title = String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
    const result = (base, qualifier = '') => ({base, qualifier});
    if (!['book', 'audiobook', 'software'].includes(kind)) return result(title);
    const marker = /\b(?:edition|ed\.?|revision|rev\.?|revised|updated|expanded|annotated|abridged|unabridged|version|release|printing|print|reprint|format|paperback|hardcover|hardback|softcover|ebook|e-book|digital|pdf|epub|mobi|cbz|cbr)\b|\b\d+e\b|\bv\d+(?:\.\d+)*\b/iu;
    // Delimiters identify the base even when an edition description is new.
    const bracket = /^(.*?)\s*[([]([^()[\]]+)[)\]]\s*$/u.exec(title);
    if (bracket?.[1]?.trim() && marker.test(bracket[2])) return result(bracket[1].trim(), bracket[2]);
    const structured = /^(.*?)\s*(?:[,;:]\s*|\s+[\-\u2013\u2014]\s+)(.+)$/u.exec(title);
    if (structured?.[1]?.trim() && marker.test(structured[2])) return result(structured[1].trim(), structured[2]);
    // Numeric shorthand and bare revision/access/format labels.
    const tail = /\s+((?:(?:edition|ed\.?|revision|rev\.?|version|release|printing)\s+\d+(?:\.\d+)*|\d+e|v(?:ersion)?\.?\s*\d+(?:\.\d+)*|(?:revised|updated|expanded|annotated)(?:\s*(?:and|&)\s*(?:revised|updated|expanded|annotated))*(?:\s+(?:edition|ed\.?|version))?|(?:abridged|unabridged|paperback|hardcover|hardback|softcover|ebook|e-book|digital|pdf|epub|mobi|cbz|cbr)))\s*$/iu.exec(title);
    if (tail) return result(title.slice(0, tail.index).trim(), tail[1]);
    // English ordinals are compositional: twenty-first, one hundred and first,
    // eleventh and hundredth use the same rule; numeric ordinals are unbounded.
    const ordinal = '(?:first|second|third|(?:four|fif|six|seven|eigh|nin|ten|eleven|twelf|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|hundred|thousand|million|billion)th|(?:twent|thirt|fort|fift|sixt|sevent|eight|ninet)ieth)';
    const tens = '(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)';
    const compound = '(?:(?:one|two|three|four|five|six|seven|eight|nine) (?:hundred|thousand|million|billion)(?: and)? )?(?:'+tens+'[- ])?'+ordinal;
    const ordinalTail = new RegExp('\\s+('+compound+'|\\d+(?:st|nd|rd|th)?)$', 'iu');
    const ending = /\s+(?:(?:revised|updated|expanded|annotated|anniversary)\s+)*(?:edition|ed\.?|revision|version|printing)\s*$/iu.exec(title);
    if (ending) {
      const prefix = title.slice(0, ending.index).trim();
      const number = ordinalTail.exec(prefix);
      if (number) return result(prefix.slice(0, number.index).trim(), title.slice(number.index).trim());
    }
    return result(title);
  }
  function revisionWordingConflict(left, right, kind = 'book') {
    if (!['book', 'audiobook', 'software'].includes(kind)) return false;
    const a = revisionTitleParts(left, kind), b = revisionTitleParts(right, kind);
    const revision = /\b(?:edition|ed\.?|revision|rev\.?|revised|updated|expanded|annotated|abridged|unabridged|version|release|printing|reprint)\b|\b\d+e\b|\bv\d+(?:\.\d+)*\b/iu;
    const titles = [presentationTitle(left, kind), presentationTitle(right, kind)];
    // Pairwise fallback: an unfamiliar trailing descriptor can still warn
    // when it explicitly labels a revision of the complete shorter title.
    for (const [base, longer] of [titles, [...titles].reverse()]) {
      if (base.replace(/\s/gu, '').length >= (kind === 'software' ? 8 : 4)
        && longer.startsWith(base+' ') && revision.test(longer.slice(base.length+1))) return true;
    }
    return Boolean((revision.test(a.qualifier) || revision.test(b.qualifier))
      && presentationTitle(a.base, kind).replace(/\s/gu, '').length >= (kind === 'software' ? 8 : 4)
      && presentationTitle(a.base, kind) === presentationTitle(b.base, kind)
      && presentationTitle(a.qualifier, kind) !== presentationTitle(b.qualifier, kind));
  }
  // Review-only collection structure. Never used for full-title identity.
  function numberedCollectionRelation(left, right, kind = 'book') {
    if (!['book', 'audiobook'].includes(kind)) return null;
    const parts = value => {
      let title = String(value ?? '').normalize('NFKC').trim();
      const format = /\s+(?:[\[(]\s*)?(?:digital|digital edition|tp|tpb|hc|paperback|hardcover|trade paperback|pdf|epub|cbz|cbr)(?:\s*[\])])?\s*$/iu;
      while (format.test(title)) title = title.replace(format, '').trim();
      const match = /^(.*?)\b(?:vol(?:ume)?\.?|book)\s*(\d+(?:\.\d+)?)(?=$|\s|:)/iu.exec(title);
      if (!match) return { series: presentationTitle(title, kind), unit: '', subtitle: '', run: '' };
      const tail = title.slice(match[0].length).trim();
      // Do not reinterpret ranges, unlabeled prose, or multiple units.
      if (tail && !tail.startsWith(':')) return null;
      const run = /\((\d{4}(?:\s*[-\u2013\u2014]\s*\d{4})?)\)/u.exec(match[1]);
      let series = match[1].replace(/\(\d{4}(?:\s*[-\u2013\u2014]\s*\d{4})?\)/gu, '').replace(/[,;:\s]+$/u, '');
      series = series.replace(/\s+(?:deluxe|new|revised|updated|expanded|\d+(?:st|nd|rd|th)?)\s+edition$/iu, '');
      const text = tail.replace(/^:\s*/u, '');
      const editionOnly = /^(?:(?:new|deluxe|revised|updated|expanded|annotated|\d+(?:st|nd|rd|th)?)\s+)*(?:edition|ed\.?)$/iu.test(text);
      const subtitle = revisionTitleParts(editionOnly ? '' : text, kind);
      return { series: presentationTitle(series, kind), unit: unitKey(match[2]),
        subtitle: presentationTitle(subtitle.base, kind), run: run ? presentationTitle(run[1], 'unit') : '' };
    };
    const a = parts(left), b = parts(right);
    if (!a || !b || !(a.unit || b.unit)) return null;
    if (a.unit && b.unit && a.unit !== b.unit) return '';
    if (a.series !== b.series) return null;
    if (a.run && b.run && a.run !== b.run) return '';
    const generic = new Set(['the', 'a', 'an', 'and', 'of', 'in', 'to', 'for', 'with', 'book', 'books', 'guide', 'complete', 'collection', 'introduction', 'manual']);
    const distinctive = new Set(a.series.split(' ').filter(word => /\p{L}/u.test(word) && word.length >= 3 && !generic.has(word)));
    if (distinctive.size < 2) return null;
    if (a.subtitle && b.subtitle && a.subtitle !== b.subtitle) return '';
    return 'Related distinctive series with compatible or unspecified volume; subtitle, run or edition identity needs review.';
  }
  function personKey(value) {
    let name = String(value ?? '').normalize('NFKC').toLowerCase().trim();
    name = name.replace(/\s*\((?:author|writer|artist|illustrator|editor|translator|pencill?er|inker|colorist|colourist|letterer)\)\s*$/u, '').trim();
    const comma = /^([^,]+),\s*([^,]+)$/u.exec(name);
    if (comma) name = comma[2] + ' ' + comma[1];
    return name.replace(/['\u2018\u2019]/gu, '').replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  }
  function authorNameVariant(left, right) {
    const a = personKey(left), b = personKey(right);
    if (!a || !b) return false;
    const accent = name => name.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').normalize('NFC');
    if (accent(a) === accent(b)) return true;
    const l = a.split(' '), r = b.split(' ');
    if (l.length < 2 || r.length < 2) return false;
    if ([...l].sort().join(' ') === [...r].sort().join(' ')) return true;
    if (l.at(-1) !== r.at(-1)) return false;
    const given = (x, y) => x === y || x.length === 1 && y.startsWith(x) || y.length === 1 && x.startsWith(y);
    if (!given(l[0], r[0])) return false;
    // An omitted middle name is missing information; two explicit incompatible
    // middle names are not silently equivalent. Initials remain review-only.
    const lm = l.slice(1, -1), rm = r.slice(1, -1);
    return !lm.length || !rm.length || lm.length === rm.length && lm.every((name, index) => given(name, rm[index]));
  }
  function authorRelation(left = [], right = []) {
    const a = (Array.isArray(left) ? left : [left]).map(personKey).filter(Boolean);
    const b = (Array.isArray(right) ? right : [right]).map(personKey).filter(Boolean);
    if (!a.length || !b.length) return 'missing';
    if (a.some(name => b.includes(name))) return 'same';
    if (a.some(name => b.some(other => authorNameVariant(name, other)))) return 'variant';
    return 'different';
  }
  function authorNames(authors, contributors = []) {
    const rows = Array.isArray(contributors) ? contributors : [];
    const writers = rows.filter(row => /^(?:author|writer|story|story writer)$/iu.test(String(row?.role ?? '').trim()))
      .map(row => row?.name).filter(name => typeof name === 'string' && name.trim());
    // Known writer roles take precedence over a mixed creator list. An artist
    // shared by two books must not conceal explicitly different writers.
    const values = writers.length ? writers : Array.isArray(authors) ? authors : [authors];
    return [...new Set(values.filter(name => typeof name === 'string' && name.trim()).map(name => name.trim()))];
  }
  function ambiguousWorks(records, fields, barrier = () => false) {
    return records.some((left, index) => records.slice(index + 1).some(right => {
      if (barrier(left, right)) return true;
      const a = fields(left), b = fields(right);
      if (authorRelation(a.authors, b.authors) === 'different') return true;
      return ['run', 'unitType', 'unit', 'volume', 'issue'].some(field => a[field] && b[field]
        && (['unit', 'volume', 'issue'].includes(field) ? unitKey(a[field]) !== unitKey(b[field]) : personKey(a[field]) !== personKey(b[field])));
    }));
  }
  function unitKey(value) {
    const text = String(value ?? '').trim();
    const fraction = /^(\d+)\/(\d+)$/u.exec(text);
    if (fraction && Number(fraction[2])) return String(Number(fraction[1]) / Number(fraction[2]));
    return /^\d+(?:\.\d+)?$/u.test(text) ? String(Number(text)) : presentationTitle(text, 'unit');
  }
  global.LibraryMatchingPolicy = Object.freeze({ presentationTitle, ownershipTitleKeys, fullTitleMatches,
    relatedPresentationReason, relatedTitleKeys, revisionTitleParts, revisionWordingConflict, numberedCollectionRelation, personKey, authorRelation, authorNames, unitKey, ambiguousWorks });
}(globalThis));
// END SHARED MATCHING POLICY
/* Pure browser helpers shared by the page overlay and extension pages. */
(function attachFanaticalLibrary(global) {
  'use strict';

  const ROMAN = new Map([['i', '1'], ['ii', '2'], ['iii', '3'], ['iv', '4'], ['v', '5'], ['vi', '6'], ['vii', '7'], ['viii', '8'], ['ix', '9'], ['x', '10']]);
  const FORMAT_WORDS = /\b(?:pdf|cbz|cbr|epub|mobi)\b/giu;
  const indexCache = new WeakMap();
  const contentsIndexCache = new WeakMap();
  // A large private GL database can take several seconds to read and match.
  const GALACTIC_REQUEST_TIMEOUT_MS = 30000;

  function normalizeTitle(value) {
    let result = String(value ?? '').normalize('NFKC')
      .toLowerCase().replace(/&/gu, ' and ').replace(FORMAT_WORDS, ' ')
      .replace(/\bvolume\b|\bvol\.?\b/giu, ' vol ').replace(/[’'`]/gu, '')
      .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim();
    result = result.replace(/\b(i|ii|iii|iv|v|vi|vii|viii|ix|x)\b/gu, (word) => ROMAN.get(word) ?? word);
    return result.replace(/\s+/gu, ' ');
  }


  // Presentation equality is deliberately narrower than the discovery key:
  // Keep articles, general Roman numerals, preview labels and +/# symbols.
  // Roman numbers after an explicit volume/issue label are unit numbers.
  function presentationTitle(value, kind = 'book') { return global.LibraryMatchingPolicy.presentationTitle(value, kind); }

  function relationTitleParts(value, kind) {
    let title = String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
    const revision = global.LibraryMatchingPolicy.revisionTitleParts(title, kind);
    if (revision.qualifier) title = revision.base;
    const edition = /\s*(?:[,;:\-\u2013\u2014]\s*)?((?:\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|revised|updated|expanded|annotated|new|deluxe)(?:\s+(?:revised|updated))?\s+(?:edition|ed\.?))\s*$/iu;
    let hasEdition = Boolean(revision.qualifier);
    if (kind === 'software') {
      const version = /^(.*?)\s*(?:[,;:\-\u2013\u2014]\s*)?(?:v(?:ersion)?\.?\s*\d+(?:\.\d+){0,3}|(?:19|20)\d{2})\s*$/iu.exec(title);
      return { primary: normalizeTitle(version?.[1]?.trim() || title), hasVersion: Boolean(revision.qualifier || version?.[1]?.trim()), subtitle: false, qualifier: false, hasEdition: false };
    }
    const stripEdition = () => {
      const found = edition.exec(title);
      if (found && found.index > 0) { title = title.slice(0, found.index).trim(); hasEdition = true; }
    };
    stripEdition();
    const qualifier = /^(.*?)\s*\(([^()]*)\)\s*$/u.exec(title);
    if (qualifier?.[1]?.trim()) {
      hasEdition ||= edition.test(' ' + qualifier[2]);
      title = qualifier[1].trim(); stripEdition();
    }
    const subtitle = /^(.*?)\s*:\s+(.+)$/u.exec(title);
    return { primary: normalizeTitle(subtitle?.[1]?.trim() || title), subtitle: Boolean(subtitle),
      qualifier: Boolean(qualifier), hasEdition, hasVersion: false };
  }

  const CANDIDATE_STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'of', 'to', 'in', 'for', 'with', 'by', 'vol', 'volume', 'edition', 'book', 'game', 'software']);
  function candidateTitleKeys(title, kind) {
    const words = normalizeTitle(title).split(' ').filter(word => word.length > 1 && !CANDIDATE_STOP_WORDS.has(word));
    const keys = [...words.map(word => 'word:' + word), ...global.LibraryMatchingPolicy.relatedTitleKeys(title, kind)];
    for (const word of words) if (word.length >= 7 && !/\p{N}/u.test(word)) {
      keys.push('start:' + word.slice(0, 3), 'end:' + word.slice(-3));
    }
    keys.push('primary:' + relationTitleParts(title, kind).primary);
    return [...new Set(keys)];
  }

  function closeTitleSpelling(left, right) {
    const a = Array.from(left); const b = Array.from(right);
    const limit = Math.min(a.length, b.length) >= 16 ? 2 : 1;
    if (Math.min(a.length, b.length) < 8 || Math.abs(a.length - b.length) > limit) return false;
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      for (let j = 1; j <= b.length; j++) row[j] = Math.min(row[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (Math.min(...row) > limit) return false;
      previous = row;
    }
    return previous[b.length] <= limit;
  }

  // Candidate rules never prove ownership. Callers must still check media,
  // known authors, runs and numbered units before presenting these warnings.
  function possibleTitleRelation(left, right, kind = 'book') {
    const a = normalizeTitle(left); const b = normalizeTitle(right);
    if (!a || !b) return '';
    const numbered = global.LibraryMatchingPolicy.numberedCollectionRelation(left, right, kind);
    if (numbered !== null) return numbered;
    const presentation = global.LibraryMatchingPolicy.relatedPresentationReason(left, right, kind);
    if (presentation) return presentation;
    if (a === b) return 'Related title presentation; identity needs review.';
    if (global.LibraryMatchingPolicy.revisionWordingConflict(left, right, kind)) return 'Related complete base title with revision or version wording; identity needs review.';
    const access = value => value.replace(/\s+(?:preview|sample|excerpt|read now|demo|trial)$/iu, '').trim();
    if (access(a) === access(b)) return 'Related title, but preview/sample access does not establish the full product.';
    const numbers = value => (value.match(/\d+(?:\.\d+|\/\d+)?/gu) ?? []).join('|');
    const l = relationTitleParts(left, kind); const r = relationTitleParts(right, kind);
    if (l.primary && l.primary === r.primary) {
      if (kind === 'software' && (l.hasVersion || r.hasVersion) && l.primary.replace(/\s/gu, '').length >= 8) return 'Related software title with different version labels.';
      if (kind === 'book' || kind === 'audiobook') {
        if (l.hasEdition || r.hasEdition) return 'Related main title with different edition or subtitle wording.';
        // A bare title may have a longer store presentation, even if short.
        // Independently subtitled works are not inferred from a shared prefix.
        if (!(l.subtitle && r.subtitle) && (l.subtitle || r.subtitle || l.qualifier || r.qualifier)
          && l.primary.replace(/\s/gu, '').length >= 4) return 'One title is a shortened or qualified presentation of the other.';
        if (l.subtitle && r.subtitle) return '';
      }
    }
    if (kind === 'game') {
      const collection = value => {
        if (!/\b(?:collection|trilogy|complete pack|ultimate collection)\b/iu.test(value)) return '';
        return normalizeTitle(value).replace(/\b(?:the|complete|ultimate|collection|trilogy|pack)\b/gu, ' ').replace(/\s+/gu, ' ').trim();
      };
      for (const [base, other] of [[collection(left), b], [collection(right), a]]) {
        if (base.length >= 4 && (other === base || other.startsWith(base + ' '))) return 'This game may be included in the named library collection; contents need review.';
      }
    }
    // Do not turn different numbered releases/units into typo warnings.
    if (numbers(a) !== numbers(b)) return '';
    if (closeTitleSpelling(a, b)) return 'The titles have a small spelling difference; review the library item.';
    const words = value => new Set(value.split(' ').filter(word => !CANDIDATE_STOP_WORDS.has(word)));
    const aw = words(a); const bw = words(b);
    const overlap = [...aw].filter(word => bw.has(word)).length;
    if (Math.min(aw.size, bw.size) >= 3 && overlap / new Set([...aw, ...bw]).size >= 0.8) return 'The titles have a close word match; identity needs review.';
    return '';
  }

  function titleKey(value) {
    return normalizeTitle(value).replace(/\b(?:the|a|an)\b/gu, ' ').replace(/\s+/gu, ' ').trim();
  }

  function mediaType(value) {
    const type = String(value ?? '').toLowerCase();
    if (type.includes('comic') || ['book', 'ebook', 'manga', 'graphic_novel', 'graphic novel'].includes(type)) return 'book';
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
  function matchingIsbns(item) {
    return [...new Set([item?.externalIds?.isbn, item?.isbn, item?.isbns, item?.evidence?.isbn]
      .flat().map(validIsbn).filter(Boolean))].slice(0, 50);
  }

  function editionBase(value) {
    return normalizeTitle(value).replace(/\s+(?:(?:base(?: game)?|standard|digital deluxe|deluxe|gold|platinum|complete|ultimate|definitive|premium|collectors?|anniversary|remastered|enhanced|goty|game of the year)(?: edition| version)?|(?:\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|revised|updated|expanded|annotated|new)(?:\s+(?:revised|updated))?\s+(?:edition|ed)|[\p{L}\p{N}]+ (?:edition|version)|soundtrack|dlc|expansion|season pass|bonus content|complete pack|ultimate collection|collection|trilogy)$/iu, '').trim();
  }

  function gamePackageIdentity(title) {
    const key = scopeKey(title);
    const qualifiers = new Set();
    for (const match of key.matchAll(/\b(deluxe|gold|platinum|complete|ultimate|definitive|premium|collectors?|goty|enhanced|anniversary|remaster(?:ed)?|soundtrack|dlc|expansion|pack|package|bundle|collection|upgrade)\b/gu)) qualifiers.add(match[1].replace(/^collector$/u, 'collectors').replace(/^remaster$/u, 'remastered'));
    if (/\bgame of the year\b/u.test(key)) qualifiers.add('goty');
    if (/\bseason pass\b/u.test(key)) qualifiers.add('season pass');
    if (/\bbonus content\b/u.test(key)) qualifiers.add('bonus content');
    if (/\bdirectors? cut\b/u.test(key)) qualifiers.add('directors cut');
    for (const match of key.matchAll(/([\p{L}\p{N}]+) (?:edition|version)(?:\s|$)/gu)) {
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
    const authors = global.LibraryMatchingPolicy.authorNames(raw?.authors ?? raw?.author, raw?.contributors);
    const names = [...new Set(authors.filter(value => typeof value === 'string').map(value => value.trim().slice(0, 500)).filter(Boolean))].slice(0, 50);
    if (names.length) result.authors = names;
    return result;
  }

  function scopeKey(value) {
    return String(value ?? '').normalize('NFKC').toLowerCase().replace(/&/gu, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/gu, ' ');
  }
  function numberKey(value, unitType) {
    const text = String(value ?? '').trim();
    if (unitType === 'component') return text.replace(/\s+/gu, ' ');
    const fraction = /^(\d+)\/(\d+)$/u.exec(text);
    if (fraction && Number(fraction[2])) return String(Number(fraction[1]) / Number(fraction[2]));
    return /^\d+(?:\.\d+)?$/u.test(text) ? String(Number(text)) : scopeKey(text);
  }
  function contentKey(entry) {
    return JSON.stringify([scopeKey(entry.series), scopeKey(entry.run), entry.unitType, numberKey(entry.number, entry.unitType), scopeKey(entry.language)]);
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
        unitType: entry.unitType, number: numberKey(entry.number, entry.unitType).slice(0, 500), language: typeof entry.language === 'string' ? entry.language.trim().slice(0, 500) : '', completeness: entry.completeness };
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
  const completeBundleCatalogues = new WeakSet();
  const bundleOverlapProducts = new WeakSet();
  function isBundleOverlapProduct(product) { return bundleOverlapProducts.has(product); }
  function isCompleteBundleCatalogue(parsed) { return completeBundleCatalogues.has(parsed); }
  function parseBundle(raw, routeKind = 'standard') {
    if (!raw || !raw._id || typeof raw.name !== 'string' || !raw.name.trim()) throw new Error('Fanatical bundle response is missing its identity.');
    const pickMix = routeKind === 'pick-mix' || Array.isArray(raw.products) && Array.isArray(raw.tiers);
    const groups = pickMix ? [] : (Array.isArray(raw.bundles) ? raw.bundles : []).map((group, index) => ({ index, price: group?.price ?? null, products: (Array.isArray(group?.games) ? group.games : []).map(plainProduct).filter(Boolean) }));
    const products = pickMix ? (Array.isArray(raw.products) ? raw.products : []).map(plainProduct).filter(Boolean) : groups.flatMap(group => group.products);
    const tiers = pickMix ? (Array.isArray(raw.tiers) ? raw.tiers : []).map(tier => ({ id: String(tier?._id ?? ''), quantity: Number(tier?.quantity ?? 0), price: tier?.price ?? {} })).filter(tier => tier.quantity > 0) : groups.map(group => ({ id: String(group.index), price: group.price }));
    const bundle = { sourceItemId: String(raw._id), title: raw.name.trim(), slug: typeof raw.slug === 'string' ? raw.slug.trim() : '' };
    const parsed = { kind: pickMix ? 'pick-mix' : 'standard', ...bundle, bundle, products, groups, tiers, order: pickMix && Array.isArray(raw.ordering) ? raw.ordering.map(String) : [] };
    // Only the validated full endpoint catalogue can establish bundle context.
    const sourceGroups = pickMix ? [raw.products] : (Array.isArray(raw.bundles) ? raw.bundles.map(group => group?.games) : null);
    const complete = Array.isArray(sourceGroups) && sourceGroups.length > 0 && sourceGroups.every(Array.isArray)
      && sourceGroups.flat().length === products.length && products.length > 1
      && (!pickMix || Array.isArray(raw.tiers) && raw.tiers.length > 0 && tiers.length === raw.tiers.length)
      && !raw.hasMore && !raw.nextPage && !raw.pagination && raw.complete !== false && raw.incomplete !== true;
    if (complete) {
      completeBundleCatalogues.add(parsed);
      sourceGroups.flat().forEach((rawProduct,index)=>{
        if (/\b(?:pdf|epub|mobi|cbz|cbr|audiobook)\b/iu.test([rawProduct.format,rawProduct.formats,rawProduct.metadata?.format].flat().filter(Boolean).join(' '))) bundleOverlapProducts.add(products[index]);
      });
    }
    return parsed;
  }

  function makeIndexes(items) {
    if (indexCache.has(items)) return indexCache.get(items);
    const byId = new Map(); const bySteam = new Map(); const byIsbn = new Map(); const byTitle = new Map(); const byBase = new Map();
    const byPresentation = new Map(); const byPossibleTitle = new Map();
    for (const item of items ?? []) {
      if (!item) continue;
      if (item.sourceItemId) byId.set(String(item.sourceItemId), item);
      const ids = externalIds(item);
      if (ids.steamAppId) bySteam.set(ids.steamAppId, [...(bySteam.get(ids.steamAppId) ?? []), item]);
      for (const isbn of matchingIsbns(item)) byIsbn.set(isbn, [...(byIsbn.get(isbn) ?? []), item]);
      const key = `${mediaType(item.mediaType ?? item.type)}:${titleKey(item.title)}`;
      if (item.title) byTitle.set(key, [...(byTitle.get(key) ?? []), item]);
      for (const key of global.LibraryMatchingPolicy.ownershipTitleKeys(item.title,mediaType(item.mediaType ?? item.type))) {
        const presentation = mediaType(item.mediaType ?? item.type) + ':' + key;
        if (item.title) byPresentation.set(presentation, [...(byPresentation.get(presentation) ?? []), item]);
      }
      for (const token of candidateTitleKeys(item.title, mediaType(item.mediaType ?? item.type))) {
        const possible = mediaType(item.mediaType ?? item.type) + ':' + token;
        byPossibleTitle.set(possible, [...(byPossibleTitle.get(possible) ?? []), item]);
      }
      const base = `${mediaType(item.mediaType ?? item.type)}:${editionBase(item.title)}`;
      if (item.title) byBase.set(base, [...(byBase.get(base) ?? []), item]);
    }
    const index = { byId, bySteam, byIsbn, byTitle, byBase, byPresentation, byPossibleTitle };
    indexCache.set(items, index);
    return index;
  }

  function identityConflicts(candidate, owned, edition = false) {
    const left = bibliographicFields(candidate); const right = bibliographicFields(owned.evidence ? { ...owned.evidence, title: owned.title } : owned);
    const reasons = [];
    const offeredIsbns = matchingIsbns(candidate), ownedIsbns = matchingIsbns(owned);
    const sharedIsbn = offeredIsbns.some(isbn => ownedIsbns.includes(isbn));
    const authors = global.LibraryMatchingPolicy.authorRelation(left.authors,right.authors);
    if (authors === 'different') reasons.push('Different known authors');
    if (edition && authors === 'variant' && !sharedIsbn) reasons.push('Author name variation needs review');
    for (const field of ['run', 'issue', 'volume', ...(edition ? ['series', 'edition', 'language'] : [])]) {
      const normalize = ['volume', 'issue'].includes(field) ? global.LibraryMatchingPolicy.unitKey : scopeKey;
      if (left[field] && right[field] && normalize(left[field]) !== normalize(right[field])) reasons.push(`Different ${field}`);
    }
    const offeredUnits = offerContents({ ...left, title: candidate.title }).entries;
    const ownedUnits = offerContents({ ...right, title: owned.title }).entries;
    if (offeredUnits.length === 1 && ownedUnits.length === 1) {
      for (const name of ['series', 'run', 'unitType']) if (offeredUnits[0][name] && ownedUnits[0][name] && scopeKey(offeredUnits[0][name]) !== scopeKey(ownedUnits[0][name])) reasons.push(`Different ${name}`);
      if (numberKey(offeredUnits[0].number) !== numberKey(ownedUnits[0].number)) reasons.push('Different issue/volume');
    }
    if (edition) {
      if (global.LibraryMatchingPolicy.revisionWordingConflict(candidate.title, owned.title, mediaType(candidate.mediaType))) reasons.push('Different revision wording');
      const limited = title => /\b(?:preview|sample|excerpt|read\s+now|demo|trial)\b/iu.test(title);
      if (limited(candidate.title) !== limited(owned.title)) reasons.push('Preview/sample and full-product access differ');
      if (offeredIsbns.length && ownedIsbns.length && !sharedIsbn) reasons.push('Different validated ISBNs');
      if (editionBase(candidate.title) === editionBase(owned.title) && normalizeTitle(candidate.title) !== normalizeTitle(owned.title)
        && (mediaType(candidate.mediaType) !== 'game' || gamePackageIdentity(candidate.title) !== gamePackageIdentity(owned.title))) reasons.push('Different edition/package wording');
    }
    return reasons;
  }

  function relationshipMatch(item, library) {
    const candidateBase = editionBase(item.title);
    if (!candidateBase || /^(?:the|a|an|edition|version|game|book|volume)$/u.test(candidateBase)) return null;
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
    if (id && indexes.byId.has(id)) {
      const owned=indexes.byId.get(id),differences=identityConflicts(item,owned,true);
      const offeredMedia=mediaType(item.mediaType??item.type),ownedMedia=mediaType(owned.mediaType??owned.type);
      if(offeredMedia!=='other'&&ownedMedia!=='other'&&offeredMedia!==ownedMedia)differences.push('Different media type');
      if(differentGamePackage(item,owned))differences.push('Different game package');
      return {state:differences.length?'possible':'owned',provenance:'fanatical',item:owned,
        reason:differences.length?'Same Fanatical product ID, but '+differences.join('; ')+'. Review the library item.':'exact Fanatical product ID'};
    }
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
    const titleMatches = [...new Set([...(indexes.byTitle.get(`${media}:${titleKey(item?.title)}`) ?? []),
      ...(indexes.byPresentation.get(media + ':' + presentationTitle(item?.title, media)) ?? [])])];
    const compatibleTitles = titleMatches.filter(owned => !identityConflicts(item, owned).length);
    const policy=global.LibraryMatchingPolicy;
    const full=compatibleTitles.filter(owned=>policy.fullTitleMatches(item.title,owned.title,media)&&!differentGamePackage(item,owned)&&!identityConflicts(item,owned,true).length);
    const ambiguous=policy.ambiguousWorks(full,bibliographicFields);
    const exact = compatibleTitles.find((owned) => !differentGamePackage(item, owned) && !identityConflicts(item, owned, true).length
      && policy.fullTitleMatches(item.title,owned.title,media) && !ambiguous);
    if (exact && !hasComponents) return { state: 'owned', provenance: 'fanatical', item: exact, reason: 'exact normalized title' };
    const steam = steamMatches.find((owned) => !differentGamePackage(item, owned));
    const steamProvesProduct = steam && !hasComponents && !componentProof && !identityConflicts(item, steam, true).length && (media !== 'game' || !gamePackageIdentity(item?.title));
    if (steamProvesProduct) return { state: 'owned', provenance: 'fanatical', item: steam, reason: 'exact Steam App ID' };
    const isbnCandidates = [...new Set(matchingIsbns(item).flatMap(isbn => indexes.byIsbn.get(isbn) ?? []))];
    const isbnMatches = isbnCandidates.filter(owned => compatibleMedia(media, owned.mediaType ?? owned.type) && !identityConflicts(item, owned, true).length);
    const isbn = !policy.ambiguousWorks(isbnMatches, bibliographicFields) && isbnMatches[0];
    if (isbn && compatibleMedia(media, isbn.mediaType ?? isbn.type)) return { state: 'owned', provenance: 'fanatical', item: isbn, reason: 'exact ISBN' };
    const isbnRelated = isbnCandidates.find(owned => compatibleMedia(media, owned.mediaType ?? owned.type) && !identityConflicts(item, owned).length);
    if (isbnRelated) return { state: 'possible', provenance: 'fanatical', item: isbnRelated, reason: `Owned "${isbnRelated.title}"; offered "${item.title}". Shared validated ISBN but ${identityConflicts(item, isbnRelated, true).join('; ') || 'edition identity needs review'}.` };
    if (steamDifference) return {...packageRelationship(item, steamDifference, 'Shared Steam App ID identifies the base game only'),candidates:[...new Set([steamDifference,...steamMatches.filter(owned=>!identityConflicts(item,owned).length)])]};
    const titleDifference = titleMatches.find((owned) => differentGamePackage(item, owned));
    if (titleDifference) return packageRelationship(item, titleDifference, 'Normalized title hides a package difference');
    if (hasComponents && (steam || exact)) return packageRelationship(item, steam || exact, 'Package component coverage is unknown');
    if (steam) return packageRelationship(item, steam, 'Shared Steam App ID does not verify this product/component');
    const pool = new Set(compatibleTitles);
    for (const owned of indexes.byBase.get(media + ':' + editionBase(item.title)) ?? []) pool.add(owned);
    for (const key of candidateTitleKeys(item.title, media)) for (const owned of indexes.byPossibleTitle.get(media + ':' + key) ?? []) pool.add(owned);
    const candidates = [...pool].filter(owned => !identityConflicts(item, owned).length).map(owned => {
      const relatedEdition = editionBase(item.title) === editionBase(owned.title) && titleKey(item.title) !== titleKey(owned.title);
      const reason = compatibleTitles.includes(owned) ? identityConflicts(item, owned, true).join('; ') || 'Title identity needs review'
        : relatedEdition ? 'Related edition/package; identity needs review' : possibleTitleRelation(item.title, owned.title, media);
      return { item: owned, reason };
    }).filter(candidate => candidate.reason).sort((a, b) => a.item.title.localeCompare(b.item.title, undefined, { numeric: true }));
    if (candidates.length) return { state: 'possible', provenance: 'fanatical', item: candidates[0].item,
      candidates: candidates.map(candidate => candidate.item), editionDifference: media === 'game',
      reason: candidates.map(candidate => `Owned "${candidate.item.title}"; offered "${item.title}". ${candidate.reason}.`).join('\n') };
    const relation = relationshipMatch(item ?? {}, library);
    if (relation) return media === 'game' ? packageRelationship(item, relation.item, relation.reason) : { state: 'possible', provenance: 'fanatical', item: relation.item, reason: relation.reason };
    return { state: 'new', provenance: null };
  }

  function offerContents(item) {
    const explicit = contentsMetadata(item);
    if (explicit.contents?.length || explicit.contentsCoverageUnknown) return { entries: explicit.contents ?? [], complete: explicit.contentsComplete === true, uncertain: explicit.contentsCoverageUnknown === true, source: 'Explicit catalog contents' };
    // Title ranges are comparison targets, never an owned collection assertion.
    const match = /^(.*?)\s+(?:\((\d{4})\)\s*)?(?:(vol(?:ume)?s?\.?|issues?)\s*|#)(\d+(?:\.\d+|\/\d+)?)(?:\s*[-–]\s*(\d+))?\s*$/iu.exec(String(item?.title ?? ''));
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
    const unitToken = entry => JSON.stringify([scopeKey(entry.series), entry.unitType, numberKey(entry.number, entry.unitType)]);
    const build = entries => {
      const index = new Map();
      for (const entry of entries) { const id = unitToken(entry); const rows = index.get(id) ?? []; rows.push(entry); index.set(id, rows); }
      return index;
    };
    if (!contentsIndexCache.has(local)) contentsIndexCache.set(local, build(local));
    const localIndex = contentsIndexCache.get(local);
    const externalIndex = build([...(result?.coverage?.covered ?? []), ...(result?.coverage?.possibleCovered ?? []).map(entry => ({ ...entry, uncertain: true }))].map(entry=>({...entry,central:true})));
    const units = [...new Map(target.entries.filter(entry => entry.completeness === 'full').map(entry => [contentKey(entry), entry])).values()];
    const covered = []; const missing = []; const possibleCovered = [];
    for (const entry of units) {
      const confirmed = []; const possible = [];
      for (const candidate of [...(localIndex.get(unitToken(entry)) ?? []), ...(externalIndex.get(unitToken(entry)) ?? [])]) {
        if (candidate.completeness !== 'full') continue;
        if (entry.run && candidate.run && scopeKey(entry.run) !== scopeKey(candidate.run) || entry.language && candidate.language && scopeKey(entry.language) !== scopeKey(candidate.language)) continue;
        const evidence = (candidate.evidence ?? []).filter(record => permanent(record) && (record.provider !== 'fanatical' || !candidate.central));
        // No catalog/local row carries trusted GL parent scope. Named equality
        // remains Possible even when local and central evidence are combined.
        if (entry.unitType !== 'component' && !candidate.uncertain && entry.run && entry.language && candidate.run && candidate.language && contentKey(entry) === contentKey(candidate)) confirmed.push(...evidence);
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
    if (!product && local?.state === 'owned') return local;
    product ||= local?.offered || {};
    const records = (result?.matches ?? []).filter(record => record.provider !== 'fanatical');
    const strongEdition = record => {
      if (!['book', 'audiobook'].includes(mediaType(product.mediaType)) || record.relationship === 'same-edition') return true;
      const isbns = matchingIsbns(product);
      const authors = bibliographicFields(product).authors;
      return Boolean(isbns.some(isbn => matchingIsbns(record).includes(isbn))
        || global.LibraryMatchingPolicy.fullTitleMatches(product.title, record.title, mediaType(product.mediaType))
          && global.LibraryMatchingPolicy.authorRelation(authors, bibliographicFields(record.evidence || record).authors) === 'same');
    };
    const exact = records.find(record => permanent(record) && !(local.editionDifference && !record.title) && record.relationship !== 'same-work' && record.relationship !== 'contains'
      && strongEdition(record) && !identityConflicts(product, record, true).length && !differentGamePackage(product, { ...record, mediaType: product.mediaType }));
    let match = local;
    if (local.state !== 'owned') {
      if (exact) match = { state: 'owned-elsewhere', provenance: exact.provider, item: exact, reason: exact.reason || 'exact Galactic Library match' };
      else if (coverage?.owned) {
        const external = coverage.covered.flatMap(entry => entry.evidence).find(record => record.provider !== 'fanatical');
        match = { state: coverage.complete && coverage.contentsComplete ? (external ? 'owned-elsewhere' : 'owned') : 'partial', item: coverage.covered[0]?.evidence[0],
          provenance: external?.provider || 'fanatical', owned: coverage.owned, total: coverage.total, reason: 'Verified full contents across owned collections' };
      }
      else if (local.state === 'new') {
        const possible = [...records, ...(result?.possibleMatches ?? [])].find(record => record.provider !== 'fanatical');
        if (possible) match = { state: 'possible', provenance: possible.provider, item: possible, ownershipReview: !permanent(possible),
          reason: `Library item "${possible.title || 'Unnamed record'}": ${possible.reason || possible.relationship || 'Related edition needs review'}${!permanent(possible) ? `; ${possible.ownership || 'unknown'} ownership` : ''}.`, editionDifference: permanent(possible) && possible.title !== product.title };
        else if (coverage?.possibleCovered.length) match = { state: 'possible', provenance: coverage.possibleCovered[0]?.evidence[0]?.provider, reason: 'Potential contents coverage needs run/language confirmation' };
      }
    }
    const centralFanatical=[...(result?.matches??[]),...(result?.possibleMatches??[]),...(result?.partialMatches??[])].filter(record=>record?.provider==='fanatical');
    if(match.state==='new'&&centralFanatical.length){const record=centralFanatical[0];match={state:'possible',provenance:'fanatical',item:record,ownershipReview:true,reason:'Fanatical copy in Galactic Library: "'+record.title+'". It is absent from the current local purchase snapshot; rescan Fanatical before deciding ownership.'};}
    return { ...match, offered: product, localMatch: local, externalResult: result, coverage, ...(centralFanatical.length?{centralFanaticalIgnored:true}:{}) };
  }
  function galacticRequestItems(products,softwareSupported=false) {
    const supported = new Set(['game', 'book', 'audiobook',...(softwareSupported?['software']:[])]);
    return (Array.isArray(products) ? products : []).filter((product) => product?.sourceItemId && typeof product?.title === 'string' && supported.has(mediaType(product.mediaType))).map((product) => {
      const data = bibliographicFields(product); delete data.publisher;
      const isbns = matchingIsbns(product), isbn = isbns.length === 1 ? isbns[0] : isbns; const target = offerContents(product);
      return { requestId: String(product.sourceItemId).slice(0, 500), title: product.title.trim().slice(0, 500), mediaType: mediaType(product.mediaType), excludeProviders: ['fanatical'], ...data,
        ...(isbns.length ? { identifiers: { isbn } } : {}), ...(target.entries.length ? { contents: target.entries, contentsComplete: target.complete } : {}) };
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
  function classifyWithHistory(product, library, historicalItems) {
    const local = classify(product, library);
    if (local.state === 'owned' || !historicalItems?.length) return local;
    const previous = classify(product, historicalItems);
    if (previous.state === 'new') return local;
    // Components must warn individually: an aggregate history-only assertion
    // never proves this product or its contents.
    const records = [previous.item, ...(previous.candidates ?? [])].filter(Boolean);
    if (!records.length) return local;
    const candidates = [...new Set(records)].map(record => ({ ...record, historical: true, ownership: 'unknown' }));
    if (local.state === 'partial') return { ...local, historicalItems: candidates };
    return { ...local, state: 'possible', provenance: 'fanatical', ownershipReview: true,
      item: local.item ?? candidates[0], candidates: [...(local.candidates ?? []), ...candidates], historicalItems: candidates,
      reason: [local.reason, 'Previously recorded in this Fanatical profile, but not observed in the current snapshot. Current ownership needs review.'].filter(Boolean).join(' ') };
  }
  function resolveProduct(product, library, localUnits, lookup, depth = 0, historicalItems = []) {
    const local = classifyWithHistory(product, library, historicalItems);
    const queried = lookup(product);
    const result = local.state === 'owned' && queried?.lookupIncomplete ? null : queried;
    const target = offerContents(product);
    const coverage = target.entries.length ? coverageFor(target, localUnits, result) : null;
    const resolved = mergeGalactic(local, result, product, coverage);
    resolved.contentsLookupIncomplete = target.entries.length > 0 && Boolean(result) && !result.coverage;
    resolved.lookupIncomplete = result?.lookupIncomplete === true && local.state !== 'owned';
    if (resolved.lookupIncomplete && resolved.state === 'new') resolved.state = 'unchecked';
    if (depth > 4 || ['owned', 'owned-elsewhere'].includes(resolved.state) || !product.components?.length) return resolved;
    const components = [...new Map(product.components.map(item => [item.sourceItemId || `${item.mediaType}:${normalizeTitle(item.title)}`, item])).values()];
    const matches = components.map(item => resolveProduct(item, library, localUnits, lookup, depth + 1, historicalItems));
    const owned = matches.filter(match => ['owned', 'owned-elsewhere'].includes(match.state)).length;
    resolved.componentMatches = matches;
    resolved.lookupIncomplete ||= matches.some(match => match.lookupIncomplete);
    if (owned) {
      resolved.state = product.componentCoverageUnknown ? 'possible' : owned === components.length && product.componentsComplete === true ? 'owned-elsewhere' : 'partial';
      resolved.owned = owned; resolved.total = components.length;
      resolved.reason = `Verified ${owned}/${components.length} listed components${product.componentsComplete === true ? '' : '; full package contents are not established'}.`;
      if (resolved.item?.title) resolved.reason += ` owned "${resolved.item.title}"; offered "${product.title}".`;
      if (product.componentCoverageUnknown) resolved.reason += ' Some component metadata is unreadable.';
    } else if (matches.some(match => match.state === 'possible') && ['new', 'unchecked'].includes(resolved.state)) {
      resolved.state = 'possible'; resolved.reason = 'Related library items for listed components need review.';
      resolved.ownershipReview = matches.some(match => match.ownershipReview);
    }
    if (resolved.lookupIncomplete && resolved.state === 'new') resolved.state = 'unchecked';
    return resolved;
  }
  let galacticDiagnosticSequence=0;
  const galacticDiagnosticPrefix=(global.crypto?.randomUUID?.().replaceAll('-','')??Math.random().toString(16).slice(2).padEnd(12,'0')).slice(0,12);
  const galacticDiagnosticNow=()=>Number.isFinite(global.performance?.timeOrigin)?global.performance.timeOrigin+global.performance.now():Date.now();
  async function sendGalacticMatch(send,request){
    if(request.type!=='MATCH_ITEMS')return send(request);
    const id='lookup-'+galacticDiagnosticPrefix+'-'+String(++galacticDiagnosticSequence).padStart(3,'0');
    const response=await send({...request,diagnosticLookupId:id,diagnosticSentEpochMs:galacticDiagnosticNow()});
    const callback=galacticDiagnosticNow();
    if(response?.performance?.id===id){try{Promise.resolve(send({type:'MATCH_ITEMS_DIAGNOSTIC_CALLBACK',apiVersion:1,diagnosticLookupId:id,diagnosticCallbackEpochMs:callback})).catch(()=>{});}catch{}}
    return response;
  }
  async function queryGalacticItems(requests, send, timeoutMs = GALACTIC_REQUEST_TIMEOUT_MS) {
    const results=new Map(),failed=new Set(),failures=new Set();
    const record=row=>row&&typeof row==='object'&&['steam','gog','epic','amazon-games','audible','kindle','amazon-video','fandango-at-home','kobo','fanatical','humble'].includes(row.provider)&&typeof row.title==='string'&&row.title.trim()&&row.title.length<=500&&['owned','claimed','unknown','subscription','rental','borrowed'].includes(row.ownership)&&(row.relationship===undefined||['same-work','same-edition','contains'].includes(row.relationship));
    const entries=value=>Array.isArray(value)&&value.length<=2000&&value.every(entry=>entry&&typeof entry.series==='string'&&typeof entry.number==='string'&&Array.isArray(entry.evidence??[])&&(entry.evidence??[]).every(record));
    for(const batch of galacticBatches(requests)){
      let timer,reason='Connection unavailable';
      try{
        const response=await Promise.race([send({type:'MATCH_ITEMS',apiVersion:1,items:batch}),new Promise((_,reject)=>{timer=setTimeout(()=>{reason=`Connection timed out after ${timeoutMs/1000} seconds; retry the checks`;reject(Error('timeout'));},timeoutMs);})]);
        if(response?.ok!==true){reason='API response rejected';throw Error(reason);}if(response.apiVersion!==1){reason='Incompatible API version';throw Error(reason);}if(!Array.isArray(response.results)||response.results.length>batch.length){reason='Invalid match response';throw Error(reason);}
        for(const request of batch){
          const rows=response.results.filter(row=>row?.requestId===request.requestId),row=rows[0];
          const valid=rows.length===1&&['matches','possibleMatches','partialMatches'].every(field=>(field!=='matches'&&row[field]===undefined)||Array.isArray(row[field])&&row[field].length<=10000&&row[field].every(record))&&(!row.coverage||Number.isSafeInteger(row.coverage.total)&&Number.isSafeInteger(row.coverage.owned)&&row.coverage.total>=0&&row.coverage.owned>=0&&row.coverage.owned<=row.coverage.total&&typeof row.coverage.complete==='boolean'&&typeof row.coverage.scopeUncertain==='boolean'&&['covered','possibleCovered','missing'].every(field=>entries(row.coverage[field])));
          if(!valid){failed.add(request.requestId);failures.add('Missing or invalid item response');}else results.set(request.requestId,row);
        }
      }catch{batch.forEach(request=>failed.add(request.requestId));failures.add(reason);}finally{clearTimeout(timer);}
    }
    return {results,failed,failures};
  }

  function overlayLabel(match) {
    if (match?.state === 'unchecked') return 'Check incomplete';
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
    card.title = global.FanaticalLibrary.presentation.tooltip(match?.offered || {}, match || {state:'new'});
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
    if (offered.mediaType && !['game', 'book', 'audiobook'].includes(mediaType(offered.mediaType))&&!match.externalResult) lines.push(`Central lookup does not support ${offered.mediaType}; this offer uses local Fanatical evidence only.`);
    if(match.externalResult)lines.push('Local Fanatical purchases are the source authority. Central Fanatical copies are excluded from ownership elsewhere; rescan local orders if the snapshots disagree.');
    if(match.centralFanaticalIgnored)lines.push('A returned central Fanatical copy was kept for review only and supplied no owned contents.');
    if (match.lookupIncomplete) lines.push('Ownership check incomplete: Galactic Library could not complete this check. Local evidence is retained; this item may already be owned. A failed lookup is not proof of absence.');
    if (match.contentsLookupIncomplete) lines.push('Central contents coverage was not supplied; unit absence cannot be established from this lookup.');
    lines.push(`Fanatical last successful import: ${lastImport || 'unknown'}. Synced libraries may not cover the entire purchase history.`);
    if (match.localMatch?.reason && match.localMatch.reason !== match.reason) lines.push(`Local comparison: ${match.localMatch.reason}`);
    const records = [match.item, match.localMatch?.item, ...(match.historicalItems || []), ...(match.localMatch?.historicalItems || []), ...(match.candidates || []), ...(match.localMatch?.candidates || []), ...(match.externalResult?.matches || []), ...(match.externalResult?.possibleMatches || []), ...(match.externalResult?.partialMatches || []),
      ...(match.coverage?.covered || []).flatMap(entry => entry.evidence || []), ...(match.coverage?.possibleCovered || []).flatMap(entry => entry.evidence || [])].filter(Boolean);
    const seen = new Set();
    for (const record of records) {
      const item = record.item || record; const provider = record.provider || 'fanatical';
      const key = `${provider}:${record.itemRef || item.sourceItemId || item.title}`;
      if (seen.has(key)) continue; seen.add(key);
      if (item.historical) lines.push("Historical purchase: previously recorded in this profile; not observed in the current snapshot. Current access needs review.");
      lines.push(`Library item: ${item.title || 'Unnamed record'} · ${provider} · ${record.ownership || 'purchased locally'}`);
      describe('Library evidence', record.evidence ? record.evidence : item);
      const conflicts = identityConflicts(offered, record.evidence ? { ...record.evidence, title: item.title } : item, true);
      if (conflicts.length) lines.push(`Differences: ${conflicts.join('; ')}`);
      lines.push(`Relationship: ${record.relationship || 'local product/edition comparison'} · ${record.reason || match.localMatch?.reason || 'Local purchase assertion'}`);
      if (typeof record.confidence === 'number' && Number.isFinite(record.confidence)) lines.push(`Confidence rule score: ${record.confidence}; this is not a calibrated probability.`);
      lines.push(`Source: ${record.evidence?.source || 'Fanatical purchase import'} · observed ${record.evidence?.checkedAt || 'unknown'} · contents verified ${record.verifiedAt || 'unknown'}`);
      if (item.purchaseDate) lines.push(`Purchase date: ${item.purchaseDate}`);
      if (item.bundle?.title) lines.push(`Purchased bundle: ${item.bundle.title}`);
      if(item.purchaseOrigins?.length){for(const origin of item.purchaseOrigins.slice(0,100))lines.push(`Purchase origin: ${origin.bundle?.title||'Unknown bundle'}; ${origin.purchaseDate||'date unknown'}; quantity ${origin.quantity||1}${origin.purchaseRef?'':' (legacy provenance)'}.`);if(item.purchaseOrigins.length>100)lines.push(`${item.purchaseOrigins.length-100} more origins retained in backup.`);}
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

  function bundleContents(parsed, matches) {
    const covered = new Map(); const uncertain = new Map(); const additional = new Map(); const perProduct = new Map();
    let noContentsProducts = 0; let incompleteProducts = 0;
    const rows = parsed.products.map((product, index) => ({ product, match: matches[index], target: offerContents(product) }));
    for (const { product, match, target } of rows) {
      for (const entry of match.coverage?.covered || []) covered.set(contentKey(entry), entry);
      // Exact product ownership can verify explicit catalog contents. Title
      // ranges alone cannot assert that a collection contains those units.
      if (['owned', 'owned-elsewhere'].includes(match.state) && product.contents?.length && !target.uncertain) {
        for (const entry of target.entries) if (entry.completeness === 'full' && entry.run && entry.language) covered.set(contentKey(entry), entry);
      }
      for (const entry of match.coverage?.possibleCovered || []) uncertain.set(contentKey(entry), entry);
    }
    for (const { product, match, target } of rows) {
      const available = parsed.kind !== 'pick-mix' || product.availability?.regionAvailable !== false && product.availability?.soldOut !== true && product.availability?.storeVisible !== false;
      if (!available) continue;
      if (!target.entries.length) { noContentsProducts++; continue; }
      if (match.lookupIncomplete || match.contentsLookupIncomplete || match.state === 'unchecked' || target.uncertain) incompleteProducts++;
      const units = new Set();
      for (const entry of target.entries) {
        if (entry.completeness !== 'full' || covered.has(contentKey(entry))) continue;
        const id = contentKey(entry);
        if (match.lookupIncomplete || match.contentsLookupIncomplete || match.state === 'unchecked' || target.uncertain || !entry.run || !entry.language || uncertain.has(id)) uncertain.set(id, entry);
        else if (!['owned', 'owned-elsewhere'].includes(match.state)) { additional.set(id, entry); units.add(id); }
        else uncertain.set(id, entry);
      }
      const existing = perProduct.get(product.sourceItemId) || new Set();
      for (const id of units) existing.add(id); perProduct.set(product.sourceItemId, existing);
    }
    for (const id of covered.keys()) { uncertain.delete(id); additional.delete(id); }
    for (const id of uncertain.keys()) additional.delete(id);
    const totals = new Set();
    const tiers = parsed.kind === 'standard' ? parsed.groups.map(group => {
      const raw = group.price?.USD; const price = (typeof raw === 'number' || typeof raw === 'string' && raw.trim()) && Number.isFinite(Number(raw)) && Number(raw) >= 0 ? Number(raw) : null;
      return { group, price };
    }).sort((left, right) => (left.price ?? Infinity) - (right.price ?? Infinity)).map(({ group, price }) => {
      for (const product of group.products) for (const id of perProduct.get(product.sourceItemId) || []) if (additional.has(id)) totals.add(id);
      return { price, additional: totals.size };
    }) : [];
    return { additional: [...additional.values()], covered: [...covered.values()], uncertain: [...uncertain.values()], noContentsProducts, incompleteProducts, tiers };
  }

  function readingUnit(entry, source, title) {
    // Analysis only: do not reinterpret catalog metadata or ownership badges.
    const labelled=source==='Title-derived comparison targets' && /\b(annual|special)\s+(?:#|issues?\s*)\d/iu.exec(title||'');
    return labelled?{...entry,unitType:labelled[1].toLowerCase(),series:entry.series.replace(/\s+(annual|special)$/iu,'')}:entry;
  }
  function readingTargets(products) {
    const groups = new Map(); let unknownScope = 0; let budget = 20000; let limited = false;
    for (const item of products) {
      if(item.mediaType && mediaType(item.mediaType)!=='book')continue;
      const target = offerContents(item);
      for (const original of target.entries) {
        const entry=readingUnit(original,target.source,item.title);
        if (entry.completeness !== 'full') continue;
        if (!entry.run || !entry.language || target.uncertain) { unknownScope++; continue; }
        const id = JSON.stringify([scopeKey(entry.series), scopeKey(entry.run), entry.unitType, scopeKey(entry.language)]);
        const group = groups.get(id) || { ...entry, offered: new Map() }; group.offered.set(contentKey(entry), entry); groups.set(id, group);
      }
    }
    const queries = [];
    for (const group of groups.values()) {
      if (budget <= 0 || queries.length >= 100) { limited = true; break; }
      const offered = [...group.offered.values()]; let entries = offered;
      const numbers = offered.map(entry => Number(entry.number)).filter(Number.isFinite);
      const first = Math.ceil(numbers.reduce((value, number) => Math.min(value, number), Infinity)); const last = Math.floor(numbers.reduce((value, number) => Math.max(value, number), -Infinity));
      let bounded = false;
      if (['issue', 'volume'].includes(group.unitType) && numbers.length === offered.length && last >= first) {
        if (last - first < 2000 && last - first < budget) {
          const template = offered[0];
          entries = [...new Map([...offered, ...Array.from({ length: last - first + 1 }, (_, index) => ({ ...template, number: String(first + index) }))].map(entry => [contentKey(entry), entry])).values()];
        } else bounded = true;
      }
      if (entries.length > Math.min(2000, budget)) { entries = entries.slice(0, Math.min(2000, budget)); bounded = true; }
      budget -= entries.length; limited ||= bounded;
      queries.push({ entries, offeredKeys: new Set(group.offered.keys()), bounded,
        item: { sourceItemId: `reading-${queries.length + 1}`, title: `${group.series} reading coverage`.slice(0, 500), mediaType: 'book', series: group.series, run: group.run, language: group.language, contents: entries, contentsComplete: false },
        label: `${group.series} (${group.run}) · ${group.unitType} · ${group.language}` });
    }
    return { queries, unknownScope, limited };
  }
  function readingCoverage(targets, local, lookup, centralEnabled = false) {
    const readingLocal=local.map(entry=>{
      const record=entry.evidence?.find(record=>record.provider==='fanatical'&&record.reason==='Title-derived comparison targets');
      return record?readingUnit(entry,record.reason,record.title):entry;
    });
    return targets.queries.map(query => {
      const result = lookup(query.item);
      return { ...query, coverage: coverageFor({ entries: query.entries, complete: false, uncertain: false }, readingLocal, result),
        lookupIncomplete: centralEnabled && !result?.coverage, externalResult: result, offered: query.item };
    });
  }

  function editionContentsEvidence(matches) {
    const entries = [];
    for (const match of matches) {
      if (match.state !== 'owned-elsewhere' || !match.offered?.contents?.length) continue;
      const source = match.item;
      if (!source || !permanent(source) || ['contains', 'same-work'].includes(source.relationship)) continue;
      const target = offerContents(match.offered);
      if (target.uncertain) continue;
      for (const entry of target.entries) if (entry.completeness === 'full') entries.push({ ...entry, evidence: [{ ...source, relationship: 'contains',
        reason: 'Confirmed offered edition plus explicit Fanatical catalog contents', evidence: { ...source.evidence, source: `${source.evidence?.source || source.provider}; explicit Fanatical catalog contents` } }] });
    }
    return entries;
  }

  function centralReminders(matches, now = Date.now()) {
    const reminders = []; const seen = new Set();
    const add = (record, type, text) => {
      const id = `${record.provider}:${record.itemRef || record.title}:${type}`;
      if (seen.has(id)) return; seen.add(id);
      reminders.push({ type, title: record.title || 'Unnamed central item', provider: record.provider || 'central library', text });
    };
    for (const match of matches) {
      const result = match.externalResult;
      if (!result) continue;
      const records = [...(result.matches || []), ...(result.possibleMatches || []), ...(result.partialMatches || []), ...(match.coverage?.covered || []).flatMap(entry => entry.evidence || []), ...(match.coverage?.possibleCovered || []).flatMap(entry => entry.evidence || [])];
      for (const record of records) {
        if (record.provider === 'fanatical') continue;
        if (!permanent(record) && !['owned', 'owned-elsewhere'].includes(match.state)) add(record, 'ownership', `${record.ownership || 'unknown'} ownership${['rental', 'borrowed', 'subscription'].includes(record.ownership) ? '; temporary access does not establish permanent ownership. Expiry dates are unavailable here.' : '; confirm purchase or permanent claim in Galactic Library.'}`);
        const observed = Date.parse(record.evidence?.checkedAt || '');
        const reviewed = Date.parse(record.verifiedAt || '');
        if (!Number.isFinite(observed)) add(record, 'freshness', 'Observation date unavailable; check provider sync and ownership evidence in Galactic Library.');
        else if (now - observed > 30 * 86400000) add(record, 'freshness', `Last observed ${record.evidence.checkedAt}; refresh provider sync. Age does not revoke a recorded permanent purchase.`);
        if (Number.isFinite(reviewed) && now - reviewed > 30 * 86400000) add(record, 'contents', `Contents reviewed ${record.verifiedAt}; review edition/contents if the offer differs.`);
      }
      if (match.coverage?.possibleCovered.length) reminders.push({ type: 'scope', title: match.offered?.title, provider: 'Galactic Library', text: 'Possible coverage needs run/language confirmation; review its contents scope.' });
      if (match.contentsLookupIncomplete) reminders.push({ type: 'coverage', title: match.offered?.title, provider: 'Galactic Library', text: 'Central contents coverage was not supplied. Refresh or update the paired library before treating units as absent.' });
    }
    return reminders;
  }

  async function companionCall(send,message,timeoutMs=GALACTIC_REQUEST_TIMEOUT_MS){
    let timer;try{const response=await Promise.race([send(message),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Connection timed out.')),timeoutMs);})]);if(response?.ok!==true)throw Error('Galactic Library rejected the request. Check pairing permission.');if(response.apiVersion!==1)throw Error('Incompatible Galactic Library API version.');return response;}catch(error){if(['Connection timed out.','Galactic Library rejected the request. Check pairing permission.','Incompatible Galactic Library API version.'].includes(error.message))throw error;throw Error('Galactic Library connection unavailable.');}finally{clearTimeout(timer);}
  }
  async function galacticCapabilities(send){
    const status=await companionCall(send,{type:'GET_STATUS'});if(status.ready===false)throw Error('Galactic Library is not ready.');const caps=status.capabilities;
    return {advertised:Boolean(caps&&typeof caps==='object'),mediaTypes:Array.isArray(caps?.mediaTypes)?caps.mediaTypes.filter(type=>['game','book','audiobook','software'].includes(type)):[],reviewedContents:caps?.reviewedContents===true,entitlementReminders:caps?.entitlementReminders===true};
  }
  async function testGalacticLink(send){const ping=await companionCall(send,{type:'PING'}),capabilities=await galacticCapabilities(send);return {appVersion:typeof ping.appVersion==='string'?ping.appVersion.slice(0,40):'',...capabilities};}

  async function loadCentralReminders(send,{provider='fanatical',offset=0,limit=50}={}){
    const providers=['steam','gog','epic','amazon-games','audible','kindle','amazon-video','fandango-at-home','kobo','fanatical','humble'];
    if(provider!==undefined&&provider!==''&&!providers.includes(provider)||!Number.isSafeInteger(offset)||offset<0||offset>1000000||!Number.isSafeInteger(limit)||limit<1||limit>200)throw Error('Invalid reminder page or provider.');
    const caps=await galacticCapabilities(send);if(!caps.entitlementReminders)throw Error('This Galactic Library version does not advertise entitlement reminders.');
    const response=await companionCall(send,{type:'GET_REMINDERS',apiVersion:1,offset,limit,...(provider?{provider}:{})});
    const invalid=()=>{throw Error('Galactic Library returned an invalid reminder page.');};
    if(!Number.isSafeInteger(response.total)||response.total<0||response.total>10000000||!Array.isArray(response.reminders)||response.reminders.length!==Math.max(0,Math.min(limit,response.total-offset))||response.nextOffset!==(offset+limit<response.total?offset+limit:null)||response.nextOffset!==null&&response.nextOffset>1000000)invalid();
    const seen=new Set(),safeText=(value,max)=>typeof value==='string'&&value.trim()&&value.length<=max;
    const reminders=response.reminders.map(row=>{
      if(!row||!safeText(row.reminderRef,256)||!safeText(row.itemRef,256)||!safeText(row.title,500)||seen.has(row.reminderRef)||!providers.includes(row.provider)||provider&&row.provider!==provider||!['game','game-addon','software','audiobook','book','movie','tv','unknown'].includes(row.mediaType)||!['activation','key-expiry','key-unavailable','access-expiry','temporary-access'].includes(row.kind)||!['information','due-soon','attention'].includes(row.severity))invalid();
      if(row.dueAt!==null&&(typeof row.dueAt!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(row.dueAt)||!Number.isFinite(Date.parse(row.dueAt))||new Date(row.dueAt).toISOString().slice(0,10)!==row.dueAt.slice(0,10)))invalid();
      if(['key-expiry','access-expiry'].includes(row.kind)&&row.dueAt===null)invalid();
      seen.add(row.reminderRef);return {reminderRef:row.reminderRef,itemRef:row.itemRef,title:row.title,provider:row.provider,mediaType:row.mediaType,kind:row.kind,dueAt:row.dueAt,severity:row.severity,...(row.source==='humble-companion'?{source:'humble-companion',reviewAvailable:false}:{})};
    });return {total:response.total,nextOffset:response.nextOffset,reminders};
  }

  // Store identities stay separate from user-saved pairing configuration.
  const COMPANION_IDENTITIES=Object.freeze({
    hb:Object.freeze({name:'Humble Comic Library',chrome:'bjjpfofmcmiipeghcbhdfjedpldmkcii',firefox:'humble-comic-library@galactichamster.com'}),
    gl:Object.freeze({name:'Galactic Library',chrome:'pdknncacndkicpogbebdfanniibnnpic',firefox:'galactic-library@galactichamster.com'}),
    fan:Object.freeze({name:'Fanatical Library',chrome:'ieoobffekgbfjfoiheejkfihneooiadb',firefox:'fanatical-library@galactichamster.com'})
  });
  function companionBrowser(runtime=globalThis.chrome?.runtime){return runtime?.getURL?.('').startsWith('moz-extension:')||runtime?.getManifest?.().browser_specific_settings?.gecko?'firefox':'chrome';}
  function builtinGalacticId(runtime=globalThis.chrome?.runtime){return COMPANION_IDENTITIES.gl[companionBrowser(runtime)];}
  function resolveGalacticId(saved,runtime=globalThis.chrome?.runtime){return String(saved??'').trim()||builtinGalacticId(runtime);}
  function trustedGalacticSender(senderId,saved,runtime=globalThis.chrome?.runtime){return senderId===builtinGalacticId(runtime)||isExtensionId(saved)&&senderId===String(saved).trim();}
  function companionTargetProblem(id,runtime=globalThis.chrome?.runtime){
    const browser=companionBrowser(runtime);
    if(!isExtensionId(id))return 'Enter a valid Chrome extension ID or Firefox add-on ID.';
    if(browser==='chrome'&&!/^[a-p]{32}$/u.test(id))return 'This saved add-on ID is not a Chrome target. It is preserved; use a Chrome ID in Advanced settings.';
    // This is the sender manifest, not the receiver policy. Receiver restrictions
    // cannot be inferred locally; failed sends never prove the target is absent.
    return '';
  }

  function isExtensionId(value) {
    const id = String(value ?? '').trim();
    return /^\{[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\}$/iu.test(id) || /^[a-p]{32}$/u.test(id) || /^[a-z0-9](?:[a-z0-9._+-]*[a-z0-9])?@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/iu.test(id);
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
    for(const item of Array.isArray(items)?items:[]){
      if(item?.source!=='fanatical')continue;
      for(const origin of item.purchaseOrigins?.length?item.purchaseOrigins:[item]){
        const bundle=origin.bundle,slug=String(bundle?.slug??'').trim().toLowerCase();if(!/^[a-z0-9-]+$/u.test(slug)||!bundle?.sourceItemId)continue;
        const previous=bundles.get(slug);if(!previous||Date.parse(origin.purchaseDate)>Date.parse(previous.purchaseDate))bundles.set(slug,{sourceItemId:String(bundle.sourceItemId),title:String(bundle.title??''),purchaseDate:origin.purchaseDate??null});
      }
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

  function purchaseImportScope(summary) {
    const purchases = count => `${count} purchase${count === 1 ? '' : 's'}`;
    if (summary.scanMode === 'full') return `Rescanned ${purchases(summary.ordersScanned)}; current snapshot rebuilt`;
    const parts = [summary.ordersScanned === 0 ? 'No new purchases'
      : summary.scanHistoryMissing ? `Rechecked ${purchases(summary.ordersScanned)} because saved scan history was unavailable`
      : `Checked ${summary.ordersScanned} new purchase${summary.ordersScanned === 1 ? '' : 's'}`];
    if (summary.ordersScanned === 0) parts.push('no purchase details to check');
    if (summary.ordersSkipped) parts.push(`skipped ${summary.ordersSkipped} unchanged purchase${summary.ordersSkipped === 1 ? '' : 's'}`);
    return parts.join('; ');
  }

  function purchaseImportProgress(progress) {
    if (!progress || typeof progress !== 'object') return null;
    const count = (value, max = 100000) => Number.isSafeInteger(value) && value >= 0 && value <= max;
    if (progress.phase === 'list') return count(progress.page,1000) && progress.page > 0 ? `Loading your purchase list: page ${progress.page}\u2026` : null;
    if (progress.phase === 'retry') return [2,3].includes(progress.attempt) ? `Retrying a purchase request (attempt ${progress.attempt} of 3)\u2026` : null;
    if (!['plan','details'].includes(progress.phase) || !count(progress.total) || !count(progress.skipped)
      || typeof progress.fullScan !== 'boolean' || typeof progress.scanHistoryMissing !== 'boolean') return null;
    const purchases = `${progress.total} purchase${progress.total === 1 ? '' : 's'}`;
    if (progress.phase === 'plan') {
      if (progress.fullScan) return `Rescanning all ${purchases}\u2026`;
      if (!progress.total) return purchaseImportScope({ordersScanned:0,ordersSkipped:progress.skipped}) + '\u2026';
      const action = progress.scanHistoryMissing ? `Rechecking ${purchases} because saved scan history is unavailable`
        : `Found ${progress.total} new purchase${progress.total === 1 ? '' : 's'}`;
      return action + (progress.skipped ? `; skipped ${progress.skipped} unchanged purchase${progress.skipped === 1 ? '' : 's'}` : '') + '\u2026';
    }
    if (!count(progress.completed) || progress.completed < 1 || progress.completed > progress.total) return null;
    const action = progress.fullScan ? 'Rescanning all purchases'
      : progress.scanHistoryMissing ? 'Rechecking purchase history (saved scan history unavailable)' : 'Importing new purchases';
    return `${action}: purchase ${progress.completed} of ${progress.total}\u2026`;
  }

  function normalizeSummaryPreferences(value={},strict=false) {
    const positions=['bottom-right','bottom-left','top-right','top-left'];
    if(strict&&(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['minimized','position'].includes(key))||Object.hasOwn(value,'minimized')&&typeof value.minimized!=='boolean'||Object.hasOwn(value,'position')&&!positions.includes(value.position)))throw new Error('Invalid bundle summary preferences.');
    return {minimized:value?.minimized===true,position:positions.includes(value?.position)?value.position:'bottom-right'};
  }

  async function storageSet(updates){const response=await chrome.runtime.sendMessage({type:'FANATICAL_STORE',operation:'patch',args:[updates]});if(!response?.ok)throw new Error(response?.error??'Settings storage is unavailable.');}
  global.FanaticalLibrary = { purchaseImportScope, purchaseImportProgress, normalizeSummaryPreferences, storageSet, normalizeTitle, titleKey, mediaType, compatibleMedia, trueKeys, externalIds, componentMetadata, validIsbn, bibliographicFields, scopeKey, numberKey, contentKey, contentsMetadata, plainProduct, parseBundle, isCompleteBundleCatalogue, isBundleOverlapProduct, classify, identityConflicts, offerContents, localContents, coverageFor, mergeGalactic, galacticRequestItems, galacticBatches, queryGalacticItems, sendGalacticMatch, flattenProducts, resolveProduct, overlayLabel, upsertBadge, unitLabel, explanationLines, centralReviewUrl, bundleContents, readingTargets, readingCoverage, editionContentsEvidence, centralReminders, loadCentralReminders, COMPANION_IDENTITIES, companionBrowser, builtinGalacticId, resolveGalacticId, trustedGalacticSender, companionTargetProblem, companionCall, galacticCapabilities, testGalacticLink, isExtensionId, standardTierCoverage, catalogueOffer, cataloguePageKind, purchasedBundleSlugs, catalogueDaysLeft };
}(globalThis));

/* Identical account picker in both companions; all changes use the serialized writer. */
(function(global){
  function mount(host,{request,keys,onActiveChange=()=>{}}){
    if(!host?.ownerDocument)return {refresh:async()=>{}};
    const details=document.createElement('details');details.className='account-manager';
    details.innerHTML='<summary>Saved accounts</summary><p>Use a saved account to restore its library and scan history. Sign in to that website account separately; this selector does not change your login. Only the active account is used for ownership checks.</p><label>Saved account <select data-account-list></select></label><label><input type="checkbox" data-account-confirm> The website is signed in to the selected account</label><div class="account-actions"><button type="button" data-account-use>Use saved account</button></div><label>New nickname for selected account <input data-account-name maxlength="100" placeholder="e.g. personal"></label><div class="account-actions"><button type="button" data-account-rename>Rename account</button></div><p>Renaming changes only this local name. For a new website account, enter a new nickname in the purchase importer and use Rescan all purchases with Save a new account selected.</p><p data-account-status role="status" aria-live="polite"></p>';
    host.append(details);
    const list=details.querySelector('[data-account-list]'),confirmed=details.querySelector('[data-account-confirm]'),name=details.querySelector('[data-account-name]'),use=details.querySelector('[data-account-use]'),rename=details.querySelector('[data-account-rename]'),status=details.querySelector('[data-account-status]');
    let data={activeLabel:'',profiles:[]},active,revision=0,busy=false;
    const controls=()=>{list.disabled=confirmed.disabled=name.disabled=busy||!data.profiles.length;use.disabled=busy||!list.value||list.value===data.activeLabel;rename.disabled=busy||!list.value;};
    async function refresh(){
      const generation=++revision;
      try{
        const next=await request('profiles');if(generation!==revision)return;
        const previous=active,selected=list.value;data=next;active=next.activeLabel;
        list.replaceChildren(...next.profiles.map(profile=>{const option=document.createElement('option');option.value=profile.label;option.textContent=profile.label+(profile.active?' (active)':'')+' - '+profile.itemCount+' items';return option;}));
        list.value=previous===active&&next.profiles.some(profile=>profile.label===selected)?selected:active||next.profiles[0]?.label||'';
        if(previous!==active||name.value===''){name.value=list.value;confirmed.checked=false;}
        details.querySelector('summary').textContent='Saved accounts ('+next.profiles.length+')'+(active?' - active: '+active:' - not yet named');
        controls();if(previous!==active)onActiveChange(active,previous);
      }catch(error){if(generation===revision)status.textContent='Could not load saved accounts: '+error.message;}
    }
    list.addEventListener('change',()=>{confirmed.checked=false;name.value=list.value;controls();});
    use.addEventListener('click',async()=>{
      if(!confirmed.checked){status.textContent='Confirm the website is signed in to the selected account first.';return;}
      const label=list.value;busy=true;controls();
      try{await request('selectProfile',{profileLabel:label,expectedActiveLabel:data.activeLabel,confirmed:true});await refresh();confirmed.checked=false;status.textContent='Using '+label+'. Its saved library is active; Import new purchases checks for changes without a mandatory full rescan.';}
      catch(error){status.textContent=error.message;await refresh();}finally{busy=false;controls();}
    });
    rename.addEventListener('click',async()=>{
      const label=list.value,next=name.value.trim();busy=true;controls();
      try{await request('renameProfile',{profileLabel:label,newLabel:next,expectedActiveLabel:data.activeLabel,confirmed:true});await refresh();list.value=next;name.value=next;confirmed.checked=false;status.textContent='Renamed '+label+' to '+next+'. Purchases and scan history were kept; no scan was started.';}
      catch(error){status.textContent=error.message;await refresh();}finally{busy=false;controls();}
    });
    chrome.storage.onChanged?.addListener((changes,area)=>{if(area==='local'&&keys.some(key=>changes[key]))refresh();});
    refresh();return {refresh};
  }
  global.LibraryAccountProfiles={mount};
}(globalThis));

// BEGIN SHARED BUNDLE MATCH CONTEXT
// Canonical source: GalacticLibrary/shared/bundle-match-context.js.
// Vendored unchanged in HB/FAN; synchronize with sync-companion-bundle-context.mjs.
(function installBundleMatchContext(global) {
  'use strict';
  // A priority projection only. Inputs/authoritative matches are never mutated.
  // offers: [{id, productKey, titleKey, title, media, protected, settled,
  //            candidates:[{id, libraryKey, strength, protected, basis}]}]
  // libraryKey is an opaque provider-record reference or a local object identity;
  // titles/ownership must NEVER be used as a substitute for library identity.
  function automaticTitleCandidate(basis) {
    const reason=String(basis||'');
    if(/\breviewed\b|user-supplied|shared (?:work|identifier|isbn|steam)|\bcontains\b|\bcomponents?\b|\bcontents?\b|\bcoverage\b/iu.test(reason))return false;
    return /related (?:complete base title|main title|title|book presentation)|subtitle|parenthetical|titles differ by an article|one (?:book )?title is a shortened or qualified presentation/iu.test(reason);
  }

  // Display scope only: never canonical identity, contents or ownership evidence.
  function numberedScope(title) {
    const words={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,i:1,ii:2,iii:3,iv:4,v:5,vi:6,vii:7,viii:8,ix:9,x:10};
    const text=String(title||'').trim();
    const match=/^(.*?)\s*(?:(book|vol(?:ume)?\.?|issue|annual|special)\s+|(#)\s*)(\d+(?:\.\d+)?|\d+\/\d+|one|two|three|four|five|six|seven|eight|nine|ten|i|ii|iii|iv|v|vi|vii|viii|ix|x)\s*$/iu.exec(text);
    if(!match||!match[1].replace(/[:,-]\s*$/u,'').trim())return null;
    const type=match[3]?'issue':match[2].toLowerCase().replace(/\.$/u,'');
    return {stem:match[1].replace(/[:,-]\s*$/u,'').trim(),type,number:String(words[match[4].toLowerCase()]||match[4]),label:match[3]?'issue #'+match[4]:match[2]+' '+match[4]};
  }
  function relevance({offeredTitle,title,media,relationship,basis,strong=false,unit=''}) {
    if(strong)return 'direct';
    if(relationship==='contains')return 'contents';
    if(/\breviewed\b|user-supplied|shared work identity/iu.test(basis||''))return 'reviewed';
    if(media!=='book'&&media!=='audiobook')return 'related';
    if(/^Numbered series item related to this title; collection membership and completeness are unconfirmed\./u.test(basis||''))return 'numbered-series';
    const offered=numberedScope(offeredTitle),candidate=numberedScope(title);
    if(!offered&&candidate&&global.LibraryMatchingPolicy.presentationTitle(candidate.stem,media)===global.LibraryMatchingPolicy.presentationTitle(offeredTitle,media))return 'numbered-series';
    if(offered&&!candidate&&!unit)return 'generic-numbered';
    return 'related';
  }
  function order(candidates) {
    const priorities=['direct','contents','reviewed','numbered-series','related','generic-numbered'];
    return candidates.map((candidate,index)=>({candidate,index})).sort((a,b)=>{
      const rank=value=>{const index=priorities.indexOf(value.relevance);return index<0?priorities.indexOf('related'):index;};
      return rank(a.candidate)-rank(b.candidate)||a.index-b.index;
    }).map(row=>row.candidate.id);
  }

  function reconcile({complete=false,offers=[]}={}) {
    const safe=complete===true && offers.length>1 && offers.every(offer=>offer.settled===true && offer.id && offer.productKey && offer.titleKey && offer.media)
      && new Set(offers.map(offer=>offer.id)).size===offers.length;
    const strong=new Map();
    if(safe)for(const offer of offers){
      if(offer.protected)continue;
      for(const candidate of offer.candidates||[]){
        if(candidate.strength!=='strong'||candidate.libraryKey==null)continue;
        const anchors=strong.get(candidate.libraryKey)||new Map();anchors.set(offer.id,offer);strong.set(candidate.libraryKey,anchors);
      }
    }
    const results=new Map();
    for(const offer of offers){
      const primary=[],deferred=[];
      for(const candidate of offer.candidates||[]){
        const titles=safe && !offer.protected && candidate.strength==='weak' && !candidate.protected && automaticTitleCandidate(candidate.basis)
          ? [...(strong.get(candidate.libraryKey)?.values()||[])].filter(anchor=>anchor.id!==offer.id && anchor.media===offer.media && anchor.productKey!==offer.productKey && anchor.titleKey!==offer.titleKey).map(anchor=>anchor.title):[];
        const competingTitles=[...new Set(titles)].sort((a,b)=>a<b?-1:a>b?1:0);
        if(competingTitles.length)deferred.push({id:candidate.id,competingTitles});else primary.push(candidate.id);
      }
      const primaryIds=new Set(primary);
      const ordered=order((offer.candidates||[]).filter(candidate=>primaryIds.has(candidate.id)));
      results.set(offer.id,{primary:ordered,deferred});
    }
    return {complete:safe,results};
  }
  global.BundleMatchContext=Object.freeze({reconcile,numberedScope,relevance,order});
}(globalThis));
// END SHARED BUNDLE MATCH CONTEXT

/* Purchasing summary presentation only: consumes, never changes, match states. */
(function(global) {
  const providerName = value => ({steam:'Steam',gog:'GOG',epic:'Epic Games',humble:'Humble Bundle',fanatical:'Fanatical',kindle:'Kindle',kobo:'Kobo',audible:'Audible','amazon-games':'Amazon Games'}[value] || String(value || 'another library').replaceAll('-', ' ').replace(/^./u, c=>c.toUpperCase()));
  function records(match) {
    return [match.item,match.localMatch?.item,...(match.historicalItems||[]),...(match.candidates||[]),...(match.externalMatches||[]),...(match.externalPossibleMatches||[]),...(match.externalResult?.matches||[]),...(match.externalResult?.possibleMatches||[]),...(match.externalResult?.partialMatches||[])].flat(Infinity).filter(Boolean);
  }
  function row(item, match) {
    const state = match.state === 'elsewhere' ? 'owned-elsewhere' : match.state;
    const candidates = records(match);
    const related = [...new Set(candidates.map(record=>(record.item||record).title).filter(Boolean))];
    const providers = state==='owned-elsewhere' ? [...new Set(candidates.filter(record=>record.provider).map(record=>providerName(record.provider)))] : [];
    const owned=match.range?.owned ?? match.owned ?? match.coverage?.owned;
    const total=match.range?.total ?? match.total ?? match.coverage?.total;
    return {title:item.title,state,providers,relatedTitle:related[0]||'',relatedTitles:related,
      fraction:state==='partial'&&Number.isFinite(owned)&&Number.isFinite(total)?`${owned}/${total} owned`:'',
      why:['possible','partial','unchecked'].includes(state)||Boolean(match.lookupIncomplete && state!=='owned'||match.mappingConflicts),
      ownershipReview:Boolean(match.ownershipReview)};
  }
  function summary(rows) {
    const items=rows.map(({item,match})=>row(item,match));
    const counts=Object.fromEntries(['owned','owned-elsewhere','new','partial','possible','unchecked'].map(state=>[state,items.filter(item=>item.state===state).length]));
    return {counts,items,sections:Object.keys(counts).filter(state=>counts[state]>0)};
  }
  // Display adapters only. No result objects, ownership decisions or storage are modified.
  const localProvider = "fanatical";
  const permanentRecord = record => ['owned','claimed'].includes(record.ownership);
  function status(item, match) {
    const state=match.state==='elsewhere'?'owned-elsewhere':match.state;
    if(state==='possible')return match.ownershipReview?'Check ownership':'Possible';
    if(state==='partial')return 'Partial';
    if(state==='unchecked')return 'Check incomplete';
    if(state==='owned-elsewhere')return 'Owned elsewhere';
    if(state==='owned')return localProvider==='humble' && [match.item].flat(Infinity).filter(Boolean).some(r=>(r.provenance?.length?r.provenance:[r]).some(p=>p.entitlement==='third-party-key')||r.kind==='game'&&r.source==='humble')?'Purchased':'Owned';
    return 'New';
  }
  function access(record, local=false) {
    const evidence=record.evidence||{};
    if(record.historical)return 'Previously recorded — current access needs review';
    if(evidence.ownershipBasis==='user-assumed-owned')return 'Treated as owned by your preference';
    const origins=record.provenance?.length?record.provenance:[record];
    if(local && origins.some(p=>p.entitlement==='third-party-key'))return 'Purchased key — activation not confirmed';
    if(record.ownership==='subscription')return 'Subscription access';
    if(record.ownership==='borrowed')return 'Borrowed access';
    if(record.ownership==='rental')return 'Rental access';
    if(record.ownership==='unknown')return 'Ownership not confirmed';
    if(local && (record.source===localProvider || origins.some(origin=>origin.purchaseKey || origin.sourceBundle || origin.bundle?.title)))return 'Purchased';
    if(permanentRecord(record))return 'Owned';
    return local?'Marked as owned locally':'Ownership not confirmed';
  }
  function readableDate(value) {
    if(!value)return '';
    const date=new Date(value);
    return Number.isNaN(date.valueOf())?'':date.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
  }
  const candidateFacts=new WeakMap(), bundlePriorities=new WeakMap();
  function candidateViews(item, match) {
    const entries=[], seenObjects=new Set(), seenRefs=new Set();
    const add=(values,local=false,confirmed=false,componentTitle='',exactResponse=false)=>{
      for(const wrapper of [values].flat(Infinity).filter(Boolean)){
        const record=wrapper.item||wrapper;
        if(!record.title || seenObjects.has(record))continue;
        const isLocal=local && (!record.provider || record.provider===localProvider) || !record.provider && (record.source===localProvider || Boolean(record.purchaseKey||record.sourceBundle||record.bundle));
        // Repeated references to the same response record are one card; distinct
        // accounts/access/provenance records are never merged by title.
        const ref=record.itemRef && JSON.stringify([record,wrapper.item?wrapper.reason:'']);
        if(ref && seenRefs.has(ref))continue;
        seenObjects.add(record);if(ref)seenRefs.add(ref);
        const provider=providerName(record.provider || (isLocal?localProvider:record.source||'another library'));
        const account=isLocal && (record.profileLabel||wrapper.profileLabel) ? String(record.profileLabel||wrapper.profileLabel):'';
        const basis=String(wrapper.reason||record.reason||'');
        const differences=global.FanaticalLibrary.identityConflicts(item,record,true);
        let uncertainty='';
        if(differences.some(x=>/ISBN/iu.test(x)))uncertainty='The ISBNs differ; check which edition you want.';
        else if(differences.some(x=>/language/iu.test(x)))uncertainty='The languages differ; check before buying.';
        else if(differences.some(x=>/author/iu.test(x)))uncertainty='The author details differ; check the title and edition.';
        else if(differences.some(x=>/issue|volume|run|series|unitType/iu.test(x)))uncertainty='The series, run or numbered contents differ; check the overlap.';
        else if(differences.some(x=>/revision|edition|package/iu.test(x)) || /revision|different edition|edition\/package|version wording/iu.test(basis))uncertainty='May be a different edition or version.';
        else if(/subtitle|article|related.*title/iu.test(basis))uncertainty='The titles differ; check whether they refer to the same work.';
        const sameEdition=record.relationship==='same-edition' || confirmed && isLocal;
        const contains=record.relationship==='contains';
        const label=access(record,isLocal);
        if(!uncertainty && !sameEdition && !contains && !confirmed)uncertainty='The relationship to this offer needs review.';
        const accessNote=record.historical?'This record was not observed in the latest completed import.':
          ['subscription','rental','borrowed'].includes(record.ownership)?'Permanent ownership is not confirmed.':record.ownership==='unknown'?'Confirm ownership before buying.':'';
        const origin=isLocal?(record.provenance?.[0]||record):{};
        const purchaseDate=readableDate(origin.purchasedAt||origin.purchaseDate||record.purchasedAt||record.purchaseDate);
        const bundle=origin.sourceBundle||origin.bundle?.title||record.sourceBundle||record.bundle?.title||'';
        const context=[bundle,purchaseDate?'Purchased '+purchaseDate:''].filter(Boolean).join(' · ');
        const annotations=[];
        if(!isLocal && record.provider===localProvider)annotations.push('Central copy; compare with this extension’s current purchases.');
        if(isLocal && record.provenance?.length>1)annotations.push('Additional purchase context is in Match details.');
        if(record.evidence?.ownershipBasis==='user-assumed-owned' && record.evidence.observedOwnership)annotations.push('Original access: '+access({ownership:record.evidence.observedOwnership}));
        if(record.evidence?.ownershipBasis==='dated-manual-confirmation')annotations.push('Your ownership review'+(readableDate(record.evidence.ownershipConfirmedAt)?' on '+readableDate(record.evidence.ownershipConfirmedAt):'')+'.');
        if(record.evidence?.availability==='not-observed-in-last-full-scan')annotations.push('Not observed in the latest full scan; current availability needs review.');
        if(['expired','unavailable'].includes(record.keyStatus||record.evidence?.keyStatus))annotations.push('Purchase recorded; key '+(record.keyStatus||record.evidence.keyStatus)+'.');
        const view={title:record.title,provider,account,access:label,heading:componentTitle?'Listed component':contains?'Included contents':sameEdition?'Same title found':isLocal && label.startsWith('Purchased')?'Possibly related purchase':'Library candidate',
          relationship:componentTitle?'Compared component: '+componentTitle+'.':contains?'Contains some of the compared contents.':sameEdition?'Matches this offer.':record.relationship==='same-work'?'Related work; edition is not confirmed.':'',uncertainty,accessNote,context,annotations};
        const localResult=match.localMatch||match;
        const localExact=isLocal && confirmed && localResult.state==='owned' && !localResult.range && !localResult.ownedReason && !localResult.componentMatches?.length
          && (localProvider==='humble'||/^exact (?:normalized title|Steam App ID|ISBN)$/u.test(localResult.reason||''));
        const centralExact=!isLocal && record.relationship==='same-edition';
        const fields=localProvider==='humble'?global.HumbleComicLibrary.bibliographicFields(item):global.FanaticalLibrary.bibliographicFields(item);
        const other=localProvider==='humble'?global.HumbleComicLibrary.bibliographicFields(record.evidence||record):global.FanaticalLibrary.bibliographicFields(record.evidence||record);
        const policy=localProvider==='humble'?global.HumbleComicLibrary:global.FanaticalLibrary;
        const isbnFor=row=>[row?.externalIds?.isbn,row?.isbn,row?.isbns,row?.evidence?.isbn].flat().map(policy.validIsbn).filter(Boolean);
        const ids=isbnFor(item),otherIds=isbnFor(record);
        const sharedId=ids.some(id=>otherIds.includes(id))||['asin','editionId','steamAppId'].some(key=>(item[key]||item.externalIds?.[key])&&(item[key]||item.externalIds?.[key])===(record[key]||record.externalIds?.[key]||record.evidence?.[key]));
        const strength=!record.historical&&!differences.length&&(localExact||centralExact)?'strong':'weak';
        const relevance=global.BundleMatchContext.relevance({offeredTitle:item.title,title:record.title,media:item.kind||item.mediaType,relationship:record.relationship,basis:basis||localResult.possibleReason||localResult.reason,strong:strength==='strong',unit:record.evidence?.unit||record.volume||record.issue});
        if(relevance==='numbered-series'){
          view.heading='Related numbered item';view.relationship='A numbered item in this title’s series.';
          view.uncertainty=(view.uncertainty?view.uncertainty+' ':'')+'Collection membership and completeness are unconfirmed; this does not establish ownership of the collected edition.';
        }else if(relevance==='generic-numbered'){
          view.heading='Related unnumbered title';
          view.uncertainty=(view.uncertainty?view.uncertainty+' ':'')+'This record does not identify '+global.BundleMatchContext.numberedScope(item.title).label+' or its contents. It may be another edition or a collection; overlap is unconfirmed.';
        }
        candidateFacts.set(view,{libraryKey:record.itemRef?JSON.stringify([record.provider,record.itemRef]):isLocal?record:null,
          strength,relevance,
          protected:Boolean(componentTitle||record.historical||record.relationship==='same-edition'||record.relationship==='contains'||sharedId||differences.length||fields.edition||other.edition||fields.volume||fields.issue||fields.unitType||other.volume||other.issue||other.unitType),
          basis:basis||localResult.possibleReason||localResult.reason||''});
        entries.push(view);
      }
    };
    add(match.externalMatches,false,match.state==='elsewhere'||match.state==='owned-elsewhere','',true);
    add(match.externalPossibleMatches);add(match.externalResult?.matches,false,false,'',true);add(match.externalResult?.possibleMatches);add(match.externalResult?.partialMatches);
    add(match.item,true,match.state==='owned');add(match.localMatch?.item,true,match.localMatch?.state==='owned');
    add(match.candidates,true);add(match.localMatch?.candidates,true);add(match.historicalItems,true);add(match.localMatch?.historicalItems,true);add(match.range?.items,true);add(match.localMatch?.range?.items,true);
    for(const entry of [...(match.coverage?.covered||[]),...(match.coverage?.possibleCovered||[])])add(entry.evidence);
    for(const component of match.componentMatches||[]){const title=component.offered?.title||component.item?.title||'listed component';add(component.item,true,component.state==='owned',title);add(component.externalMatches,false,false,title);add(component.externalPossibleMatches,false,false,title);add(component.externalResult?.matches,false,false,title);add(component.externalResult?.possibleMatches,false,false,title);}
    return entries;
  }

  function primaryCandidateViews(item,match) {
    const deferred=new Set((bundlePriorities.get(match)?.deferred||[]).map(entry=>entry.id));
    const views=candidateViews(item,match);
    const candidates=views.map((view,index)=>({id:String(index),...candidateFacts.get(view)})).filter(candidate=>!deferred.has(candidate.id));
    return global.BundleMatchContext.order(candidates).map(id=>views[Number(id)]);
  }
  function reconcileBundle(rows,{complete=false}={}) {
    const offers=rows.map(({item,match,target,overlapProtected,identityContext,contextIncomplete},index)=>{
      const media=item.kind||item.mediaType;
      const views=candidateViews(item,match);
      return {id:String(index),productKey:item.sourceItemId||global.LibraryMatchingPolicy.presentationTitle(item.lookupTitle||item.title,media),
        titleKey:global.LibraryMatchingPolicy.presentationTitle(item.lookupTitle||item.title,media),title:item.title,media,
        settled:['owned','elsewhere','owned-elsewhere','possible','partial','new'].includes(match.state)&&!match.lookupIncomplete&&!match.contentsLookupIncomplete&&!contextIncomplete,
        protected:Boolean(overlapProtected||target?.entries?.length||item.contents?.length||item.components?.length||match.coverage?.total||match.componentMatches?.length||/\b(?:pdf|epub|mobi|cbz|cbr|audiobook)\b/iu.test(item.format||item.title)),
        candidates:[...views.map((view,index)=>({id:String(index),...candidateFacts.get(view)})),
          ...candidateViews(item,{externalMatches:(identityContext?.matches||[]).filter(record=>record.relationship==='same-edition')}).map((view,index)=>({id:'identity-context-'+index,...candidateFacts.get(view)}))]};
    });
    const result=global.BundleMatchContext.reconcile({complete,offers});
    for(const [index,{match}]of rows.entries())bundlePriorities.set(match,result.results.get(String(index)));
    return {complete:result.complete,deferredCount:[...result.results.values()].reduce((total,value)=>total+value.deferred.length,0)};
  }
  function candidateCard(doc,view) {
    const card=doc.createElement('section');card.className='library-ui-candidate';
    const heading=doc.createElement('h3');heading.textContent=view.heading;card.append(heading);
    const title=doc.createElement('strong');title.textContent=view.title;card.append(title);
    const meta=doc.createElement('p');meta.className='library-ui-muted';meta.textContent=[view.provider,view.account,view.access].filter(Boolean).join(' \u00b7 ');card.append(meta);
    for(const text of [view.uncertainty||view.relationship,view.accessNote,view.context,...view.annotations].filter(Boolean)){const p=doc.createElement('p');p.textContent=text;card.append(p);}
    return card;
  }
  function renderDeferred(host,item,match) {
    const entries=bundlePriorities.get(match)?.deferred||[];if(!entries.length)return;
    const views=candidateViews(item,match),doc=host.ownerDocument;
    const cards=doc.createElement('div');cards.className='library-ui-candidates library-ui-deferred-candidates';
    for(const entry of entries){const view=views[Number(entry.id)];if(!view)continue;const card=candidateCard(doc,view);const note=doc.createElement('p');note.textContent='More closely matches another item in this bundle: '+entry.competingTitles.join('; ')+'.';card.append(note);cards.append(card);}
    host.append(cards);
  }

  function conclusion(item,match) {
    const view=row(item,match);
    if(view.state==='unchecked')return 'Galactic Library could not finish checking. No local match was found; retry before treating this item as new.';
    if(view.state==='partial')return (match.componentMatches?.length?'Some listed components are already in your library':'Some known contents are already in your library')+(view.fraction?' ('+view.fraction+')':'')+'. Check what remains; this does not establish ownership of the whole edition.';
    if(view.state==='possible') {
      if(candidateViews(item,match).length&&!primaryCandidateViews(item,match).length)return 'A related library item more closely matches another offer in this bundle. Review it in Match details before buying.';
      const sameTitleAccess=primaryCandidateViews(item,match).find(candidate=>candidate.heading==='Same title found' && ['Subscription access','Borrowed access','Rental access'].includes(candidate.access));
      if(match.ownershipReview && sameTitleAccess)return 'You have '+sameTitleAccess.access.toLowerCase()+' to a matching title, but permanent ownership is not confirmed.';
      if(primaryCandidateViews(item,match).some(candidate=>candidate.heading==='Related numbered item'))return 'Related numbered items were found. Review their access; membership in this collection and its complete contents are unconfirmed.';
      return match.ownershipReview?'A library item needs an ownership check. Review its access and any related editions before buying.':'A related library item was found. Check the edition or included contents before buying.';
    }
    if(view.state==='owned-elsewhere')return 'A linked library records a matching item as owned.';
    if(view.state==='owned')return status(item,match)==='Purchased'?'This item is in your local purchases. A purchased key does not confirm activation.':'This item is marked as owned in your local library.';
    return 'No match was found in the available library data.';
  }
  function tooltip(item,match) {
    const candidates=primaryCandidateViews(item,match);
    return [status(item,match),conclusion(item,match),...candidates.slice(0,2).map(c=>c.title+' · '+c.provider+' · '+c.access),candidates.length>2?'+'+(candidates.length-2)+' more candidates':'','Open the explanation for candidates and match details.'].filter(Boolean).join('\n');
  }
  function relatedCaption(item,match) {
    const candidates=primaryCandidateViews(item,match);if(!candidates.length)return bundlePriorities.get(match)?.deferred.length?'Related candidate in Match details; closer match elsewhere in this bundle.':'';
    const first=candidates[0];
    return first.title+' · '+first.provider+' · '+first.access+(candidates.length>1?' · +'+(candidates.length-1)+' more':'');
  }
  function renderCandidates(host,item,match) {
    const doc=host.ownerDocument;
    const primary=doc.createElement('strong');primary.className='library-ui-match-status';primary.textContent=status(item,match);host.insertBefore(primary,host.querySelector('.hcl-explanation, .fanatical-library-explanation'));
    const cards=doc.createElement('div');cards.className='library-ui-candidates';
    for(const view of primaryCandidateViews(item,match))cards.append(candidateCard(doc,view));
    if(cards.children.length)host.append(cards);
    if(bundlePriorities.get(match)?.deferred.length){const note=doc.createElement('p');note.className='library-ui-muted';note.textContent='Related candidates that more closely match another bundle item are in Match details.';host.append(note);}
    if(match.lookupIncomplete||match.contentsLookupIncomplete){const note=doc.createElement('p');note.className='library-ui-warning';note.textContent='Some checks are incomplete. These results include available evidence; missing results do not prove an item is new.';host.append(note);}
    if(match.coverage?.scopeUncertain){const note=doc.createElement('p');note.textContent='The contents comparison needs series/run or language confirmation.';host.append(note);}
  }

  global.FanaticalLibrary.presentation={providerName,records,row,summary,explanation:conclusion,status,access,candidateViews,tooltip,relatedCaption,renderCandidates,primaryCandidateViews,reconcileBundle,renderDeferred};
}(globalThis));
