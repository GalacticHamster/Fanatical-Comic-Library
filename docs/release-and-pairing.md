# Release and pairing verification (FAN-07 / FAN-09 / FAN-11 / FAN-14)

Run node scripts/package-release.mjs to build dist/FanaticalLibrary-<version>.zip, its SHA-256 file and a file/hash report. The explicit runtime-files.json allowlist contains only the manifest and required runtime assets. Dependency validation checks manifest entries, module imports, HTML scripts/styles and CSS references. Real paths cannot leave the repository through symlinks/junctions. ZIP order, timestamps and normalized text line endings are fixed. Tests, wrappers unused by the runtime, documentation, exports, profiles, reconnaissance and Git history are excluded. No adjacent repo is required to build it.

Run node --test for regressions and node tests/browser-check.mjs --release for the actual packaged runtime in isolated Chrome fixtures. Projection tests call the same self-contained order importer that Chrome serializes into the page; the standalone bundle parser is also a thin wrapper around the live parser. Package tests check syntax, reproducibility across checkouts, missing dependencies, checksum tampering and unsafe paths.

Pairing Test link checks both PING and GET_STATUS, validates version/success and discloses supported media, reviewed contents and entitlement reminders. An unsuccessful or malformed lookup stays incomplete and is not an available zero-match result. Transport details and returned error strings are not displayed. Software comparisons require affirmative software capability; older versions keep them local. Capability failures remain unconfirmed.

Local Fanatical purchases are authoritative. Requests exclude central Fanatical copies, and a returned copy from an older/unfiltered API is review-only, never Owned elsewhere or owned contents. If local and central snapshots disagree, rescan the local Orders importer. Evidence explanations name the two sources without merging them.

Checks use synthetic provider responses and isolated browser profiles, not a signed-in personal account. They verify shipped behavior but cannot certify an unobserved real large-account response. Increase the manifest version before a published store update.
