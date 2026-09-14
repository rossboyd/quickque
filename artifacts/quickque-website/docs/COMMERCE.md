# Quickque plans and disabled commerce

## Product model

The website describes these planned official-app tiers:

| Plan | Price | Voice Follow |
|---|---|---|
| Free | Free | 30 seconds of active following per presentation/rehearsal session |
| Monthly | One tenth of the configured Lifetime price per 30-day period | Unlimited while the paid subscription is active |
| Lifetime | The amount configured by `QUICKQUE_PRICE_GBP` | Permanent access to the included Pro features on up to two devices |

`QUICKQUE_PRICE_GBP` is the only price source. The server converts that
Lifetime amount to pence, requires that it divides cleanly by ten, and derives
the Monthly amount as exactly one tenth. Components and static configuration
must not contain duplicated paid prices.

The confirmed Free allowance is 30 seconds per session. Pause/resume and
microphone restart within the same reader session do not reset the 30 seconds.
A new presentation/rehearsal session gets a fresh allowance. This is not a
daily cap or one-time total trial; it is the primary prompt to upgrade.

The native app enforces the active-listening allowance, with standalone logic
tests passing; physical Mac verification remains outstanding. Paid entitlement
activation is not implemented.

Free includes the workspace, editing/import, manual/timed playback and Scene
Partner with system voices. Paid plans unlock unlimited Voice Follow, cached
Chatterbox performance dialogue, optional presentation narration, local audio
listening and audio-only MP4 export.

Monthly renews every 30 days until cancelled. A customer may cancel renewal at
any time; Pro continues to the end of the current paid period, then the app
returns to Free without deleting or locking scripts, voices or exported files.
There is no prorated refund.

Lifetime permanently unlocks the included Pro features on up to two activated
devices and includes future Quickque updates when they are released. It is not
a guarantee that updates, support or operating-system compatibility will
continue. New paid features may require a separate licence or paid upgrade.

Quickque does not voluntarily offer refunds, subject to rights that cannot
legally be waived. Paid access is per person for no more than two devices;
personal and commercial use is allowed.

Every Chatterbox runtime, model and related asset remains subject to its
applicable Chatterbox, Resemble AI and third-party licence terms. Quickque's
feature entitlement does not replace or expand those licences.

These website terms do not change the repository's MIT licence or remove the
right to modify, build and redistribute that source. A feature entitlement is
distinct from source-code licensing.

## Update delivery

Sparkle 2 is the selected update mechanism for the packaged Mac app. The
appcast will be served over HTTPS from the Quickque website and will reference
signed, notarized release assets hosted on GitHub Releases. Sparkle updates
must remain disabled until:

- A Sparkle EdDSA key pair has been generated on a trusted Mac.
- Only the public key is embedded in the app.
- The private key remains in the release operator's macOS Keychain.
- The DMG is signed and notarized with Apple Developer ID.
- `generate_appcast` signs the release enclosure.
- The appcast and download URL are tested over HTTPS.

Never commit the Sparkle private key or publish an unsigned appcast enclosure.

## Current payment boundary

Payments and paid activation are disabled. The public plan buttons say coming
soon. The optional, explicitly labelled dummy checkout charges nothing,
collects no billing/contact/payment information, and creates no subscription,
order, receipt, licence, entitlement or download. No payment provider is
called.

## Remaining implementation before sales

Verify the native session timer on a Mac. Implement monthly/Lifetime
fulfilment, renewal, expiry, cancellation and the two-device limit. Prepare
real products, receipts, required tax disclosures and cancellation handling.
Validate the signed/notarized Mac distribution and Sparkle update path before
replacing the dummy flow.

## Saved AI audio implementation

Chatterbox generation, cached playback and MP4 export are paid app features.
The temporary Settings → Debug → Licensed mode toggle simulates access in test
builds. It is not payment or licence verification. Exported files remain user
files after subscription expiry.