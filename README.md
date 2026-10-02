# Fanatical Library v0.1

A standalone, browser-local Chrome MV3 extension that annotates Fanatical
standard/tiered bundles and Pick & Mix offers using locally imported Fanatical
purchase metadata. It optionally asks a paired Galactic Library extension for
identity and reviewed contents evidence for games, books/comics, and audiobooks.

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

Restoring a supported Fanatical backup replaces the local library after
confirmation, keeping product IDs, matching IDs, every purchase origin and profile archives.
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
  authors?, language?, edition?, series?, run?, volume?, issue?, publisher?,
  bundle: { sourceItemId, title, slug? }, purchaseDate,
  purchaseOrigins?: [{ purchaseRef?, bundle, purchaseDate, quantity }]
}>

fanaticalImportSummary: {
  importedAt, scanMode, ordersScanned, ordersAvailable, ordersSkipped,
  addedProducts, ownedLeafProducts, historyCoverage,
  coverage: { complete, listedOrders, validatedOrders, emptyAccount,
    pagesFetched, expectedTotal, paginationEvidence, retries, concurrency }
}

fanaticalScannedOrderFingerprints: string[] // SHA-256 fingerprints only
fanaticalLastScanAttempt: { status: 'complete' | 'incomplete', scanMode, attemptedAt } | null

