// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Galactic Hamster / Galactic Hamster LLC
(async function popup() {
  const { fanaticalLibraryItems: items = [] } = await chrome.storage.local.get({ fanaticalLibraryItems: [] });
  document.querySelector('#status').textContent = items.length
    ? `${items.length} item${items.length === 1 ? '' : 's'} in your local library.`
    : 'No titles imported yet.';
  document.querySelector('#open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
}());
