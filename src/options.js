import { backupRestoreState, createLibraryBackup, parseLibraryBackup } from './library-data.mjs';

(async function options() {
  async function mutate(operation,...args){const result=await chrome.runtime.sendMessage({type:'FANATICAL_STORE',operation,args});if(!result?.ok)throw new Error(result?.error??'Library storage is unavailable.');return result.result;}
  const $ = (selector) => document.querySelector(selector);
  const linkSaved = 'Link saved. In Galactic Library, allow the Fanatical Library extension ID shown above.';
  let libraryBusy = false;

  function setLibraryBusy(busy) {
    libraryBusy = busy;
    for (const selector of ['#import-file', '#export', '#reset']) $(selector).disabled = busy;
  }

  async function refresh() {
    const {
      fanaticalImportSummary: summary = null,
      fanaticalLibraryItems: items = [],
      galacticLibraryExtensionId: extensionId = '',
      fanaticalShowDiagnostics: diagnostics = false,
      fanaticalLastScanAttempt: attempt = null
    } = await chrome.storage.local.get({ fanaticalImportSummary: null, fanaticalLibraryItems: [], galacticLibraryExtensionId: '', fanaticalShowDiagnostics: false, fanaticalLastScanAttempt: null });
    $('#last-import').textContent = summary
      ? `Last ${summary.scanMode === 'full' ? 'full' : 'quick'} scan: ${summary.addedProducts} item${summary.addedProducts === 1 ? '' : 's'} added; ${summary.ordersScanned} order${summary.ordersScanned === 1 ? '' : 's'} scanned${summary.ordersSkipped ? ` and ${summary.ordersSkipped} already-scanned order${summary.ordersSkipped === 1 ? '' : 's'} skipped` : ''} on ${new Date(summary.importedAt).toLocaleString()}.`
      : 'No Fanatical import has run yet.';
    const scope=await chrome.storage.local.get({fanaticalProfileLabel:'',fanaticalProfileArchives:[]});
    $('#library-count').textContent = `Active profile: ${scope.fanaticalProfileLabel||'unassigned'}. ${scope.fanaticalProfileArchives.length} other profile archives (backup only). ${items.length} unique item${items.length === 1 ? '' : 's'} stored locally.`;
    $('#history-note').textContent = `${attempt?.status === 'incomplete' ? 'Last scan incomplete: complete order-history coverage could not be confirmed. Previous purchases and the last successful scan were kept. ' : ''}${summary?.historyCoverage ?? 'No order-history coverage has been checked yet.'}`;
    if (diagnostics && summary?.coverage) $('#history-note').textContent += ` ${summary.coverage.retries} retries; at most ${summary.coverage.concurrency} concurrent detail requests.`;
    $('#galactic-id').value = extensionId;
    $('#galactic-status').textContent = extensionId ? linkSaved : 'No Galactic Library link configured.';
    $('#fanatical-extension-id').textContent = chrome.runtime.id;
    $('#show-diagnostics').checked = Boolean(diagnostics);
    const counts = new Map();
    for (const item of items) counts.set(item.mediaType || 'other', (counts.get(item.mediaType || 'other') || 0) + 1);
    if (counts.size) $('#library-count').textContent += ` ${[...counts].sort().map(([kind, total]) => `${total} ${kind}`).join(', ')}.`;
    const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    $('#library-preview').replaceChildren(...[...items].sort((a, b) => collator.compare(a.title, b.title)).slice(0, 50).map((item) => {
      const row = document.createElement('li'); row.textContent = item.bundle?.title ? `${item.title} — ${item.bundle.title}` : item.title; return row;
    }));
    $('#preview-note').textContent = items.length ? `Showing ${Math.min(50, items.length)} of ${items.length} items, alphabetically.` : 'Your library is empty. Import purchases or restore a backup to see a preview.';
  }

  $('#import-file').addEventListener('change', async () => {
    const input = $('#import-file'); const file = input.files[0]; if (!file || libraryBusy) return;
    setLibraryBusy(true);
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('Choose a backup smaller than 50 MB.');
      let parsed;
      try { parsed = JSON.parse(await file.text()); } catch { throw new Error('The selected file is not valid JSON.'); }
      const items = parseLibraryBackup(parsed);
      if (!confirm(`Replace your current Fanatical library with ${items.length} unique items from this backup and reset scan history? Export your current library first if you want to keep it.`)) {
        $('#import-status').textContent = 'Restore cancelled. Your library is unchanged.'; return;
      }
      await mutate('restore',parsed);
      await refresh();
      $('#import-status').textContent = `Restored ${items.length} unique items. Scan history reset; your next quick scan will recheck all completed orders.`;
    } catch (error) { $('#import-status').textContent = `Import failed: ${error.message}`; }
    finally { input.value = ''; setLibraryBusy(false); }
  });

  $('#save-galactic').addEventListener('click', async () => {
    const id = $('#galactic-id').value.trim(); const status = $('#galactic-status');
    if (!FanaticalLibrary.isExtensionId(id)) { status.textContent = 'Enter a valid Chrome or Firefox extension ID.'; return; }
    try {
      await mutate('patch',{galacticLibraryExtensionId:id});
      status.textContent = linkSaved;
    } catch { status.textContent = 'Could not save the Galactic Library link.'; }
  });

  $('#test-galactic').addEventListener('click', async () => {
    const id = $('#galactic-id').value.trim(); const button = $('#test-galactic'); const status = $('#galactic-status');
    if (!FanaticalLibrary.isExtensionId(id)) { status.textContent = 'Enter a valid Chrome or Firefox extension ID.'; return; }
    button.disabled = true; status.textContent = 'Testing Galactic Library link…';
    let timeout;
    let failure = 'The extension is unavailable or has not allowed Fanatical Library.';
    try {
      const response = await Promise.race([
        chrome.runtime.sendMessage(id, { type: 'PING' }),
        new Promise((_resolve, reject) => { timeout = setTimeout(() => { failure = 'Connection timed out.'; reject(new Error(failure)); }, 5000); })
      ]);
      if (!response?.ok || response.apiVersion !== 1) { failure = 'Galactic Library did not return a compatible API version 1 response.'; throw new Error(failure); }
      status.textContent = `Connected to Galactic Library${typeof response.appVersion === 'string' ? ` ${response.appVersion.slice(0, 40)}` : ''}.`;
    } catch { status.textContent = `Could not connect: ${failure} Check the extension ID, enable Galactic Library, and allow the Fanatical Library extension ID shown above.`; }
    finally { clearTimeout(timeout); button.disabled = false; }
  });

  $('#remove-galactic').addEventListener('click', async () => {
    try {
      await mutate('unlink');
      $('#galactic-id').value = ''; $('#galactic-status').textContent = 'Galactic Library link removed.';
    } catch { $('#galactic-status').textContent = 'Could not remove the Galactic Library link.'; }
  });

  $('#show-diagnostics').addEventListener('change', async () => {
    const input = $('#show-diagnostics');
    try { await mutate('patch',{fanaticalShowDiagnostics:input.checked}); }
    catch { input.checked = !input.checked; $('#local-status').textContent = 'Could not save the diagnostics setting.'; }
  });

  $('#open-orders').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.fanatical.com/en/orders' });
  });

  $('#export').addEventListener('click', async () => {
    if (libraryBusy) return;
    setLibraryBusy(true);
    try {
      const { fanaticalLibraryItems: items = [], fanaticalImportSummary: summary = null } = await chrome.storage.local.get({ fanaticalLibraryItems: [], fanaticalImportSummary: null });
      const scope=await chrome.storage.local.get({fanaticalProfileLabel:'',fanaticalProfileArchives:[]});
      const backup = createLibraryBackup(items, summary,undefined,scope.fanaticalProfileLabel,scope.fanaticalProfileArchives);
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'fanatical-library-export.json'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0);
      $('#local-status').textContent = `Exported ${backup.items.length} local ownership records.`;
    } catch { $('#local-status').textContent = 'Could not export the library.'; }
    finally { setLibraryBusy(false); }
  });

  $('#reset').addEventListener('click', async () => {
    if (libraryBusy) return;
    if (!confirm('Clear every locally stored Fanatical title, scan history, and import summary?')) return;
    setLibraryBusy(true);
    try {
      await mutate('clear');
      $('#local-status').textContent = 'Library and scan history cleared.';
      await refresh();
    } catch { $('#local-status').textContent = 'Could not clear the library.'; }
    finally { setLibraryBusy(false); }
  });

  try { await refresh(); } catch { $('#local-status').textContent = 'Could not load local library settings. Reload this page and try again.'; }
}());
