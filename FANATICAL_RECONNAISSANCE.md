# Fanatical Library Technical Reconnaissance

## Scope

This document records technical reconnaissance for a possible standalone,
browser-local Fanatical ownership extension. It is not an implementation plan
authorization and contains no implementation code.

## 1. Current Fanatical architecture observed

Fanatical is an SPA with structured same-origin JSON behind its product routes.
The page HTML is therefore a rendering target, not the preferred data source.

Public data is suitable for identity, pricing, tier composition, availability,
DRM, and platform metadata. Authenticated purchase import requires the
logged-in page context because the current session token lives in
`localStorage.bsauth.token`.

## 2. Public bundle endpoints

| Bundle kind | Observed endpoint | Proven shape |
|---|---|---|
| Standard / tiered | `/api/products-group/{slug}/en` | Parent product plus `bundles[]` groups containing `games[]` |
| Pick & Mix | `/api/pick-and-mix/{slug}/en` | Parent plus `products[]`, `tiers[]`, and `ordering[]` |

The comic bundle response proved that a tiered bundle exposes:

- Parent `_id`, slug, name, type, display type, DRM, availability, and price data.
- Tier/group `bundles[]`, each with a price and product list.
- Leaf product `_id`, name, slug, `type`, `display_type`, DRM, platforms,
  download formats, ISBN, author/publisher/page metadata where applicable.

The 47 public comic leaf IDs exactly matched the 47 purchased order-item leaf
IDs. This makes the public data source the primary identity source.

The currently observed Pick & Mix response contains:

- 17 full products in `products[]`.
- Three `tiers[]`: 3 for $4.95, 5 for $7.99, or 7 for $10.49 USD.
- `ordering[]` of product slugs for display order.
- Per-product `_id`, slug, title, Steam App ID, DRM, platform, region
  availability, visibility, sold-out, and low-stock status.

Its detail response says `type: "bundle"` despite being Pick & Mix. Detect it
from the route or the `products[]` plus quantity-based `tiers[]` shape.

## 3. Pick & Mix recommendation

The extension can annotate every selectable product without touching the cart:

- **Owned** — exact locally imported Fanatical product ID.
- **Owned elsewhere** — exact external ownership, such as a Galactic Library
  Steam match.
- **Possible** — a conservative title/edition relationship.
- **New** — no meaningful match.

Useful bundle-level summary:

- selectable products;
- owned / possible / new counts;
- available unowned count;
- selected quantity;
- price per selected item.

`/api/basket` is a POST endpoint that updates server-side cart state. The
request body may be a full basket snapshot and does not reliably retain Pick &
Mix parent/tier identity. The extension must never call it.

A `MutationObserver` is appropriate for reinserting badges after SPA
navigation, filtering, sorting, or card rerenders. It must only add a separate
non-interactive badge element and never alter selection controls, click
handling, or cart state.

## 4. Authenticated order history

Observed authenticated endpoints:

```text
GET /api/user/orders
GET /api/user/orders/{orderId}
```

The orders list returns completed order summaries. The detail response contains
the purchased parent bundle/item and all individual delivered products.

The signed-in browser session alone was insufficient for a plain same-origin
fetch: it returned `401`. A page-context request with:

```js
Authorization: JSON.parse(localStorage.bsauth).token
Accept: application/json
```

returned `200`. No CSRF token, fingerprint, or client-version header was
needed in the tested flow.

The importer should use a narrowly scoped page-context bridge:

1. Read `bsauth.token` only in page context.
2. Request the two fixed order endpoints.
3. Immediately project the raw results into an allowlisted ownership record.
4. Send only that projection to extension context.
5. Never store, message, log, or expose the token or raw responses.

For the tested comic order, the safe retained fields are:

```text
order ID, order date, complete status,
parent product ID, bundle title/slug,
leaf product ID, title/slug, type/display type,
truthy DRM/platform flags, declared download formats
```

Do not retain download URLs, hashes, cover data, payment data, addresses,
supplier data, reports, or keys.

## 5. History and pagination limitation

The observed list response was an array and did not expose pagination metadata.
It may represent the full history, but that is unproven with one order.

Version 0.1 should import every returned order, record an import timestamp and
count, and clearly state that complete-history pagination is not yet verified.
A later account with a larger order history should validate whether `page`,
`limit`, cursor, or lazy loading exists.

## 6. Stable identifiers

Identity precedence should be:

```text
Fanatical leaf product _id
→ external platform ID (Steam App ID; ISBN where present)
→ exact normalized title + compatible media type
→ structured edition/collection relationship
→ conservative possible match
```

