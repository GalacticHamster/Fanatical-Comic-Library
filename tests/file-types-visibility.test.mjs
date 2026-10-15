import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { backupRestoreState, createLibraryBackup, parseLibraryBackup, createSyncStore, createTitleCatalog } from '../src/library-data.mjs';
import { projectOrderHistory } from '../src/projection.mjs';
import '../src/shared.js';

const optionsCode = fs.readFileSync(new URL('../src/options.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/u, '');

const plain = (v) => JSON.parse(JSON.stringify(v));

function element() {
  const classes = new Set();
  return {
    listeners: {}, files: [], value: '', children: [], dataset: {}, disabled: false, hidden: false,
    classList: {
      add(...cls) { cls.forEach(c => classes.add(c)); },
      remove(...cls) { cls.forEach(c => classes.delete(c)); },
      toggle(c, force) {
        if (force === true) classes.add(c);
        else if (force === false) classes.delete(c);
        else if (classes.has(c)) classes.delete(c);
        else classes.add(c);
      },
      contains(c) { return classes.has(c); }
    },
    addEventListener(type, handler) { this.listeners[type] = handler; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this[name] = value; },
    getAttribute(name) { return this[name] ?? null; },
    click() {}
  };
}

async function createOptionsHarness(initial = {}) {
  const stored = structuredClone(initial);
  const sessionData = new Map();
  const nodes = new Map();
  const get = (sel) => {
    if (!nodes.has(sel)) nodes.set(sel, element());
    return nodes.get(sel);
  };

  const context = vm.createContext({
    document: { querySelector: get, createElement: element },
    sessionStorage: {
      getItem(key) { return sessionData.get(key) ?? null; },
      setItem(key, value) { sessionData.set(key, String(value)); },
      removeItem(key) { sessionData.delete(key); },
      clear() { sessionData.clear(); }
    },
    chrome: {
      runtime: { id: 'a'.repeat(32) },
      storage: {
        local: {
          async get(defaults) { return { ...structuredClone(defaults), ...structuredClone(stored) }; },
          async set(value) { Object.assign(stored, plain(value)); },
          async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; }
        }
      },
      tabs: { create() {} }
    },
    confirm: () => true,
    alert: () => {},
    LibraryTitleSort: globalThis.LibraryTitleSort,
    LibraryAccountProfiles: globalThis.LibraryAccountProfiles,
    FanaticalLibrary: globalThis.FanaticalLibrary,
    backupRestoreState, createLibraryBackup, parseLibraryBackup, createTitleCatalog,
    Blob, URL, setTimeout, clearTimeout, Intl
  });

  const store = createSyncStore(context.chrome.storage.local);
  context.chrome.runtime.sendMessage = async (...args) => {
    const message = args[0];
    if (message?.type !== 'FANATICAL_STORE') return { ok: true };
    try {
      return { ok: true, result: await store.execute(message.operation, message.args) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  await vm.runInContext(optionsCode, context);
  return {
    stored, get, context, sessionData,
    async change(sel, val) {
      const el = get(sel);
      if (val !== undefined) el.value = val;
      await el.listeners.change?.();
    },
    async click(sel) {
      await get(sel).listeners.click?.();
    }
  };
}

test('Fanatical file-type extraction: extracts distinct download formats from source metadata', async () => {
  const orderSummary = [{ _id: 'order-123456', status: 'COMPLETE' }];
  const orderDetail = [{
    _id: 'order-123456',
    status: 'COMPLETE',
    date: '2026-02-01T00:00:00.000Z',
    items: [{
      _id: 'bundle-123456',
      name: 'Creative Assets Bundle',
      bundles: [{
        games: [{
          _id: 'product-123456',
          name: 'Fantasy Asset Pack',
          type: 'software',
          downloads: [
            { files: [{ format: 'unitypackage' }, { format: 'blend' }] },
            { files: [{ format: 'zip' }, { format: 'blend' }] }
          ]
        }]
      }]
    }]
  }];

  const projection = await projectOrderHistory(orderSummary, orderDetail);
  assert.equal(projection.items.length, 1);
  const item = projection.items[0];
  assert.deepEqual(item.formats, ['blend', 'unitypackage', 'zip']);
  assert.equal(item.mediaType, 'software');
});

test('Fanatical options: displays formats and missing format indicator in expanded item details', async () => {
  const itemWithFormats = {
    source: 'fanatical',
    sourceItemId: 'item_with_formats',
    title: 'Multi-Format Comic',
    mediaType: 'comic',
    delivery: 'direct-download',
    formats: ['pdf', 'epub', 'cbz'],
    bundle: { title: 'Comics Bundle 2026' },
    purchaseDate: '2026-03-01T00:00:00.000Z'
  };

  const itemWithoutFormats = {
    source: 'fanatical',
    sourceItemId: 'item_unclassified_no_formats',
    title: 'Unknown Digital Pack',
    mediaType: 'unclassified',
    delivery: 'direct-download',
    formats: [],
    bundle: { title: 'Mystery Bundle' },
    purchaseDate: '2026-03-02T00:00:00.000Z'
  };

  const ui = await createOptionsHarness({
    fanaticalLibraryItems: [itemWithFormats, itemWithoutFormats]
  });

  const preview = ui.get('#library-preview');
  assert.equal(preview.children.length, 2);

  // Check item 1 with formats
  const row1 = preview.children[0];
  const sec1 = row1.children[0].children[1].children[0].children.find(c => c.className === 'library-provenance-secondary');
  assert(sec1, 'row1 secondary details must exist');
  assert.match(sec1.textContent, /Direct download/);
  assert.match(sec1.textContent, /Formats: \.pdf, \.epub, \.cbz/);

  // Check item 2 without formats (explicit "File formats unavailable")
  const row2 = preview.children[1];
  const sec2 = row2.children[0].children[1].children[0].children.find(c => c.className === 'library-provenance-secondary');
  assert(sec2, 'row2 secondary details must exist');
  assert.match(sec2.textContent, /Direct download/);
  assert.match(sec2.textContent, /File formats unavailable/);
});

test('Fanatical options: manual media-type override and reset to automatic', async () => {
  const item = {
    source: 'fanatical',
    sourceItemId: 'item_to_override',
    title: 'Graphic Novel Collection',
    mediaType: 'book',
    bundle: { title: 'Book Bundle' }
  };

  const ui = await createOptionsHarness({
    fanaticalLibraryItems: [item],
    mediaTypeOverrides: {}
  });

  const row = ui.get('#library-preview').children[0];
  const details = row.children[0];
  const classRow = details.children.find(c => c.className === 'library-classification-row');
  assert(classRow, 'classification row must be rendered');

  const badge = classRow.children[0];
  assert.equal(badge.textContent, 'Book');

  const select = classRow.children.find(c => c.className === 'library-classification-select');
  assert(select, 'classification select must exist');

  // Override to 'comic'
  select.value = 'comic';
  await select.listeners.change?.({ stopPropagation() {} });

  assert.equal(ui.stored.mediaTypeOverrides['item_to_override'], 'comic');
  assert.equal(ui.stored.fanaticalLibraryItems[0].mediaType, 'comic');
  assert.equal(ui.stored.fanaticalLibraryItems[0].manualMediaType, 'comic');
  assert.equal(ui.stored.fanaticalLibraryItems[0].automaticMediaType, 'book');

  // Verify UI after refresh displays user override note and Reset button
  const updatedRow = ui.get('#library-preview').children[0];
  const updatedDetails = updatedRow.children[0];
  const updatedClassRow = updatedDetails.children.find(c => c.className === 'library-classification-row');
  const note = updatedClassRow.children.find(c => c.className === 'library-classification-note');
  assert.match(note.textContent, /User override \(automatic: Book\)/);

  const resetBtn = updatedClassRow.children.find(c => c.className?.includes('library-reset-classification-btn'));
  assert(resetBtn, 'Reset button must be visible when overridden');

  // Click reset button
  await resetBtn.listeners.click?.({ stopPropagation() {} });

  assert.equal(ui.stored.mediaTypeOverrides['item_to_override'], undefined);
  assert.equal(ui.stored.fanaticalLibraryItems[0].mediaType, 'book');
  assert.equal(ui.stored.fanaticalLibraryItems[0].manualMediaType, undefined);
});

test('Fanatical options: classification diagnostics pills count media types and rejected items', async () => {
  const items = [
    { source: 'fanatical', sourceItemId: 'i1', title: 'Comic 1', mediaType: 'comic' },
    { source: 'fanatical', sourceItemId: 'i2', title: 'Book 1', mediaType: 'book' },
    { source: 'fanatical', sourceItemId: 'i3', title: 'Game 1', mediaType: 'game' },
    { source: 'fanatical', sourceItemId: 'i4', title: 'Software 1', mediaType: 'software' },
    { source: 'fanatical', sourceItemId: 'i5', title: 'Audiobook 1', mediaType: 'audiobook' },
    { source: 'fanatical', sourceItemId: 'i6', title: 'Video 1', mediaType: 'video' },
    { source: 'fanatical', sourceItemId: 'i7', title: 'Unclassified 1', mediaType: 'unclassified' }
  ];

  const rejected = [
    { sourceItemId: 'rej_1', title: 'Promo Voucher', reason: 'Unclassified promotional content' }
  ];

  const ui = await createOptionsHarness({
    fanaticalLibraryItems: items,
    rejectedPurchaseItems: rejected,
    mediaTypeOverrides: { i1: 'comic' }
  });

  const diagContainer = ui.get('#library-classification-diagnostics');
  const pillsDiv = diagContainer.children[0];
  assert(pillsDiv, 'pills div should exist');
  const pillTexts = pillsDiv.children.map(p => p.textContent);

  assert(pillTexts.some(t => t.includes('Comics: 1')));
  assert(pillTexts.some(t => t.includes('Books: 1')));
  assert(pillTexts.some(t => t.includes('Games: 1')));
  assert(pillTexts.some(t => t.includes('Software: 1')));
  assert(pillTexts.some(t => t.includes('Audiobooks: 1')));
  assert(pillTexts.some(t => t.includes('Videos: 1')));
  assert(pillTexts.some(t => t.includes('Unclassified: 1')));
  assert(pillTexts.some(t => t.includes('Unimported / Rejected: 1')));
  assert(pillTexts.some(t => t.includes('Manual overrides: 1')));
});

test('Fanatical rejected review: displays metadata, empty states, recovery and dismissal', async () => {
  const rejectedRecord = {
    sourceItemId: 'rej_asset',
    title: 'Bonus Sound Effects',
    sourceBundle: 'Audio Superpack',
    bundle: { title: 'Audio Superpack' },
    reason: 'Unverified audio files',
    delivery: 'direct-download',
    formats: ['wav', 'flac']
  };

  const ui = await createOptionsHarness({
    fanaticalLibraryItems: [],
    rejectedPurchaseItems: [rejectedRecord]
  });

  assert.equal(ui.get('#library-rejected-count').textContent, '1');
  assert.equal(ui.get('#library-rejected-empty').hidden, true);
  assert.equal(ui.get('#library-rejected-actions').hidden, false);

  const list = ui.get('#library-rejected-list');
  assert.equal(list.children.length, 1);
  const entry = list.children[0];
  assert.match(entry.children[0].textContent, /Bonus Sound Effects/);
  assert.match(entry.children[1].textContent, /Bundle: Audio Superpack/);
  assert.match(entry.children[1].textContent, /Direct download/);
  assert.match(entry.children[1].textContent, /Formats: \.wav, \.flac/);

  // Recover item as 'software'
  const recoverSelect = entry.children.find(c => c.className === 'library-recover-select');
  recoverSelect.value = 'software';
  const recoverBtn = entry.children.find(c => c.className?.includes('library-recover-btn'));
  await recoverBtn.listeners.click?.();

  // Item should be in fanaticalLibraryItems and removed from rejectedPurchaseItems
  assert.equal(ui.stored.rejectedPurchaseItems.length, 0);
  assert.equal(ui.stored.fanaticalLibraryItems.length, 1);
  assert.equal(ui.stored.fanaticalLibraryItems[0].title, 'Bonus Sound Effects');
  assert.equal(ui.stored.fanaticalLibraryItems[0].mediaType, 'software');
  assert.equal(ui.stored.fanaticalLibraryItems[0].manualMediaType, 'software');

  // Now rejected list should be in empty state
  assert.equal(ui.get('#library-rejected-count').textContent, '0');
  assert.equal(ui.get('#library-rejected-empty').hidden, false);
});

test('Fanatical backup/restore: preserves mediaTypeOverrides and rejectedPurchaseItems', () => {
  const items = [{
    source: 'fanatical',
    sourceItemId: 'item_1',
    title: 'Custom Classified Book',
    mediaType: 'comic',
    manualMediaType: 'comic',
    automaticMediaType: 'book'
  }];

  const overrides = { item_1: 'comic' };
  const rejected = [{
    sourceItemId: 'rej_1',
    title: 'Coupon 10% Off',
    reason: 'Promotional'
  }];

  const backup = createLibraryBackup(
    items,
    { scanMode: 'full', importedAt: '2026-03-01T00:00:00.000Z' },
    '2026-03-01T00:00:00.000Z',
    'Personal',
    [],
    [],
    [],
    overrides,
    rejected
  );

  assert.deepEqual(backup.mediaTypeOverrides, overrides);
  assert.deepEqual(backup.rejectedPurchaseItems, rejected);

  const restored = backupRestoreState(parseLibraryBackup(backup), backup);
  assert.deepEqual(restored.mediaTypeOverrides, overrides);
  assert.deepEqual(restored.rejectedPurchaseItems, rejected);
  assert.equal(restored.fanaticalLibraryItems[0].title, 'Custom Classified Book');
});
