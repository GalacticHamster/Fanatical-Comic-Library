(async function popup() {
  const summary = document.querySelector('#summary'); const button = document.querySelector('#import'); const status = document.querySelector('#status');
  const display = async () => {
    const { fanaticalImportSummary: value = null } = await chrome.storage.local.get({ fanaticalImportSummary: null });
    summary.textContent = value ? `${value.ownedLeafProducts} owned products. Last ${value.scanMode === 'full' ? 'full' : 'quick'} scan checked ${value.ordersScanned} of ${value.ordersAvailable ?? value.ordersScanned} completed orders${value.addedProducts ? ` and added ${value.addedProducts}` : ''}; ${new Date(value.importedAt).toLocaleString()}.` : 'No purchases imported yet.';
  };
  await display();
  button.addEventListener('click', async () => {
    button.disabled = true; status.textContent = 'Importing locally…';
    try {
      const response = await chrome.runtime.sendMessage({ type: 'FANATICAL_IMPORT_PURCHASES' });
      status.textContent = response?.ok ? `Quick scan checked ${response.summary.ordersScanned} new order${response.summary.ordersScanned === 1 ? '' : 's'}, skipped ${response.summary.ordersSkipped}, and added ${response.summary.addedProducts} product${response.summary.addedProducts === 1 ? '' : 's'}.` : (response?.error ?? 'Import failed.');
      await display();
    } catch { status.textContent = 'Import failed. Open a signed-in Fanatical page and try again.'; } finally { button.disabled = false; }
  });
  const fullScanButton = document.querySelector('#full-scan');
  fullScanButton.addEventListener('click', async () => {
    if (!confirm('Full scan every completed Fanatical purchase? This can take longer.')) return;
    button.disabled = true; fullScanButton.disabled = true; status.textContent = 'Scanning every completed purchase locally...';
    try {
      const response = await chrome.runtime.sendMessage({ type: 'FANATICAL_IMPORT_PURCHASES', fullScan: true });
      status.textContent = response?.ok ? `Full scan checked ${response.summary.ordersScanned} orders and rebuilt ${response.summary.ownedLeafProducts} products.` : (response?.error ?? 'Import failed.');
      await display();
    } catch { status.textContent = 'Import failed. Open a signed-in Fanatical page and try again.'; } finally { button.disabled = false; fullScanButton.disabled = false; }
  });
}());
