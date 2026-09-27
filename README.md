# Fanatical Library v0.1

A standalone, browser-local Chrome MV3 extension that annotates Fanatical
standard/tiered bundles and Pick & Mix offers using locally imported Fanatical
purchase metadata. It optionally asks a paired Galactic Library extension for
title-only matches for games, books/comics, and audiobooks.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this project directory.
4. Open a signed-in `www.fanatical.com` page and choose **Quick scan for new
   purchases** from the extension popup. Use **Full scan all purchases** to
   deliberately rebuild the local library from every completed order.

No browser test has yet been performed against a live page. See the manual
checklist below before treating the extension as release-ready.

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
```

The export uses the same allowlisted ownership data; scan fingerprints are
local importer state and are not exported.

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
- Use Reset and Export; confirm reset removes only this extension's local data
  and export contains only the schema above.

## Known limitations

- `/api/user/orders` pagination is not validated on a large history.
- A game order containing activation data has not been live-tested; the
  allowlist and adversarial tests deliberately exclude those fields.
- Product-card DOM selectors are heuristic and need validation across all
  Fanatical layouts.
- Firefox packaging and Galactic external-message pairing remain follow-up
  work. Application logic is not intentionally duplicated for that work.
