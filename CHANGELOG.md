# Release notes

## Unreleased

- A purchase with a part the scan cannot read no longer withholds its other products. Products whose bundle or pick-and-mix selection the order list confirms, each with its own product ID, are saved with the purchase's date and quantity. An unrecognized product type, a bundle missing from the order details, an unexpected or mismatched bundle and a malformed promotional item stay unresolved. The purchase is not marked complete and every later scan reads it again; a re-read never adds a second copy, and once every part is recognized the purchase completes normally. Promotional gifts are never saved as owned, and nothing is matched by title alone.
- The scan message says when items from a partly readable purchase were saved, and Options says how many unresolved purchases had verified items saved. Scan reports add `partialPurchasesSaved`, `partialProductRecordsSaved`, `partialProductRecordsPreviouslySaved` and a count-only `compatibility.components` section. A `parent-missing` report also says how many order-list items are promotional and whether a promotional item in the order details has an ID, which separates a renamed gift from a purchase missing from the order details. Earlier reports remain valid.
- A Full-scan batch that saves only the verified parts of partly readable purchases no longer ends the scan as if nothing had been read.
- Uses shared Fanatical acquisition revision fanatical-v1-79f0891654940a39.

## 1.0.6

- A purchase change saved while Galactic Library is sending purchases to Fanatical Library is now always sent to Galactic Library in the same sync, including with Galactic Library 1.0.4. Previously both extensions could show Synced until the next change.
- After a Full scan that ends with unread orders, or is paused or cancelled, Options reports how many purchases the whole scan verified, not only its last batch of up to 200 orders.

- Smaller consistency fixes with Humble Library: Library shows how many titles have a known purchase date; title details say "Verified order" and "N copies" instead of a shortened order hash and "Qty"; expanded Library rows stay open after a reminder review or a media change; unimported items are recovered with Import to library; the toolbar popup also counts verified orders; and the bundle panel leaves at least half of a short window clear and scrolls inside.

- Titles and Bundles & Orders can be sorted by Recently added, as in Humble Library. Fanatical Library now records when a scan or Galactic Library import first saves each product in this browser; it is kept by later scans, backups and restores and is never shown as a purchase date or shared. Products saved before this version have no such time and are listed after, newest purchase first; no time is invented for them. An opened purchase says when it was first saved.

- A bundle page's Already purchased notice lists every saved purchase of the bundle, as in Humble Library: how many times it was bought, then each purchase's date, oldest first, with copies bought in quantity. A purchase without a saved date says "date unknown" instead of hiding the notice, and an earlier record that may be the same purchase as a verified order makes the count "at least".

- Purchase dates use the same calendar day as Humble Library: Titles, Bundles & Orders and reminder cards show a timestamp's day in this browser's time zone instead of in UTC, matching the CSV catalog, and a date saved without a time of day (exactly midnight UTC) shows that date. Purchase date (oldest) sorts titles by their first purchase instead of their latest, as in Humble Library; titles without a known date stay last, and the Library note says how each date sort works. Saved dates are unchanged.

- Key reminder cards follow Humble Library's layout: the order link comes first, then Dismiss and Snooze, and the status reads Not yet revealed or Key status unknown with a sentence saying what Fanatical reported. The views are ordered as in Humble Library, and the reminder section shows one count for the selected view.

- Bundles & Orders matches Humble Library's purchase browsing more closely. A search for a contained title counts the matching titles on each purchase and lists them first, marked Match, when it opens. Purchases can be filtered by contents (games, books or comics, software, audiobooks, video or mixed media) and to bundles bought more than once, and sorted by most or fewest products. An opened purchase lists its media, bundles and standalone products, copies bought in quantity, whether it is a verified order and how many separate purchases share its name. Contents name a bundle only when it differs from the purchase name and appear in batches of 100.

- An unfinished Full scan is visible and controllable, as in Humble Library. The Orders panel and Options show how many orders it verified and saved, when, and how long the progress is kept, with Continue full scan and Discard unfinished scan. While a Full scan runs, the panel shows saved progress per batch and offers Pause, which keeps the progress for Continue, and Cancel, which discards it; both stop after the batch being read. Stopping or discarding never removes saved purchases, and the last complete scan is not changed. The panel also shows the last scan in this browser and a Browse your library button.

