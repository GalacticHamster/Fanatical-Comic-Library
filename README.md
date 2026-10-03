# Fanatical Library v0.1

A standalone, browser-local Chrome MV3 extension that annotates Fanatical
standard/tiered bundles and Pick & Mix offers using locally imported Fanatical
purchase metadata. It optionally asks a paired Galactic Library extension for
identity and reviewed contents evidence for games, books/comics, audiobooks and advertised software support.

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

## Matching policy

Owned accepts an unambiguous local purchase despite punctuation, spacing, volume-abbreviation or trailing book-format differences. Articles, Roman numerals, preview labels and meaningful symbols are retained for that comparison; conflicting identifiers/authors, numbered units and edition wording still prevent a weak title from proving ownership. Product IDs and compatible validated identifiers remain stronger evidence.

Possible is deliberately broader: related editions, shortened/subtitled titles, parenthetical qualifiers, software versions, named game collections and small spelling differences can warn about another library item. Multiple local candidates remain available in the evidence inspector with their actual titles. These warnings never establish complete edition, DLC or collection ownership. Very short generic prefixes and independent subtitle-bearing works are not inferred solely from a shared main title.

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

fanaticalWishlistItems: Array<{title, mediaType, weight: 1..100, identity fields?}>
fanaticalProfileLabel: string
fanaticalProfileArchives: Array<{profileLabel, items, historicalItems}> // backup only
fanaticalHistoricalItems: Array<{profileLabel, item, missingSince}> // review only
fanaticalSyncControl: {revision, lease} // queued worker coordination

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
sync/review. Settings also consumes Galactic Library's advertised entitlement-reminder
feed with safe paged DTOs, reported deadlines, unknown dates and activation distinctions.
See [central reminders](docs/central-reminders.md). No separate enrichment engine or
reminder database is created in Fanatical.

Bundle summaries include [wishlist and purchase planning](docs/purchase-planning.md):
weighted wishes, cheapest qualifying cumulative tiers, scoped additional-unit costs
and availability/uncertainty-aware Pick & Mix suggestions. Version 3 backups save
wishes along with ownership and provenance using an atomic queued snapshot.

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
switching Fanatical accounts requires a confirmed profile label and a deliberate
full-rescan switch. Previous profiles are archived and never contribute active ownership. No raw order IDs or response bodies leave the
page context.

## Automated checks

Run `npm test` for parser, matching, privacy, scan safety, backup validation and options
behavior tests. Run `npm run browser-check` for real-DOM checks in isolated
headless Chrome profiles, using mock data on localhost (no signed-in session).
Set `CHROME_PATH` if Chrome is not installed at its usual Windows path.
Run `npm run package` to create a deterministic runtime-only ZIP and SHA-256
report; `npm run check:package` validates dependencies without writing.
`npm run browser-check:release` executes the actual packaged runtime in Chrome
DOM fixtures. See [release and pairing](docs/release-and-pairing.md).
`npm run runtime-check` installs the validated ZIP and tests real Chrome
content/worker/MAIN imports against locally intercepted synthetic paginated orders.
`npm run runtime-check:central` additionally tests real pairing with the adjacent
GalacticLibrary repository, including software and entitlement-reminder DTOs.
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
  tests cover 5,000 orders across 100 pages, full/quick scans, bounded concurrency,
  retries/timeouts, unsafe links and broken pagination. Array responses with
  explicit next-page links are supported, but an undocumented pagination
  envelope is rejected. Silent server-side truncation without metadata or
  missing known orders cannot be ruled out, and is explicitly disclosed.
- Unrecognized purchase layouts are rejected rather than silently skipped.
- A game order containing activation data has not been live-tested; the
  allowlist and adversarial tests deliberately exclude those fields.
- Product-card DOM selectors are heuristic and need validation across all
  Fanatical layouts.
- Firefox 140+ packages and actual Galactic pairing are tested; signed-in
  provider smoke checks and AMO signing remain separate release steps.

## Firefox desktop

Run `npm run package:firefox`, extract `dist/FanaticalLibrary-0.1.0-firefox.zip`, then select its manifest through `about:debugging#/runtime/this-firefox`. This is a temporary development install; permanent distribution requires signing. Firefox 140+ is supported with a module event page and the same runtime assets as Chrome.

Allow `fanatical-library@galactichamster.com` in Galactic Library and save `galactic-library@galactichamster.com` in Fanatical settings. Use **Test link**. Firefox central review asks the allowed GL extension to open its own options; it needs no native helper or private URL. Older GL versions show toolbar instructions.

`npm run browser-check:firefox` checks all nine packaged DOM fixtures. From the adjacent GalacticLibrary repo, `node tests/firefox.mjs --companions` verifies actual installed pairing and GL/FAN MAIN injection against 200 synthetic purchases over ten pages, a quick scan over eleven pages fetching only one new detail, and rejection of broken pagination. These test isolated profiles and synthetic accounts.

## Companion interface

Bundle summaries use the same status vocabulary, Explain action, evidence dialog sizing, and compact panel controls. Possible and Partial items show the actual related library title, with other candidates available in the summary. Use the corner selector to move the panel; Minimize/Expand and the corner are saved across visits. Settings contains the same display preferences. These device preferences survive ownership restore and clear and stay outside backups. HB key purchases still say Purchased because a key purchase cannot prove destination activation. FAN edition/package captions retain warnings about unverified extras.

Wishlist priorities range from 1 to 100 and affect planning without establishing ownership. FAN full backups include the wishlist; HB exports/restores its wishlist separately and preserves it during ownership restore. Clearing the ownership library preserves wishes in both extensions. Settings begins with imports, wishlist and Galactic Library linking, followed by provider-specific reminders, display, and backup/recovery.


## Imports and settings

The purchase importer groups its description, three account controls, and status/actions into separate rows. Account nickname is a local name, not a detected login. Confirm the signed-in website account before importing. A successful full rescan can switch the active snapshot and archive the previous account for backup recovery; ownership matching does not combine archived accounts. Expand the account help for details.

Both companions offer a searchable, paged wishlist with editable priorities and separate wishlist export/restore. Wishes influence planning on bundles you open; there is no background bundle discovery or wishlist notification. Each companion keeps its own wishes. Both offer ownership backups and a title catalog export containing identity metadata only. Ownership backup formats remain provider-specific: FAN full backups include wishes and reset scan authority on restore; HB preserves wishes during ownership restore and exports them separately. Clearing the library preserves wishes, display preferences and pairing.

HB's optional manual title replacement and reviewed collection mappings live under Advanced in Settings, with a shipped JSON example and review instructions. HB collects local Humble key reminders and can manually share them with GL; FAN reads the linked GL reminder list. Privacy explanations reflect each provider's actual storage behavior.
