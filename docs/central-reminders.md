# Central reminders and reading gaps (FAN-18)

Settings can manually load current entitlement reminders from the saved Galactic Library pairing. The default filter is Fanatical; All providers includes reported rentals, subscriptions and the separate Humble companion feed. Pages contain at most 50 reminders with explicit next/previous controls. No background full-library transfer or local duplicate reminder database is created.

The view requires the advertised entitlementReminders capability and validates API version, success, page length, offsets, provider, reminder kind and dates. Rejected, incomplete or malformed responses say Not checked, never zero matches. Unknown deadlines remain unknown. Only reported expiry dates are displayed; purchase and key revelation never establish destination-platform activation. Humble companion reports are identified separately and do not establish ownership.

Only titles, media/provider, reminder kind, reported dates, optional bounded key-status observations, severity and opaque references cross this reminder boundary. Extra response fields are dropped. Pairing changes and provider-filter changes clear the display and invalidate pending responses. Review in Galactic Library opens the trusted stored pairing; dismissal, snooze and reconciliation remain central. Notifications are handled by Galactic Library, not duplicated here.

Bundle summaries separately show central ownership/freshness/contents reminders and bounded series gaps through existing matching evidence. Issue/volume coverage respects run, language, specials and uncertainty; it is a compared span, not a publisher bibliography.

## Fanatical key observations

Supported ordinary Steam purchases can record a dated unrevealed-key observation without revealing or reading a key. A present key field or ambiguous evidence is treated as unknown, not as proof of activation. Other product types are not inferred from ownership alone.

Quick imports check new purchases; Full rescans refresh older observations. After importing, use Connect and sync for the intended Fanatical account, then Load reminders. Compatible GL receives the dated observations through that existing purchase-sharing permission and returns the reminder list. Older companions still share purchases but omit these optional observations.

The local count shows saved products with unrevealed observations. GL's count may differ because reminders can be dismissed or snoozed. Dismissing a reminder does not reveal a key or change ownership. Unchanged observations stay dismissed when refreshed; changed evidence can require a new review.
