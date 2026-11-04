# Release notes

## Unreleased

- Request `unlimitedStorage` for large local libraries and purchase/account history in Chrome and Firefox. Import validation and single-write saves are unchanged; failed writes retain previous purchases, corrections and successful scan history. Disk exhaustion and browser-wide storage limits remain possible.

## 1.0.0 ? Local release candidate

- Import supported purchases from the signed-in Fanatical order history and refresh new purchases without repeatedly retrieving known details.
- Check Fanatical products and bundles with conservative Owned, New, Possible and Partial results, source explanations, tier summaries and optional planning controls.
- Use the extension independently, or connect optional Galactic Library checks and explicitly authorized saved-purchase synchronization.
- Reuse a default saved account for routine imports; keep additional accounts, purchase provenance and scan history separate.
- Export and restore supported library state locally. API session tokens, redemption values and live synchronization authorization are not part of library backups.

Incomplete provider pagination or uncertain identity does not become confirmed ownership. An API response without an independent total retains that completeness qualification. All provider access is read-only.

Prepared locally; not yet published.
