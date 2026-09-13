# Offline licensing and release setup

This implements public-key signed leases, not a claim to reproduce Sketch's private protocol. The testing bypass remains available under Settings → Help & diagnostics → Developer options. Disable it when testing real licence enforcement; it deliberately overrides purchase status.

## Product policy

- Free: model installation, voice recording/verification, speech setup, audio generation, manual reading. Voice Follow and saved AI playback have a 30-second session allowance. Export requires Pro.
- Monthly: a lease expires at the earlier of 30 days after issuance and the prepaid subscription period end. Renewal is due after 24 hours; the app checks hourly. Connectivity failures leave a valid local lease untouched.
- Lifetime: one calendar year of updates from purchase. A perpetual lease has no offline expiry, but includes `updatesUntil`. Each app build embeds its immutable release timestamp; only versions released on/before that date grant Pro. A renewal of update coverage changes the server entitlement, not the original app.
- Refund/revocation: the server issues a signed revocation at the next successful check-in. A completely offline perpetual lease cannot be remotely revoked; this is the deliberate consequence of perpetual offline access. Subscription revocation latency is bounded by its existing lease expiry.

## Trust and storage

The issuer uses Node's Ed25519 implementation; Rust uses ed25519-dalek strict verification. The signature covers `quickque-lease-v1\n<keyId>\n<base64url payload>`. Unknown keys, tampering, wrong product/schema/device and invalid policy are rejected. The envelope is verified before claims become trusted. Key rotation uses a compiled allowlist of public keys.

Mac identification hashes the stable IOPlatformUUID with a Quickque-specific domain. Raw serial numbers, network addresses and script/voice contents are not sent. OS updates do not change this fingerprint. The purchase key and signed envelope live in macOS Keychain. Clock high-water marks and a monotonic in-process clock detect ordinary rollback; a valid online renewal can recover after correcting the clock. This is not resistance to a user patching the binary or restoring an entire machine backup.

## Configure a test deployment

1. Generate Ed25519 keys using `node artifacts/api-server/scripts/licence-admin.mjs keys directory=/secure/location id=production-1`. Do not commit the generated private key.
2. Apply `lib/db/migrations/0001_licences.sql` to the intended PostgreSQL database. The migration is supplied but is not automatically run at application startup.
3. Set server secrets `QUICKQUE_LICENCE_PRIVATE_KEY` (PEM), `QUICKQUE_LICENCE_KEY_ID` and `DATABASE_URL`. Deploy the existing API server over HTTPS. Routes: POST `/api/licences/activate`, `/renew`, `/deactivate`; request `{ licenceKey, deviceId }`. Successful responses are signed envelopes. Purchase keys are hashed in the database. Transactions serialize device allocation (two Macs by default).
4. Build the desktop app with `QUICKQUE_LICENCE_PUBLIC_KEYS` set to the JSON array from public-keys.json; `QUICKQUE_LICENCE_SERVER=https://your-host/api/licences`; and `QUICKQUE_RELEASE_TIMESTAMP` set to this release's Unix timestamp in seconds. Preserve that timestamp when rebuilding the same released version. Never embed the private key or derive release eligibility from the user's clock.
5. Grant a test entitlement with `node --experimental-strip-types artifacts/api-server/scripts/licence-admin.mjs grant plan=perpetual` or `grant plan=subscription paid-through=YYYY-MM-DD`. This prints the random purchase key once for operator delivery. Activate it in Settings → General with the testing bypass off.
6. Exercise offline launch, expired subscription, modified lease, device limit, deactivation, clock correction, and an app release after the perpetual update cutoff. Full Keychain/device/audio verification requires a Mac build.

No production key, licence endpoint, entitlement database or Stripe checkout is provisioned by these code changes. Unconfigured builds explain that activation is unavailable and retain the testing bypass. Monthly/lifetime buttons do not simulate a completed purchase.

## Stripe boundary

Add a server-only fulfilment handler after verifying Stripe webhook signatures and recording event IDs for idempotency. Only verified billing events may create/extend `paid_through`, set the original one-year `updates_until`, or revoke access. Never accept plan/features/expiry from the desktop or checkout return URL. The lease endpoint reads the authoritative entitlement row. Do not expose the operator grant CLI as an unauthenticated HTTP endpoint. Configure a shared rate limiter at the deployment edge when running multiple API instances (the included in-process limiter is per instance).

## Validation

`cargo test --manifest-path lib/licence-core/Cargo.toml`
`node --test artifacts/api-server/src/licensing/lease.test.ts`
Frontend and browser regression tests cover onboarding, licence settings, trial stop and upgrade choices. The pure Rust verifier is testable on Linux without Tauri's desktop GUI dependencies.
