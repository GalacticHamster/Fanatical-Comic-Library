(async function options() {
  const $ = (selector) => document.querySelector(selector);
  async function refresh() {
    const { fanaticalImportSummary: summary = null, galacticLibraryExtensionId: extensionId = '' } = await chrome.storage.local.get({ fanaticalImportSummary: null, galacticLibraryExtensionId: '' });
    $('#import-summary').textContent = summary ? `${summary.ownedLeafProducts} owned leaf products. Last ${summary.scanMode === 'full' ? 'full' : 'quick'} scan checked ${summary.ordersScanned} of ${summary.ordersAvailable ?? summary.ordersScanned} completed orders${summary.addedProducts ? ` and added ${summary.addedProducts}` : ''}; ${new Date(summary.importedAt).toLocaleString()}.` : 'No purchases imported yet.';
    $('#history-note').textContent = summary?.historyCoverage ?? 'Order-history pagination has not yet been validated on a larger account.';
    $('#galactic-id').value = extensionId;
  }
  $('#save-galactic').addEventListener('click', async () => {
    const id = $('#galactic-id').value.trim(); const status = $('#galactic-status');
    if (id && !FanaticalLibrary.isExtensionId(id)) { status.textContent = 'Enter a valid Chrome or Firefox extension ID.'; return; }
    await chrome.storage.local.set({ galacticLibraryExtensionId: id }); status.textContent = id ? 'Saved. Matching remains optional.' : 'Galactic Library integration disabled.';
  });
  async function scan(fullScan) {
    const status = $('#local-status');
    $('#quick-scan').disabled = true; $('#full-scan').disabled = true;
    status.textContent = fullScan ? 'Scanning every completed purchase locally...' : 'Checking for new purchases locally...';
    try {
      const response = await chrome.runtime.sendMessage({ type: 'FANATICAL_IMPORT_PURCHASES', fullScan });
      status.textContent = response?.ok
        ? fullScan
          ? `Full scan checked ${response.summary.ordersScanned} orders and rebuilt ${response.summary.ownedLeafProducts} products.`
          : `Quick scan checked ${response.summary.ordersScanned} new order${response.summary.ordersScanned === 1 ? '' : 's'}, skipped ${response.summary.ordersSkipped}, and added ${response.summary.addedProducts} product${response.summary.addedProducts === 1 ? '' : 's'}.`
        : (response?.error ?? 'Import failed.');
      await refresh();
    } catch { status.textContent = 'Import failed. Open a signed-in Fanatical page and try again.'; } finally { $('#quick-scan').disabled = false; $('#full-scan').disabled = false; }
  }
  $('#quick-scan').addEventListener('click', () => scan(false));
  $('#full-scan').addEventListener('click', () => {
    if (confirm('Full scan every completed Fanatical purchase? This can take longer.')) scan(true);
  });
  $('#export').addEventListener('click', async () => {
    const { fanaticalLibraryItems: items = [], fanaticalImportSummary: summary = null } = await chrome.storage.local.get({ fanaticalLibraryItems: [], fanaticalImportSummary: null });
    const blob = new Blob([JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), summary, items }, null, 2)], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'fanatical-library-export.json'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0);
    $('#local-status').textContent = `Exported ${items.length} local ownership records.`;
  });
  $('#reset').addEventListener('click', async () => {
    if (!confirm('Delete all locally stored Fanatical ownership data from this browser?')) return;
    await chrome.storage.local.remove(['fanaticalLibraryItems', 'fanaticalImportSummary', 'fanaticalScannedOrderFingerprints']); $('#local-status').textContent = 'Local library deleted.'; await refresh();
  });
  await refresh();
}());
