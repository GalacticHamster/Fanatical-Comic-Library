# Release notes

## 1.0.3 — Release candidate

- Show bounded progress and waiting feedback during long-running purchase imports, helping distinguish active work from delayed order responses.

This is a small maintenance update since published 1.0.2. The remaining changes improve regression coverage; they do not add matching, ownership, import or purchase-synchronization features. Prepared locally for review; not submitted or published. Permissions and protocols are unchanged.

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
