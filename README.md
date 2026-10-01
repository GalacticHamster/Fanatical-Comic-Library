# Fanatical Library v0.1

A standalone, browser-local Chrome MV3 extension that annotates Fanatical
standard/tiered bundles and Pick & Mix offers using locally imported Fanatical
purchase metadata. It optionally asks a paired Galactic Library extension for
title-only matches for games, books/comics, and audiobooks.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this project directory.
4. Open the extension popup and choose **Manage library**. In Extension
   options, select **Open Fanatical orders importer**, then use **Quick scan
   for new purchases** on that signed-in Orders page. Use **Full scan all
   purchases** to deliberately rebuild the local library from every completed
   order.

Options now include confirmed JSON backup restore, a naturally ordered
50-item library preview, Galactic Library Save/Test/Remove controls, and an
opt-in bundle/catalogue diagnostics switch. The options page also shows this
extension's ID for Galactic Library's companion allowlist.

Restoring a version 1 Fanatical backup replaces the local library after
confirmation, keeping product IDs, matching IDs and purchase provenance.
It clears the last scan summary and order fingerprints so the next quick
scan checks every completed order. Pairing and display settings are kept.
Invalid backups are rejected without changing storage; unknown fields are
never stored. Export your current library before replacing it.

## Privacy boundary

The importer uses `chrome.scripting.executeScript` in Fanatical's main world.
Only that short-lived function reads `localStorage.bsauth.token`, solely to
call these fixed read-only endpoints:

```text
GET /api/user/orders
GET /api/user/orders/{orderId}
```

It returns only a strict allowlisted ownership DTO to extension context. The
token, raw responses, activation/redemption fields, download URLs, payment,
address, email, hashes, and key-like fields are never persisted, exported,
logged, or messaged. The extension never calls `/api/basket` and has no cart,
checkout, account-mutation, telemetry, backend, or remote-storage feature.

## Persisted local schema

`chrome.storage.local` contains only:

```text
fanaticalLibraryItems: Array<{
  source: 'fanatical', sourceItemId, title, slug?, mediaType,
  externalIds?: { steamAppId?, isbn? }, drm?, platforms?, formats?,
  bundle: { sourceItemId, title, slug? }, purchaseDate
}>

fanaticalImportSummary: {
  importedAt, scanMode, ordersScanned, ordersAvailable, ordersSkipped,
  addedProducts, ownedLeafProducts, historyCoverage
}

fanaticalScannedOrderFingerprints: string[] // SHA-256 fingerprints only

galacticLibraryExtensionId: string
fanaticalShowDiagnostics: boolean // off by default
fanaticalShowNewItemsOnly: boolean
fanaticalCatalogueFilters: { hidePurchased, endingSoon }
```

The export uses the same allowlisted ownership data; scan fingerprints are
local importer state and are not exported.

## Scan safety

Scans validate the observed order-list array and the identity/status/structure
of every requested completed order before making a single storage update.
Order details must include every product occurrence named in their summaries;
unknown structures, missing leaves, invalid JSON, partial HTTP responses and
pagination indicators abort the scan. Failed scans leave library records,
scan fingerprints and the last successful summary unchanged.

A valid empty array is distinguished from an unreadable response. If the list
omits previously scanned orders (including an unexpectedly empty list), the
scan refuses to declare complete coverage. This conservative guard also means
switching Fanatical accounts requires exporting and clearing the previous
account's local library first. No raw order IDs or response bodies leave the
page context.

## Automated checks

Run `npm test` for parser, matching, privacy, scan safety, backup validation and options
behavior tests. Run `npm run browser-check` for real-DOM checks in isolated
headless Chrome profiles, using mock data on localhost (no signed-in session).
Set `CHROME_PATH` if Chrome is not installed at its usual Windows path.
Public catalogue markup has also been checked using captured live pages;
signed-in flows still need the manual checks below.

## Manual browser checklist

- Run a Quick scan while signed in; confirm its owned-leaf count and no
  sensitive data appears in extension storage/export. Run it again and confirm
  it skips already scanned orders; use a Full scan to rebuild all orders.
- Reload the purchased tiered comic bundle; confirm all 47 matching leaf cards
  display **Owned** and duplicate badges do not appear after navigation.
- Open a Pick & Mix bundle; confirm all pool cards receive non-interactive
  status badges and that selecting/removing products does not produce an
  extension-initiated basket request.
- Confirm a signed-out import reports a sign-in/session error without exposing
  token data.
- Pair Galactic Library; verify an exact external match reads **Owned
  elsewhere — Provider**, never **Owned**.
- Verify that disabling/removing the paired ID leaves local matching functional.
- Export a backup, then restore it; confirm the confirmation dialog, preview,
  purchase badges and matching survive. Cancel a restore and try an invalid
  file; both should leave your library untouched.
- Test the Galactic link, then remove it while a bundle is open; external
  badges should return to local matching without a page reload.
- Turn diagnostics on and off while a bundle or category catalogue is open;
  verify counts/match reasons/expiry readings appear only when enabled.
- Clear the library; confirm it removes titles and scan history but keeps
  pairing and display settings.

## Known limitations

- `/api/user/orders` pagination is not validated on a large history. Detectable
  partial histories are rejected; only the observed unpaginated array contract
  is supported. Silent server-side truncation without metadata or missing
  known orders cannot be ruled out on a first scan.
- Unrecognized purchase layouts are rejected rather than silently skipped.
- A game order containing activation data has not been live-tested; the
  allowlist and adversarial tests deliberately exclude those fields.
- Product-card DOM selectors are heuristic and need validation across all
  Fanatical layouts.
- Firefox packaging and Galactic external-message pairing remain follow-up
  work. Application logic is not intentionally duplicated for that work.
