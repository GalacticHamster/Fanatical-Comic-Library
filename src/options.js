(async function options() {
  const $ = (selector) => document.querySelector(selector);

  async function refresh() {
    const {
      fanaticalImportSummary: summary = null,
      fanaticalLibraryItems: items = [],
      galacticLibraryExtensionId: extensionId = ''
    } = await chrome.storage.local.get({ fanaticalImportSummary: null, fanaticalLibraryItems: [], galacticLibraryExtensionId: '' });
    $('#last-import').textContent = summary
      ? `Last ${summary.scanMode === 'full' ? 'full' : 'quick'} scan: ${summary.addedProducts} item${summary.addedProducts === 1 ? '' : 's'} added; ${summary.ordersScanned} order${summary.ordersScanned === 1 ? '' : 's'} scanned${summary.ordersSkipped ? ` and ${summary.ordersSkipped} already-scanned order${summary.ordersSkipped === 1 ? '' : 's'} skipped` : ''} on ${new Date(summary.importedAt).toLocaleString()}.`
      : 'No Fanatical import has run yet.';
    $('#library-count').textContent = `${items.length} unique item${items.length === 1 ? '' : 's'} stored locally.`;
    $('#history-note').textContent = summary?.historyCoverage ?? 'Order-history pagination has not yet been validated on a larger account.';
    $('#galactic-id').value = extensionId;
    $('#galactic-status').textContent = extensionId ? 'Link saved.' : 'No Galactic Library link configured.';
  }

  $('#save-galactic').addEventListener('click', async () => {
    const id = $('#galactic-id').value.trim(); const status = $('#galactic-status');
    if (id && !FanaticalLibrary.isExtensionId(id)) { status.textContent = 'Enter a valid Chrome or Firefox extension ID.'; return; }
    await chrome.storage.local.set({ galacticLibraryExtensionId: id });
    status.textContent = id ? 'Link saved.' : 'Galactic Library link removed.';
  });

  $('#open-orders').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.fanatical.com/en/orders' });
  });

  $('#export').addEventListener('click', async () => {
    const { fanaticalLibraryItems: items = [], fanaticalImportSummary: summary = null } = await chrome.storage.local.get({ fanaticalLibraryItems: [], fanaticalImportSummary: null });
    const blob = new Blob([JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), summary, items }, null, 2)], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'fanatical-library-export.json'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0);
    $('#local-status').textContent = `Exported ${items.length} local ownership records.`;
  });

  $('#reset').addEventListener('click', async () => {
    if (!confirm('Clear every locally stored Fanatical title, scan history, and import summary?')) return;
    await chrome.storage.local.remove(['fanaticalLibraryItems', 'fanaticalImportSummary', 'fanaticalScannedOrderFingerprints']);
    $('#local-status').textContent = 'Library and scan history cleared.';
    await refresh();
  });

  await refresh();
}());
