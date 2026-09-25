(async function popup() {
  const summary = document.querySelector('#summary'); const button = document.querySelector('#import'); const status = document.querySelector('#status');
  const display = async () => {
    const { fanaticalImportSummary: value = null } = await chrome.storage.local.get({ fanaticalImportSummary: null });
    summary.textContent = value ? `${value.ownedLeafProducts} owned products from ${value.ordersScanned} completed orders. Imported ${new Date(value.importedAt).toLocaleString()}.` : 'No purchases imported yet.';
  };
  await display();
  button.addEventListener('click', async () => {
    button.disabled = true; status.textContent = 'Importing locally…';
    try {
      const response = await chrome.runtime.sendMessage({ type: 'FANATICAL_IMPORT_PURCHASES' });
      status.textContent = response?.ok ? `Imported ${response.summary.ownedLeafProducts} products.` : (response?.error ?? 'Import failed.');
      await display();
    } catch { status.textContent = 'Import failed. Open a signed-in Fanatical page and try again.'; } finally { button.disabled = false; }
  });
}());
