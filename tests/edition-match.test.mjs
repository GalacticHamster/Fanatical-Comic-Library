import assert from 'node:assert/strict';
import test from 'node:test';
import '../src/shared.js';
import { parseBundle } from '../src/bundle-parser.mjs';

const F = globalThis.FanaticalLibrary;
const base = { source: 'fanatical', sourceItemId: 'base-123456', title: 'Space Adventure', mediaType: 'game', externalIds: { steamAppId: '42' } };
const deluxe = { sourceItemId: 'deluxe-123456', title: 'Space Adventure Deluxe Edition', mediaType: 'game', externalIds: { steamAppId: '42' } };
const bonus = { sourceItemId: 'bonus-123456', title: 'Space Adventure Bonus Content', mediaType: 'game', externalIds: { steamAppId: '42' } };

test('base game and deluxe package with the same Steam App ID remain Possible in both directions', () => {
  for (const [candidate, library] of [[deluxe, [base]], [base, [{ ...deluxe, source: 'fanatical' }]]]) {
    const match = F.classify(candidate, library);
    assert.equal(match.state, 'possible');
    assert.equal(match.editionDifference, true);
    assert.equal(match.item.title, library[0].title);
    assert.match(match.reason, /Shared Steam App ID.*base game only/);
    assert.ok(match.reason.includes(candidate.title));
    assert.ok(match.reason.includes(library[0].title));
  }
});

test('known named editions do not become owned from shared base App IDs', () => {
  for (const edition of ['Gold Edition', 'Ultimate Edition', 'Definitive Edition', "Collector’s Edition", 'Game of the Year Edition', 'Bastille Edition', 'Legacy Package', 'Remaster', 'Bonus Content']) {
    assert.equal(F.classify({ ...deluxe, title: `Space Adventure ${edition}` }, [base]).state, 'possible');
  }
  assert.equal(F.classify({ ...deluxe, title: 'Doom Deluxe Edition' }, [{ ...base, title: 'Doom' }]).state, 'possible');
});

test('exact Fanatical product ownership stays authoritative for a purchased edition', () => {
  const match = F.classify(deluxe, [{ ...deluxe, source: 'fanatical' }, base]);
  assert.equal(match.state, 'owned');
  assert.equal(match.reason, 'exact Fanatical product ID');
});

test('shared App ID indexes retain all editions and prefer a matching purchased edition', () => {
  for (const library of [[base, { ...deluxe, sourceItemId: 'owned-deluxe-123456' }], [{ ...deluxe, sourceItemId: 'owned-deluxe-123456' }, base]]) {
    const match = F.classify(deluxe, library);
    assert.equal(match.state, 'owned');
    assert.equal(match.item.title, deluxe.title);
  }
});

test('one known component yields verified Partial even when all component App IDs equal the base ID', () => {
  const match = F.classify({ ...deluxe, components: [base, bonus] }, [base]);
  assert.equal(match.state, 'partial');
  assert.equal(match.owned, 1);
  assert.equal(match.total, 2);
  assert.equal(match.item.title, base.title);
  assert.match(match.reason, /Verified 1\/2/);
  assert.equal(match.editionDifference, true);
});

test('all explicitly known components can prove a package fully owned; duplicates count once', () => {
  const match = F.classify({ ...deluxe, components: [base, base, bonus] }, [base, { ...bonus, source: 'fanatical' }]);
  assert.equal(match.state, 'owned');
  assert.equal(match.reason, 'all enumerable components owned');
});

test('same-title/shared-App-ID package cannot bypass an explicit unowned component', () => {
  const match = F.classify({ ...base, sourceItemId: 'package-123456', components: [base, bonus] }, [base]);
  assert.equal(match.state, 'partial');
  assert.equal(match.owned, 1);
});

test('normalized-title format stripping cannot hide a soundtrack package difference', () => {
  const match = F.classify({ ...deluxe, externalIds: {}, title: 'Space Adventure Soundtrack' }, [base]);
  assert.equal(match.state, 'possible');
  assert.equal(match.editionDifference, true);
});

test('ordinary base-game aliases keep Steam ID ownership and Standard is treated as base', () => {
  assert.equal(F.classify({ ...base, sourceItemId: 'renamed-123456', title: 'Renamed Adventure' }, [base]).state, 'owned');
  assert.equal(F.classify({ ...base, sourceItemId: 'standard-123456', title: 'Space Adventure Standard Edition' }, [base]).state, 'owned');
});

test('qualifying titles with a shared App ID but no exact edition identity need review', () => {
  assert.equal(F.classify({ ...deluxe, title: 'Renamed Adventure Deluxe Edition' }, [{ ...deluxe, sourceItemId: 'owned-deluxe-123456' }]).state, 'possible');
});

test('catalogue component metadata is allowlisted and reaches the matcher', () => {
  const parsed = parseBundle({ _id: 'bundle-123456', name: 'Games', bundles: [{ games: [{ _id: deluxe.sourceItemId, name: deluxe.title, type: 'game', steam: { id: 42 }, components: [
    { _id: base.sourceItemId, name: base.title, type: 'game', steam: { id: 42, key: 'SECRET' }, email: 'SECRET' },
    { _id: bonus.sourceItemId, name: bonus.title, type: 'game', steam: { id: 42 } }
  ] }] }] });
  assert.equal(JSON.stringify(parsed).includes('SECRET'), false);
  assert.equal(F.classify(parsed.products[0], [base]).state, 'partial');
});

test('incomplete component metadata cannot prove complete ownership', () => {
  const metadata = F.componentMetadata([{ _id: base.sourceItemId, name: base.title, type: 'game' }, { _id: bonus.sourceItemId }]);
  assert.equal(metadata.componentCoverageUnknown, true);
  const match = F.classify({ ...deluxe, ...metadata }, [base]);
  assert.equal(match.state, 'possible');
  assert.match(match.reason, /unreadable/);
});

test('Galactic edition relationships retain the owned title and do not bypass known differences', () => {
  const related = { provider: 'steam', title: base.title, ownership: 'owned' };
  for (const result of [{ matches: [related] }, { possibleMatches: [related] }]) {
    const match = F.mergeGalactic({ state: 'new' }, result, deluxe);
    assert.equal(match.state, 'possible');
    assert.equal(match.item.title, base.title);
    assert.equal(match.editionDifference, true);
    assert.equal(match.provenance, 'steam');
  }
  const local = F.classify(deluxe, [base]);
  assert.equal(F.mergeGalactic(local, { matches: [{ provider: 'steam', ownership: 'owned' }] }, deluxe), local);
  assert.equal(F.mergeGalactic(local, { matches: [{ ...related, title: deluxe.title }] }, deluxe).state, 'owned-elsewhere');
});

test('edition review and Partial packages do not inflate the confirmed-new recommendation', () => {
  const review = F.classify(deluxe, [base]);
  const partial = F.classify({ ...deluxe, components: [base, bonus] }, [base]);
  const newProduct = { sourceItemId: 'new-123456', title: 'New Game', mediaType: 'game' };
  for (const match of [review, partial]) {
    const parsed = { products: [newProduct, deluxe], groups: [{ price: { USD: 100 }, products: [newProduct] }, { price: { USD: 1000 }, products: [deluxe] }] };
    assert.equal(F.standardTierCoverage(parsed, [{ state: 'new' }, match]).recommendedPrice, 100);
  }
});
