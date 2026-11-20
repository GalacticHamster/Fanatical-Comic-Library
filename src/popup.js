// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Galactic Hamster
(async function popup() {
  const { fanaticalLibraryItems: items = [] } = await chrome.storage.local.get({ fanaticalLibraryItems: [] });
  // A count of items and of verified orders, as Humble Library's popup counts items and synced purchases.
  const orders = new Set(items.flatMap(item => Array.isArray(item?.purchaseOrigins) ? item.purchaseOrigins.map(origin => origin?.purchaseRef).filter(ref => typeof ref === 'string' && ref) : [])).size;
  document.querySelector('#status').textContent = items.length
    ? `${items.length.toLocaleString()} item${items.length === 1 ? '' : 's'} in your local library.${orders ? ` ${orders.toLocaleString()} verified Fanatical order${orders === 1 ? '' : 's'}.` : ''}`
    : 'Nothing saved yet. Open your Fanatical Orders page to import your purchases.';
  document.querySelector('#open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
}());
