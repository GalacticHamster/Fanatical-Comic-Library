// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Galactic Hamster
(async function popup() {
  const { fanaticalLibraryItems: items = [] } = await chrome.storage.local.get({ fanaticalLibraryItems: [] });
  document.querySelector('#status').textContent = items.length
    ? `${items.length.toLocaleString()} item${items.length === 1 ? '' : 's'} in your local library.`
    : 'Nothing saved yet. Open your Fanatical Orders page to import your purchases.';
  document.querySelector('#open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
}());
