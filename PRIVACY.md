# Privacy Policy for Fanatical Library

Last updated: November 9, 2026

Fanatical Library is an unofficial browser extension for comparing a person's Fanatical purchase library with product and bundle listings. It is not affiliated with or endorsed by Fanatical.

## Data the extension handles

When the user imports purchases, the extension reads the signed-in Fanatical order list and order details. It saves supported item titles, media types, formats, product identifiers, purchase references, dates, bundle associations, and purchase provenance in the browser profile. It also saves scan fingerprints and summaries, profile labels and archived accounts, historical purchases, wishlist/planning information, media-type corrections, excluded import records, preferences, and companion connection state.

The importer temporarily reads the Fanatical session token from the site's signed-in state to authenticate requests to Fanatical's order API. The token is used in the page's import context, not retained in saved extension state, logs, backups, or companion transfers. Raw order responses are projected into supported metadata rather than saved wholesale. The extension does not request passwords or retain payment-card details or redemption-key values. This describes saved data handling, not a guarantee of immediate memory erasure.

For supported ordinary Steam purchases, the importer saves a dated non-secret observation when the order indicates an unrevealed key. It checks whether a key field exists without reading its value. Ambiguous or unsupported reveal evidence remains unknown. Local purchase-specific dismissal, snooze and restoration actions/dates are saved with the observations and included in full backups. Reveal status does not establish Steam activation, and the importer does not reveal or redeem keys.

Historical purchases can support history-only warnings; they do not by themselves establish current access. The user can also explicitly select a manual title file or backup for import.

## How data is used and shared

Saved data supports imports, matching, purchase history, planning, and exports. It is held in this browser profile. Provider requests, local companion exchanges, and user-created downloads are separate data flows; data is not confined exclusively to browser storage.

The extension does not send library data to a Galactic Hamster-operated server and has no analytics or advertising service. Imports request data from Fanatical using the signed-in session. Opening a provider, help, or optional support link visits that destination under its own privacy policy; this is separate from sending a library backup.

With a compatible installed Galactic Library companion, listing comparisons send titles, media types, and available identity metadata through local extension messaging. GL returns bounded matching and access information from other providers. This comparison is separate from purchase synchronization and does not send a full library backup or credentials.

**Automatic local sharing is on by default**, including after an upgrade from legacy unconfigured, disabled or disconnected settings. When compatible official Galactic Library and companion extensions are installed in the same browser profile, they discover each other and exchange supported saved purchases in both directions without a new provider scan. A versioned sharing preference records an explicit opt-out made under this model. Turn sharing off in the connection section to stop subsequent purchase transfers; startup, reconnect and library restore do not turn it back on. Previously saved copies are kept. Re-enabling sharing reconciles additively.

Transfers can include saved account references and labels, item/bundle identifiers, titles, available dates, formats, supported ownership evidence and purchase provenance. Compatible transfers also include supported dated non-secret Humble/Fanatical key observations and purchase-specific reminder dismissal, snooze and restoration decisions. Secret key values, provider credentials and session tokens are not shared. Exact sender, provider, stable account relationship and save-time permission checks remain required. Exactly one provider account in each extension is paired automatically, including populated accounts, and purchases reconcile additively. Multiple accounts use an established mapping or need a one-time choice in Advanced; conflicting relationships are not silently replaced. This single-account policy is not independent verification of a provider login, and display names are not identity evidence. Unavailable or older peers may delay synchronization. These are local browser-extension messages, not uploads to a Galactic Hamster-operated server.

Inbound companion communication includes status/review requests and authorized purchase transfer and synchronization operations. It is checked against companion identity, provider, account scope, and the authorization required for the operation. Fanatical Library does not publish Humble key-reminder feeds. These are local installed-extension exchanges, not developer-server uploads. Turning automatic sharing off stops subsequent purchase transfers but does not erase purchases already saved in either extension.

## Browser permissions used

- **storage** saves library data, preferences, account relationships, and local working state.
- **unlimitedStorage** allows large browser-local libraries, purchase histories and saved account snapshots to exceed the normal extension-storage quota. It adds no website access or remote storage. Disk space and browser-wide storage limits can still cause saves to fail; failed import saves retain previous purchases, corrections and successful scan history.
- **scripting** runs the signed-in order importer in the Fanatical page.
- **alarms** schedules purchase-synchronization work and retries.
- **Fanatical site access** reads listings, displays badges/planning overlays, and retrieves order history.

## Backup, restore, and deletion

**Export backup** downloads supported library items and purchase provenance, profile labels and archives, historical items, wishlist items, media-type corrections, excluded import records, and an informational import summary. It does not export all settings, companion pairing or sync authorization, scan fingerprints, or session tokens. Purchase references and account labels make backups private personal files.

**Restore backup** replaces the supported saved library state. It resets scan fingerprints, the active import summary, last-scan attempt, purchase-account mappings, and automatic purchase-sync relationships. The exported summary is informational, not trusted scan history; restore preserves the local sharing preference; account relationships are rediscovered only when safe. Older backup versions may lack fields such as wishlist or historical items.

**Clear library** removes current and archived library items, historical purchases, profile labels, import/scan state, media-type corrections, excluded import records, and purchase-sync relationships. It leaves wishlist items, general preferences, and the companion override in place. Uninstalling removes extension storage according to normal browser behavior. Neither action deletes downloaded backups, browser history, provider records, or copies already saved by GL. These controls are not a secure-erasure guarantee.

The automatic-sharing preference stays unchanged by library restore or clear. Restoring a previously mapped dataset revokes old in-flight transfer tickets. A retained relationship can be revalidated automatically only when the same saved dataset IDs still exist and no live account relationship conflicts; multiple ambiguous or conflicting restored relationships need a new account decision. This does not use account nicknames as identity evidence.

## Changes to this policy

This policy and applicable store disclosures should reflect changes to the extension's data practices before release.