Notes:

- Fanatical leaf `_id` is the primary local ownership key.
- Fanatical parent/bundle `_id` is useful purchase provenance but must not
  replace leaf ownership.
- Steam IDs are strongly useful for games and Galactic integration.
- ISBN is available for many comics/books, but not all.
- Slugs are useful URLs/display references, not the primary identifier.
- Software/assets can use Fanatical product IDs even if no external identity
  exists.

## 7. Matching semantics

Reuse Humble Comic Library's normalization and conservative matcher philosophy,
but keep Fanatical source IDs first.

| Situation | Result |
|---|---|
| Same Fanatical leaf ID | Owned |
| Same Steam App ID, compatible game edition | Owned elsewhere / Steam |
| Same ISBN | Owned |
| Same normalized title, edition uncertain | Possible |
| Deluxe/Gold/Complete vs base game | Possible unless exact product/external ID proves equivalence |
| Collection with enumerated members partly owned | Partial |
| Generic franchise/publisher similarity | New, not Possible |

`Partial` should only be used when the product has a known enumerable
composition. It should not be inferred merely because titles seem related.

## 8. Galactic Library integration

Galactic Library should remain optional.

Fanatical Library sends title-only normalized candidates compatible with
Galactic's current `MATCH_ITEMS` contract for:

- games;
- books;
- audiobooks.

It should not send software, assets, eLearning, or audio unless Galactic
expands its supported media model.

Presentation rule:

```text
Fanatical imported ownership → Owned
Galactic exact ownership only → Owned elsewhere + provider label
Galactic possible match only → Possible
No match → New
```

Never call an externally owned Steam item "Owned on Fanatical."

Current Galactic pairing/API validation is Chrome-oriented. Firefox support
needs explicit future work in Galactic Library's external-extension ID
validation; it is not a reason to block Fanatical's standalone functionality.

## 9. Privacy and permissions

Recommended minimum:

```text
storage
scripting
host access: https://www.fanatical.com/*
```

No cookies permission, broad browsing permission, backend, analytics,
telemetry, remote storage, or API key is justified.

`scripting` is needed only if the chosen cross-browser implementation requires
a narrowly scoped main-world importer bridge. Public bundle reads can otherwise
remain ordinary content-script work.

## 10. MVP recommendation

| Feature | Priority | Difficulty |
|---|---|---|
| Local purchase-history import | P0 | Moderate |
| Standard and tiered bundles | P0 | Easy |
| Games | P0 | Easy |
| Books/comics | P0 | Easy |
| Pick & Mix annotations | P0 | Moderate |
| Exact Fanatical-ID matching | P0 | Easy |
| Conservative title/edition possible matches | P0 | Moderate |
| Software/assets | P1 | Moderate |
| eLearning/audio | P1 | Moderate |
| Galactic Library integration | P1 | Moderate |
| Collection/pack expansion | P2 | Difficult |
| Checkout/cart automation | Not recommended | High-risk |

## 11. Recommended architecture

Choose **E: a standalone Fanatical extension with optional Galactic Library
integration**.

Initially, it should remain physically separate from Humble Comic Library to
avoid destabilizing existing users and to preserve site-specific permissions.
It can follow Humble's proven design for normalization, local storage, matcher
behavior, safe importer handling, UI lifecycle, and extension-to-extension
messaging.

After the Fanatical matcher has parity tests, extract only genuinely shared
pure logic into a small shared source/build package. Do not refactor Humble
first.

## 12. Concrete implementation sequence

1. Define strict local ownership schema and migrations.
2. Build the page-context authenticated importer with allowlisted projection
   and key redaction.
3. Implement exact Fanatical-ID, Steam-ID, ISBN, and normalized-title matching.
4. Add the standard/tiered public endpoint adapter.
5. Add Pick & Mix adapter and non-interactive card annotations.
6. Add SPA navigation and rerender handling.
7. Add import/export, reset, and privacy UI.
8. Add optional Galactic `MATCH_ITEMS` pairing and result cache.
9. Validate Chrome and Firefox behavior separately.
10. Later test multi-page order history and a game order response without
    persisting any key material.

## Remaining unknowns

- Whether `/api/user/orders` is paginated for large histories.
- Exact game-order key/redemption response shape.
- Direct sampled responses for software/assets, eLearning, and audio bundles.
- Stable DOM selectors/card structure for badge placement across every Fanatical
  layout.
- Firefox compatibility for Galactic's current external-message pairing.

These are bounded validation tasks, not reasons to delay the P0 design.
