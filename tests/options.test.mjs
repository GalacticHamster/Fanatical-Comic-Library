import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { backupRestoreState, createLibraryBackup, parseLibraryBackup } from '../src/library-data.mjs';
import '../src/shared.js';

const code = fs.readFileSync(new URL('../src/options.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/u, '');
const item = (title, id = 'product-123456') => ({ source: 'fanatical', sourceItemId: id, title, mediaType: 'game', bundle: { sourceItemId: 'bundle-123456', title: 'Test bundle' }, purchaseDate: null });

async function optionsHarness(initial = {}) {
  const stored = structuredClone(initial); const writes = []; const messages = []; const nodes = new Map();
  const element = () => ({ textContent: '', value: '', checked: false, disabled: false, files: [], children: [], listeners: {}, addEventListener(type, handler) { this.listeners[type] = handler; }, replaceChildren(...children) { this.children = children; }, click() {} });
  const get = (selector) => { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); };
  const config = { confirm: true, response: { ok: true, apiVersion: 1, appVersion: '0.1.0' }, failure: false };
  const context = vm.createContext({
    document: { querySelector: get, createElement: element },
    chrome: { runtime: { id: 'a'.repeat(32), async sendMessage(id, message) { messages.push({ id, message }); if (config.failure) throw new Error('PRIVATE transport failure'); return config.response; } }, storage: { local: {
      async get(defaults) { return { ...defaults, ...stored }; },
      async set(value) { writes.push(structuredClone(value)); Object.assign(stored, structuredClone(value)); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; }
    } }, tabs: { create() {} } },
    confirm: () => config.confirm, FanaticalLibrary: globalThis.FanaticalLibrary,
    backupRestoreState, createLibraryBackup, parseLibraryBackup, Blob, URL, setTimeout, clearTimeout
  });
  await vm.runInContext(code, context);
  return { stored, writes, messages, get, config, async click(selector) { await get(selector).listeners.click(); }, async upload(value, raw = false) {
    const contents = raw ? value : JSON.stringify(value);
    get('#import-file').files = [{ size: contents.length, text: async () => contents }];
    await get('#import-file').listeners.change();
  } };
}

test('options preview is bounded, naturally ordered, and displays bundle provenance safely', async () => {
  const ui = await optionsHarness({ fanaticalLibraryItems: [item('Comic #10'), item('Comic #2'), ...Array.from({ length: 50 }, (_, index) => item(`Z ${index}`))] });
  assert.equal(ui.get('#library-preview').children.length, 50);
  assert.deepEqual(ui.get('#library-preview').children.slice(0, 2).map((row) => row.textContent), ['Comic #2 — Test bundle', 'Comic #10 — Test bundle']);
  assert.match(ui.get('#preview-note').textContent, /50 of 52/);
  assert.equal(ui.get('#fanatical-extension-id').textContent, 'a'.repeat(32));
});

test('invalid or cancelled backup import never changes storage', async () => {
  const ui = await optionsHarness({ fanaticalLibraryItems: [item('Keep me')] });
  await ui.upload('not JSON', true); assert.equal(ui.writes.length, 0);
  await ui.upload({ schemaVersion: 2, items: [] }); assert.equal(ui.writes.length, 0);
  ui.config.confirm = false;
  await ui.upload({ schemaVersion: 1, items: [item('Replacement')] });
  assert.equal(ui.writes.length, 0);
  assert.match(ui.get('#import-status').textContent, /cancelled/);
  assert.equal(ui.get('#import-file').disabled, false);
});

test('confirmed restore updates the preview and resets scan history while preserving settings', async () => {
  const ui = await optionsHarness({ fanaticalLibraryItems: [item('Old')], fanaticalImportSummary: { scanMode: 'quick' }, fanaticalScannedOrderFingerprints: ['a'.repeat(64)], fanaticalLastScanAttempt: { status: 'incomplete' }, galacticLibraryExtensionId: 'b'.repeat(32), fanaticalShowDiagnostics: true });
  await ui.upload({ schemaVersion: 1, items: [item('Restored')], orderFingerprints: ['b'.repeat(64)], summary: { importedAt: 'not trusted' } });
  assert.equal(ui.writes.length, 1);
  assert.equal(ui.stored.fanaticalLibraryItems[0].title, 'Restored');
  assert.deepEqual(ui.stored.fanaticalScannedOrderFingerprints, []);
  assert.equal(ui.stored.fanaticalImportSummary, null);
  assert.equal(ui.stored.fanaticalLastScanAttempt, null);
  assert.equal(ui.stored.galacticLibraryExtensionId, 'b'.repeat(32));
  assert.equal(ui.stored.fanaticalShowDiagnostics, true);
  assert.equal(ui.get('#library-preview').children[0].textContent, 'Restored — Test bundle');
});

test('options disclose incomplete coverage while retaining the last successful scan and library preview', async () => {
  const ui = await optionsHarness({ fanaticalLibraryItems: [item('Kept')], fanaticalLastScanAttempt: { status: 'incomplete' },
    fanaticalImportSummary: { scanMode: 'full', addedProducts: 1, ordersScanned: 1, importedAt: '2026-10-01T12:00:00Z', historyCoverage: 'Validated 1 listed order.' } });
  assert.match(ui.get('#history-note').textContent, /Last scan incomplete/);
  assert.match(ui.get('#history-note').textContent, /Validated 1 listed order/);
  assert.match(ui.get('#last-import').textContent, /Last full scan/);
  assert.match(ui.get('#library-preview').children[0].textContent, /Kept/);
  await ui.click('#reset');
  assert.equal('fanaticalLastScanAttempt' in ui.stored, false);
  assert.equal(ui.get('#history-note').textContent.includes('incomplete'), false);
});

test('scan request diagnostics are opt-in', async () => {
  const summary = { historyCoverage: 'Validated 25 pages.', coverage: { retries: 2, concurrency: 3 } };
  const plain = await optionsHarness({ fanaticalImportSummary: summary });
  assert.equal(plain.get('#history-note').textContent.includes('retries'), false);
  const diagnostic = await optionsHarness({ fanaticalImportSummary: summary, fanaticalShowDiagnostics: true });
  assert.match(diagnostic.get('#history-note').textContent, /2 retries; at most 3 concurrent/);
});

test('Galactic test validates IDs and API compatibility without saving or transferring library data', async () => {
  const ui = await optionsHarness();
  ui.get('#galactic-id').value = 'invalid'; await ui.click('#test-galactic'); assert.equal(ui.messages.length, 0);
  ui.get('#galactic-id').value = 'b'.repeat(32); await ui.click('#test-galactic');
  assert.equal(JSON.stringify(ui.messages), JSON.stringify([{ id: 'b'.repeat(32), message: { type: 'PING' } }]));
  assert.match(ui.get('#galactic-status').textContent, /Connected/); assert.equal(ui.writes.length, 0);
  ui.config.response.apiVersion = 2; await ui.click('#test-galactic'); assert.match(ui.get('#galactic-status').textContent, /Could not connect/);
  ui.config.failure = true; await ui.click('#test-galactic');
  assert.equal(ui.get('#galactic-status').textContent.includes('PRIVATE'), false);
  assert.equal(ui.get('#test-galactic').disabled, false);
});

test('save/remove Galactic link and diagnostics switch persist only their intended settings', async () => {
  const ui = await optionsHarness({ fanaticalLibraryItems: [item('Kept')] });
  ui.get('#galactic-id').value = 'b'.repeat(32); await ui.click('#save-galactic');
  assert.equal(ui.stored.galacticLibraryExtensionId, 'b'.repeat(32));
  await ui.click('#remove-galactic'); assert.equal('galacticLibraryExtensionId' in ui.stored, false);
  assert.equal(ui.get('#galactic-id').value, '');
  ui.get('#show-diagnostics').checked = true; await ui.get('#show-diagnostics').listeners.change();
  assert.equal(ui.stored.fanaticalShowDiagnostics, true);
  assert.equal(ui.stored.fanaticalLibraryItems[0].title, 'Kept');
});