galacticLibraryExtensionId: string
fanaticalShowDiagnostics: boolean // off by default
fanaticalShowNewItemsOnly: boolean
fanaticalCatalogueFilters: { hidePurchased, endingSoon }
```

Recoverable backups and separately labeled portable title catalogs are explained in [backups and purchase origins](docs/backups-and-purchases.md). The export uses the same allowlisted ownership data; scan fingerprints are
local importer state and are not exported.

## Edition and package matching

An exact purchased Fanatical product ID remains authoritative. A shared Steam
App ID identifies a base game; it does not by itself prove ownership of a
different deluxe edition, soundtrack, DLC or package. Known differences remain
**Possible**, with the owned title and package warning shown in card captions
and the summary's review list, without enabling diagnostics.

When the public product data explicitly lists components, each component is
checked separately. Only verified component ownership counts toward **Partial**;
all listed components must be verified and `componentsComplete: true` must
explicitly establish an exhaustive list to claim the full package. Components
are not guessed from marketing text. Possible/Partial packages stay visible
under "Show new items only" and are excluded from confirmed-new tier coverage.

The live parser retains allowlisted authors, validated ISBNs, edition,
series/run, language, and explicit `contents` entries. Unit entries use the
Galactic Library schema (`series`, `run`, `unitType`, `number`, `language`,
`completeness`). Whole-product content ownership additionally requires
`contentsComplete: true`. Ranges parsed from issue/volume titles are query
targets only. Unknown run/language and excerpts cannot establish full coverage.

Local Possible and Partial items, plus explicitly enumerated components, are
checked centrally. Scoped contents coverage is combined across current local
Fanatical purchases and reviewed central collections. Central Fanatical records
are excluded so stale copies do not appear as ownership elsewhere. Requests
respect both the 500-item and 20,000-unit API limits. Failed, omitted, or
incompatible responses stay incomplete and can be retried; they never count as
confirmed-new. Successful responses are cached by their full query evidence
for the current page, and reset when the library or pairing changes.
Older title-only book responses need a validated identifier or compatible
title-and-author evidence to establish edition ownership. If central contents
coverage is unavailable, unit gaps and additional-content totals remain
unconfirmed even when a title lookup succeeds.

Unicode scripts and meaningful edition labels are retained. ISBN checksums are
validated and ISBN-10/13 compared equivalently. Normalized book titles without
identity evidence remain Possible; an unambiguous literal local purchase title
or exact Fanatical product ID remains usable. Known related book editions and
game packages remain Possible in either direction, with the actual owned title.
"New" means not found in the libraries checked, whose purchase-history coverage
is not guaranteed by the companion API.

Click a badge or a title in the summary to open its keyboard-accessible evidence
inspector. It shows the actual library titles, edition/contents relationships,
ownership status, source, rule score (not a probability), observed/review dates,
and coverage limitations. Missing dates are shown as unknown. Private purchase
IDs and download URLs are not included. The inspector can refresh central
evidence and open Galactic Library's options for ownership/contents review.
Navigation uses the configured pairing and Chrome's extension settings route;
an unsupported addon ID receives toolbar instructions.

Bundle summaries also show distinct additional full issues/volumes, already
covered units, and uncertain units across local and central collections.
Overlapping offers count once. Standard tiers show cumulative unit counts;
Pick & Mix separates the available pool from the current page selection and
excludes sold-out or unavailable offers. Unknown scope and failed lookups do
not add units to the additional-content total. Offers without enumerable
contents are disclosed separately. These counts describe content not found
in the checked libraries; they do not establish edition identity or a complete
purchase history.

Series coverage queries bounded intervening issue/volume numbers using the same
central contents API. It separates series/run, language, annuals/specials, and
fractional units. Covered issues outside the current offer can close a gap;
units not offered here are labeled separately. Unknown scope, unavailable
central coverage and bounded spans are disclosed. Numeric ordering describes
the compared span, not a complete series bibliography or publisher chronology.

Central evidence reminders flag unknown/temporary ownership, missing observation
dates, observations older than 30 days, older contents reviews, uncertain scope,
and unavailable coverage. They do not revoke recorded permanent ownership.
Use the item inspectors to open central review or refresh the comparison after
sync/review. The current Galactic Library API exposes matching/contents evidence
and dates; it has no expiry-reminder feed. Rental/key expiry dates, notification
schedules, reading progress and complete series enumeration remain unavailable
through this interface. No additional enrichment engine or reminder storage is
created in Fanatical.

## Scan safety

Scans validate the observed order-list array and the identity/status/structure
of every requested completed order before making a single storage update.
Order details must include every product occurrence named in their summaries;
unknown structures, missing leaves, invalid JSON and partial HTTP responses
abort the scan. Failed scans leave library records, scan fingerprints and the
last successful summary unchanged. A separate last-attempt flag exposes an
incomplete scan in settings, without saving raw error/response data.

At most **three order-detail requests** run at once. Each GET has a 20-second
timeout (including the body read) and at most three attempts. Network/timeouts,
408, 429, 500, 502, 503 and 504 use exponential backoff plus jitter. Authentication
errors and malformed successful responses are not retried. A server's
`Retry-After` seconds or HTTP date is respected; 429/503 also pause queued
requests. If the requested wait exceeds 30 seconds, the scan stops and asks you
to try later instead of retrying early. A failed detail stops the queue and
aborts other in-flight requests. Overlapping purchase scans are rejected.

Order-list pages are fetched sequentially, following only explicit `Link`
`rel="next"` URLs on the same HTTPS Fanatical order-list endpoint. The importer
does not invent page/cursor parameters or assume an undocumented JSON envelope.
It checks consistent total counts and contiguous ranges when supplied, and
rejects repeated pages/orders, missing next links, changing totals, gaps and
unsafe links. Safety caps are 1,000 pages and 100,000 listed orders; hitting a
cap never commits partial results. Coverage reports page counts and whether
evidence came from ranges, totals, a next-page chain, or just a bare array.

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
- Check the coverage message on Orders and in settings. A bare-array response
  should explicitly warn that silent server truncation cannot be ruled out.
  If a scan fails, settings should show "Last scan incomplete" while keeping
  the prior successful summary and purchases. A successful rescan clears it.
- Reload the purchased tiered comic bundle; confirm all 47 matching leaf cards
  display **Owned** and duplicate badges do not appear after navigation.
- Open a Pick & Mix bundle; confirm all pool cards receive interactive
  evidence badges and that selecting/removing products does not produce an
  extension-initiated basket request.
- Confirm a signed-out import reports a sign-in/session error without exposing
  token data.
- Pair Galactic Library; verify an exact external match reads **Owned
  elsewhere — Provider**, never **Owned**.
- Verify that disabling/removing the paired ID leaves local matching functional.
- Compare a deluxe edition with an owned base game sharing its Steam App ID;
  confirm **Possible** and the owned-title/package explanation. If explicit
  components are supplied, verify **Partial** rather than full ownership until
  every component is independently owned.
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

- A real large `/api/user/orders` history has not been captured. Synthetic
  tests cover 1,000 orders across 25 pages, full/quick scans, bounded concurrency,
  retries/timeouts, unsafe links and broken pagination. Array responses with
  explicit next-page links are supported, but an undocumented pagination
  envelope is rejected. Silent server-side truncation without metadata or
  missing known orders cannot be ruled out, and is explicitly disclosed.
- Unrecognized purchase layouts are rejected rather than silently skipped.
- A game order containing activation data has not been live-tested; the
  allowlist and adversarial tests deliberately exclude those fields.
- Product-card DOM selectors are heuristic and need validation across all
  Fanatical layouts.
- Firefox packaging and Galactic external-message pairing remain follow-up
  work. Application logic is not intentionally duplicated for that work.