- Restoring a backup adds it to the saved library instead of replacing it, as in Humble Library. Purchases, purchase records, corrections, wishes and saved accounts already in the browser are kept and the backup fills in what is missing; a saved account that the backup does not contain stays as a saved account. Each key reminder keeps its newer dismiss, snooze or restore decision, and the confirmation names what happens to the wishlist. Scan history is still reset for a safe recheck.

- Browse the Library by **Titles** or **Bundles & Orders**. Both views can open a verified Fanatical order, with Order History available for earlier records without a saved link.

- Key reminders can open the exact Fanatical order. Quick updates recover missing links when the order appears in the signed-in history. Order IDs stay local to the saved account.

- Key and access reminders display searchable, scrollable cards with separate snoozed and dismissed views. Cards link to Fanatical Order History and identify the purchase to look for.

- A Full scan in progress cannot carry saved batches across an account switch or library restore. Verified purchases already saved remain in the account that imported them.
- Bundle badges use **Owned elsewhere**, with store names available in the match explanation.

- The Library can be filtered to titles with No known purchase date, as in Humble Library. The toolbar popup formats large counts and, when nothing is saved yet, says to open the Fanatical Orders page.
- The bundle panel steps aside while a Fanatical dialog or the cart is open and returns unchanged afterwards, as in Humble Library. Moving, minimizing or expanding it, and purchase-sync or appearance updates, no longer recheck ownership or recreate badges; changes to saved purchases and display settings still refresh results.
- Export title catalog (CSV) gives spreadsheet-ready titles with purchase status, first and last purchase dates, a numeric purchase count with its confidence, source, bundle names and every purchase date, in the same columns as Humble Library's CSV. Both catalogs now list the same merged titles as the Library page; the JSON format is unchanged.
- An undated purchase among several orders of the same title is no longer shown with another order's date.
- Library rows count purchases instead of bundles, as Humble Library does: two orders of the same bundle are two purchases, a quantity of two in one order is two, and a total that may include the same order twice says "at least". Owned titles bought more than once show Owned ×N on bundle pages and "purchased N times" in the bundle summary. Ownership on other stores and promotional gifts are never counted. The Bought more than once filter replaces Multiple purchase origins.
- A game whose name is a dotted acronym now matches its undotted title on bundle pages, as in Humble Library: F.E.A.R. 2 and FEAR 2 are the same game. Sequel numbers, editions, remasters, collections, subtitles and other media are still kept apart.
- Rescan all purchases reads order details in batches of 200 and saves each batch's verified purchases as it goes. If the scan stops, running it again continues where it left off instead of starting over. The library is replaced and absent items move to history only once every order has been verified, as before.
- An unsafe optional store link on a saved purchase is left out of sharing instead of withholding the purchase. Withheld records and dropped links are counted in the connection limitations.
- A purchase whose free promotional gift is renamed in the order details, for example after it is revealed, now imports when the gift keeps the same item ID as in the order list. The gift is recorded as promotional, not owned; without a matching ID the purchase stays unresolved and retryable.
- Automatic Galactic Library pairing no longer fails with a generic connection error when saved purchases include comics, Unclassified or Video items, or a record that cannot be shared. Those records keep their saved media type; comics are shared as books, other unsupported types are not imported as owned titles in Galactic Library, and unshareable records are listed as connection limitations.
- Scan reports for an unmatched order-list item now say whether it carried an item ID and whether a promotional item shares it, without exporting either.

## 1.0.5

- Fixed imports failing after navigating to Fanatical's Orders page, improved handling of promotional items in purchases, and expanded diagnostics for incomplete imports.

## 1.0.4 — automatic local sharing

- Automatically pair the sole saved provider account on each side, including populated libraries; retain relationships over sharing OFF/ON. Preserve valid historical Humble key dates and isolate malformed optional observations. Correct sharing checkbox alignment and actionable connection diagnostics.

- Discover official Galactic Hamster companions automatically and share supported saved purchases locally by default. Upgrade legacy setup states without treating them as explicit opt-outs; remember the new sharing setting across restart and library restore.
- Preserve verified account mappings, additive purchase/history merges and save-time authorization. Ambiguous populated accounts still need a one-time account decision in Advanced.
- Keep standalone imports and reminders available without GL; share supported additional HB reminders through the mapped account without duplicate native reminders. No key values or provider credentials are shared.

