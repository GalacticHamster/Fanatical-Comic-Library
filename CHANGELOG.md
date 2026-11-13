# Release notes

## 1.0.5

- Fixed imports failing after navigating to Fanatical's Orders page, improved handling of promotional items in purchases, and expanded diagnostics for incomplete imports.

## Unreleased ? automatic local sharing

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
