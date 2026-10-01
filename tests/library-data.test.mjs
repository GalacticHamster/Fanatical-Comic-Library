import assert from 'node:assert/strict';
import test from 'node:test';
import { backupRestoreState, createLibraryBackup, parseLibraryBackup, sanitizeImportResult } from '../src/library-data.mjs';

const item = { source: 'fanatical', sourceItemId: 'product-123456', title: 'Comic #2', mediaType: 'book', slug: 'comic-2', externalIds: { isbn: '9781234567890' }, formats: ['pdf'], bundle: { sourceItemId: 'bundle-123456', title: 'Comics', slug: 'comics' }, purchaseDate: '2026-09-01T12:00:00.000Z' };

test('version 1 backups round-trip product identity, matching IDs and purchase provenance', () => {
  const backup = createLibraryBackup([item], null);
  assert.deepEqual(parseLibraryBackup(JSON.parse(JSON.stringify(backup))), [item]);
});

test('import and export exclude unknown sensitive fields at every projected level', () => {
  const toxic = { ...item, token: 'SECRET-TOKEN', orderId: 'SECRET-ORDER', key: 'SECRET-KEY', email: 'SECRET-EMAIL', externalIds: { ...item.externalIds, key: 'SECRET-ID' }, bundle: { ...item.bundle, downloadUrl: 'SECRET-URL' }, downloads: ['SECRET-DOWNLOAD'] };
  const backup = { schemaVersion: 1, items: [toxic], token: 'SECRET-ROOT', summary: { scanMode: 'quick', token: 'SECRET-SUMMARY' }, orderFingerprints: ['a'.repeat(64)] };
  const output = createLibraryBackup(parseLibraryBackup(backup), backup.summary);
  assert.equal(JSON.stringify(output).includes('SECRET'), false);
  assert.equal('orderFingerprints' in output, false);
  assert.deepEqual(output.items, [item]);
});

test('invalid schema, non-Fanatical records and malformed records fail closed', () => {
  for (const backup of [null, [], { schemaVersion: 2, items: [item] }, { schemaVersion: 1, items: {} }, { schemaVersion: 1, items: [{ ...item, source: 'humble' }] }, { schemaVersion: 1, items: [item, { ...item, title: '' }] }, { schemaVersion: 1, items: [{ ...item, sourceItemId: 'bad' }] }]) {
    assert.throws(() => parseLibraryBackup(backup));
  }
});

test('backup records deduplicate by product ID, not by title', () => {
  assert.deepEqual(parseLibraryBackup({ schemaVersion: 1, items: [item, { ...item, title: 'Comic #3' }, { ...item, sourceItemId: 'product-654321' }] }).map((row) => row.title), ['Comic #3', 'Comic #2']);
});

test('restore atomically clears scan authority but does not touch pairing or preferences', () => {
  assert.deepEqual(backupRestoreState([item]), { fanaticalLibraryItems: [item], fanaticalImportSummary: null, fanaticalScannedOrderFingerprints: [], fanaticalLastScanAttempt: null });
  assert.deepEqual(parseLibraryBackup({ schemaVersion: 1, items: [] }), []);
});

test('shared importer sanitizer validates IDs, bounded lists, counts and fingerprints', () => {
  const result = sanitizeImportResult({ items: [{ ...item, externalIds: { steamAppId: 'invalid', isbn: 'invalid' }, drm: ['steam', 'steam', 123], purchaseDate: 'invalid' }, { title: 'Invalid' }], ordersScanned: Infinity, ordersAvailable: -1, orderFingerprints: ['A'.repeat(64), 'a'.repeat(64), 'secret'] });
  assert.equal(result.items.length, 1);
  assert.equal('externalIds' in result.items[0], false);
  assert.equal(result.items[0].purchaseDate, null);
  assert.deepEqual(result.items[0].drm, ['steam']);
  assert.equal(result.ordersScanned, 0);
  assert.equal(result.ordersAvailable, 0);
  assert.deepEqual(result.orderFingerprints, ['a'.repeat(64)]);
});
