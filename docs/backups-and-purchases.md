# Recoverable backups and purchase origins (FAN-05 / FAN-06)

**Export backup** saves active Fanatical product identity, bibliographic matching evidence, all purchase origins and account/profile archives. Restore accepts legacy version 1 and scoped version 2 backups, replaces ownership state after confirmation and rejects an invalid later record before writing. Unknown fields, credentials, raw order IDs, redemption values and private download URLs are excluded at every level.

**Export title catalog** is a distinct portable format containing only titles, media types and catalog identity. It excludes purchase dates, bundles, origins, account labels and ownership assertions. A catalog cannot be restored as ownership evidence. Use the full backup for recovery.

Scan fingerprints, active worker leases and session tokens are not recoverable authority. Restoring resets scan history, summaries and failure flags so a new scan rechecks every completed order. Pairing/display preferences remain device settings and are not included. Account archives are backup-only and never supply current ownership.

A product is stored once by Fanatical product ID. Each purchase origin retains its bundle/date and an opaque SHA-256 purchase reference; repeated copies of a product in the same order/bundle have a quantity. Raw order IDs never leave the page. Full scans rebuild all observed origins; quick scans merge new origins while preserving older ones and replacing repeated references rather than inflating copies. Legacy backups retain available bundle/date provenance without inventing distinct purchase identities. A full rescan can recover more occurrences from the provider.

The evidence inspector lists origin bundles, dates and quantities, without the private opaque reference. Catalogue ownership recognizes every originating bundle instead of only the most recent one. Tests exercise separate purchases on full/quick scans, duplicate quantities, idempotence, secrets in nested origins and profile-archive backup round trips.
