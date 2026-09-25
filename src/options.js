(async function options() {
  const $ = (selector) => document.querySelector(selector);
  async function refresh() {
    const { fanaticalImportSummary: summary = null, galacticLibraryExtensionId: extensionId = '' } = await chrome.storage.local.get({ fanaticalImportSummary: null, galacticLibraryExtensionId: '' });
    $('#import-summary').textContent = summary ? `${summary.ownedLeafProducts} owned leaf products from ${summary.ordersScanned} completed orders. Last import: ${new Date(summary.importedAt).toLocaleString()}.` : 'No purchases imported yet.';
    $('#history-note').textContent = summary?.historyCoverage ?? 'Order-history pagination has not yet been validated on a larger account.';
    $('#galactic-id').value = extensionId;
  }
  $('#save-galactic').addEventListener('click', async () => {
    const id = $('#galactic-id').value.trim(); const status = $('#galactic-status');
    if (id && !FanaticalLibrary.isExtensionId(id)) { status.textContent = 'Enter a valid Chrome or Firefox extension ID.'; return; }
    await chrome.storage.local.set({ galacticLibraryExtensionId: id }); status.textContent = id ? 'Saved. Matching remains optional.' : 'Galactic Library integration disabled.';
  });
  $('#export').addEventListener('click', async () => {
    const { fanaticalLibraryItems: items = [], fanaticalImportSummary: summary = null } = await chrome.storage.local.get({ fanaticalLibraryItems: [], fanaticalImportSummary: null });
    const blob = new Blob([JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), summary, items }, null, 2)], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'fanatical-library-export.json'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0);
    $('#local-status').textContent = `Exported ${items.length} local ownership records.`;
  });
  $('#reset').addEventListener('click', async () => {
    if (!confirm('Delete all locally stored Fanatical ownership data from this browser?')) return;
    await chrome.storage.local.remove(['fanaticalLibraryItems', 'fanaticalImportSummary']); $('#local-status').textContent = 'Local library deleted.'; await refresh();
  });
  await refresh();
}());
