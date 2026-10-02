# Fanatical profiles and safe scan commits

The orders panel asks for a local profile label and confirmation that it matches the signed-in Fanatical account. These are user declarations, not automatic account detection. Use different labels for different accounts. A first assignment forces a full scan; changing an established label also requires Full scan and the explicit switch checkbox.

The worker scans the requesting orders tab, rather than whichever tab happens to be active. A persisted token binds the scan to that tab. Short mutations are serialized; network requests run outside the queue. Restore, clear, or a newer scan prevents an older result from committing. Failed stale scans cannot recreate warnings after a clear or restore. Worker restart preserves the scan token. Overlapping runtime imports are still rejected while the worker is awake.

A successful account switch archives the old profile's items and starts with independent order fingerprints. Failed switches keep the old active library. Previous profiles are excluded from matching and retained in scoped version-2 and version-3 backups. Legacy version-1 backups remain supported; restoring any backup resets fingerprints so the next scan rechecks the source. Settings remain separate from restored library state.

The MAIN-world scanner also refuses a scan if its authentication token changes between the start and finish. Tokens never leave that execution world. This catches session changes during scanning, but cannot identify an account change made before scanning with a reused local label.

Reload the extension and Fanatical pages after upgrading. Synthetic pagination, failure, profile, and concurrency fixtures do not substitute for testing a real large signed-in account. Where the service supplies only an array without pagination metadata, coverage diagnostics continue to disclose that silent truncation cannot independently be ruled out.


FAN-04 verification: the shipped serialized importer is tested with 5,000 completed orders across 100 pages, plus a 1,000-order quick scan that reads all 25 list pages but fetches only five unseen details. Detail concurrency stays at three. Tests cover cursor/Link, consistent count and contiguous range metadata, retries, deadlines, failure cancellation, known-order omissions, loops, repeated orders and remembered last-page links. Missing/changing last-page evidence now rejects the whole scan. A bare array has no independent total: the UI explicitly states that silent server truncation cannot be ruled out. These synthetic tests verify supported contracts; they do not certify what an unobserved real large Fanatical account returns.

Installed release verification additionally exercises the actual Chrome content/worker/MAIN boundary with locally intercepted synthetic order responses: full 200-order/10-page coverage, quick 201-order/11-page coverage fetching one new detail, and a pagination failure retaining all purchases, origins, fingerprints and the prior success summary. No real Fanatical account is required for these tests.