## 1.0.3 — Release candidate

- Make Fanatical key reminders standalone, with purchase-specific dismissal, snooze, restoration, backup persistence and account isolation. Compatible consented GL sync shares the same reviews; GL remains the only optional desktop notifier.

- Record dated unrevealed-key observations for supported Steam purchases without reading or revealing keys. Share them through compatible, consented GL purchase sync and show them in Key and access reminders. Quick checks new purchases; Full refreshes older observations.

- Recognize standalone purchased game items with empty bundle arrays in authenticated orders, including pick-and-mix selections. Require exact order/product evidence and retain duplicate occurrences, partial-save safeguards and unverified array-only coverage.

- Refresh an already-open Library when imports commit in another tab, reading item/account context together and retaining unsaved settings drafts. Preserve exact detail-failure diagnostics when repeated sparse summary shapes reach the report limit.

- Check identity-bearing sparse completed summaries through authenticated order details instead of rejecting empty summary bundle arrays before requesting detail. Products still require matching identity/status/parent evidence and normal validation; unresolved details remain retryable with privacy-safe recovery counters.

- Add bounded, value-free structural diagnostics for rejected purchase bundle containers, distinguishing empty arrays from non-array representations without admitting unverified pick-and-mix products or changing import behavior.

- Accept identical purchase summaries with reordered JSON fields, without relaxing status, product or account checks. Scan reports separate unreadable statuses, product structures and detail failures using aggregate counts only; actionable order failures take precedence over technical coverage limitations. Unrecognized purchases remain retryable and earlier purchases are kept.

- Show bounded progress and waiting feedback during long-running purchase imports, helping distinguish active work from delayed order responses.

This is a maintenance update since published 1.0.2. Additional local corrections improve import compatibility and diagnostics without changing ownership or purchase-synchronization rules. Prepared locally for review; not submitted or published. Permissions and protocol versions are unchanged.

## 1.0.2

- Distinguish a clean purchase acquisition from verified full-history coverage. Headerless array responses can finish normally and support incremental updates without erasing purchases or claiming a complete scan. Actual order and pagination failures retain partial-import behavior. Clean acquisitions use concise success counts; technical coverage qualifications remain in Scan diagnostics. Scan reports now include privacy-safe response-shape and pagination-header presence counts.
- Save independently verified Fanatical orders atomically when another order or pagination fails. Partial scans preserve earlier purchases, corrections, history and the last complete-scan timestamp; unresolved orders remain retryable. Session/account conflicts still reject the entire save. Companion sharing continues to use the existing additions-only partial purchase protocol.
- Preserve specific purchase-scan failure categories across Chrome's page-script boundary instead of replacing them with a generic completeness warning. Orders now offers an explicitly downloaded scan report containing only aggregate counts, scan mode and failure categories. Ownership validation and transactional saves remain enforced.
- Initialize named accounts with a full scan when successful scan metadata or valid skip history is missing, including after restore. Established quick scans remain incremental.
- Validated partial imports can establish per-order skip eligibility without claiming a complete-library baseline. Bare responses without independent pagination/end evidence retain unverified coverage; backups retain their purchases but never restore private checkpoint authority.

## 1.0.1

- Request `unlimitedStorage` for large local libraries and purchase/account history in Chrome and Firefox. Import validation and single-write saves are unchanged; failed writes retain previous purchases, corrections and successful scan history. Disk exhaustion and browser-wide storage limits remain possible.

## 1.0.0 ? Local release candidate

- Import supported purchases from the signed-in Fanatical order history and refresh new purchases without repeatedly retrieving known details.
- Check Fanatical products and bundles with conservative Owned, New, Possible and Partial results, source explanations, tier summaries and optional planning controls.
- Use the extension independently, or connect optional Galactic Library checks and explicitly authorized saved-purchase synchronization.
- Reuse a default saved account for routine imports; keep additional accounts, purchase provenance and scan history separate.
- Export and restore supported library state locally. API session tokens, redemption values and live synchronization authorization are not part of library backups.

Incomplete provider pagination or uncertain identity does not become confirmed ownership. An API response without an independent total retains that completeness qualification. All provider access is read-only.

Prepared locally; not yet published.
