# Quickque plans and disabled commerce

## Product model

The website describes these planned official-app tiers:

| Plan | Price | Voice Follow |
|---|---|---|
| Free | £0 | 30 seconds of active following per presentation/rehearsal session |
| Monthly | £2.50/month | Unlimited while the paid subscription is active |
| Lifetime | £25 once | Permanent unlimited Voice Follow in Quickque for Mac |

The confirmed lifetime price is £25, configured with `QUICKQUE_PRICE_GBP=25`.
That environment variable controls the lifetime price only. Monthly is 250 pence in site.json and is formatted server-side.

The confirmed Free allowance is 30 seconds per session. Pause/resume and
microphone restart within the same reader session do not reset the 30 seconds.
A new presentation/rehearsal session gets a fresh allowance. This is not a daily
cap or one-time total trial.
The native app now enforces the active-listening allowance, with standalone logic
tests passing; physical Mac verification remains outstanding. Paid entitlement
activation is not implemented.

Free includes the workspace, editing/import, manual/timed playback and Scene
Partner with system voices. Paid plans unlock unlimited Voice Follow, cached
Chatterbox performance dialogue, optional presentation narration, local audio
listening and audio-only MP4 export. The subscription
renews until cancelled; cancellation preserves access to the end of the paid
period, then Free applies without deleting or locking scripts. Lifetime includes
future updates to these paid features in Quickque for Mac, not separate future products
or services and not a perpetual support/OS-compatibility guarantee. Planned
paid access is per person on their own Macs; personal/commercial use is allowed.

These website terms do not change the repository's MIT licence or remove the
right to modify, build and redistribute that source. Root LICENSE is unchanged.
A feature entitlement is distinct from source-code licensing. Existing MIT
rights must not be described as revoked by a future commercial distribution.

## Obsidian research

Reviewed official https://obsidian.md/pricing and https://obsidian.md/license
on 2026-09-12, using a sub-agent as requested. Obsidian core is free. Its $25
one-time Catalyst payment supports development and provides perks; it is not a
lifetime unlock of paid application features. Sync/Publish subscriptions are
separate services. Quickque adopts the free-core/optional-paid structure with
its own feature unlock and original wording, not a copy of Obsidian's terms.

## Current payment boundary

Payments and paid activation are disabled. The public plan buttons say coming
soon. The optional, explicitly labelled dummy checkout charges nothing,
collects no billing/contact/payment information, and creates no subscription,
order, receipt, licence, entitlement or download. No payment provider is called.
There is no verified prebuilt Mac release currently offered by this website.

The workspace contains no payment-provider runtime or connection requirement.
Disabled legacy commerce endpoints return HTTP 410 and cannot create or verify
purchases.

## Remaining implementation before sales

Verify the native session timer on a Mac. Implement monthly/lifetime entitlement
verification and expiry, and a
way to manage/cancel subscriptions. Prepare real monthly and lifetime products,
fulfilment, receipts, required tax disclosures and refund/cancellation handling.
Agree the activation/offline behaviour and test it without ever sending scripts
or microphone content to billing systems. Validate the Mac distribution and
replace the dummy flow deliberately. None of this is accomplished by editing
the website, and the page states that limitation explicitly.

## Saved AI audio implementation

Chatterbox generation, cached playback and MP4 export are paid app features.
The owner requested a temporary Settings → Debug → Licensed mode toggle.
It is available in packaged test builds, defaults to Unlicensed, and persists
on the Mac. Native generation, playback/export and Voice Follow use that setting.
This deliberately simulates access; it is not payment or licence verification.
Browser preview stores only its own simulated setting; native audio remains Mac-only.
Performance edits queue Chatterbox AI Partner audio after saved changes; presentation
audio is generated only by explicit request. Matching revisions are required for
rehearsal and export. Exported MP4s remain user files after subscription expiry.
See the app's `docs/SCRIPT_AUDIO.md` for implementation and Mac verification.

No future payment provider is selected. Checkout remains dummy until the owner
chooses and deliberately configures a provider; do not issue paid licences.
