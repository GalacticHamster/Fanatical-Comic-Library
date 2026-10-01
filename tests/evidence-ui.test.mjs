import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import '../src/shared.js';
const F = globalThis.FanaticalLibrary;

test('inspector explains actual titles, edition differences, rule scores and evidence freshness without private IDs', () => {
  const match = { state: 'possible', offered: { title: 'Dune Fifth Edition', mediaType: 'book', language: 'en' },
    item: { title: 'Dune First Edition', provider: 'kindle', itemRef: 'SECRET-OPAQUE', ownership: 'owned', relationship: 'same-work', confidence: 0.75,
      evidence: { edition: 'first', source: 'Reviewed relationship', checkedAt: '2026-09-30', downloadUrl: 'SECRET-URL' } },
    externalResult: {}, lookupIncomplete: true };
  const explanation = F.explanationLines(match, '2026-10-01').join('\n');
  for (const text of ['Dune Fifth Edition', 'Dune First Edition', 'same-work', '0.75', 'not a calibrated probability', 'Reviewed relationship', '2026-09-30', '2026-10-01', 'incomplete']) assert.ok(explanation.includes(text), text);
  assert.equal(explanation.includes('SECRET'), false);
});

test('central review navigation trusts stored pairing and own sender, never caller URLs', async () => {
  const source = fs.readFileSync(new URL('../src/service-worker.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/mu, '');
  const urls = []; let listener; let id = 'b'.repeat(32);
  const chrome = { runtime: { id: 'a'.repeat(32), onMessage: { addListener(handler) { listener = handler; } } },
    storage: { local: { get: async () => ({ galacticLibraryExtensionId: id }) } }, tabs: { create: async data => urls.push(data.url) } };
  vm.runInNewContext(source, { chrome, FanaticalLibrary: F });
  const send = sender => new Promise(resolve => listener({ type: 'FANATICAL_OPEN_GALACTIC_REVIEW', url: 'https://evil.example' }, sender, resolve));
  assert.equal((await send({ id: 'other' })).ok, false); assert.equal(urls.length, 0);
  assert.equal((await send({ id: chrome.runtime.id })).ok, true);
  assert.deepEqual(urls, ['chrome://extensions/?options=' + id]);
  id = 'galactic@example.test';
  const fallback = await send({ id: chrome.runtime.id });
  assert.equal(fallback.ok, false); assert.match(fallback.error, /toolbar/); assert.equal(urls.length, 1);
});
