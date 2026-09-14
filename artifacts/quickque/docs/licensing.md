# Offline licensing and release setup

This implements public-key signed leases, not a claim to reproduce Sketch's private protocol. The testing bypass remains available under Settings → Help & diagnostics → Developer options. Disable it when testing real licence enforcement; it deliberately overrides purchase status.

## Product policy

- Free: model installation, voice recording/verification, speech setup, audio generation and manual reading. Voice Follow and saved AI playback have a 30-second allowance per reader session. Export requires Pro. This allowance is the primary upgrade prompt.
- Monthly: a lease expires at the earlier of 30 days after issuance and the prepaid subscription period end. Renewal is due after 24 hours; the app checks hourly. A customer may cancel renewal at any time, but Pro remains active until the end of the current paid 30-day period and then returns to Free. Connectivity failures leave a valid local lease untouched.
- Lifetime: a perpetual lease has no offline expiry and grants the included Pro features on no more than two activated devices. Lifetime includes future Quickque updates when they are released, but it does not guarantee that updates, support or operating-system compatibility will continue. New paid features may use new feature entitlements and require a separate licence or paid upgrade.
- Refund/revocation: Quickque does not voluntarily offer refunds or prorated subscription refunds, subject to rights that cannot legally be waived. The server issues a signed revocation at the next successful check-in when legally or operationally required. A completely offline perpetual lease cannot be remotely revoked; this is the deliberate consequence of perpetual offline access. Subscription revocation latency is bounded by its existing lease expiry.
- Chatterbox: every Chatterbox runtime, model and related asset remains subject to its applicable Chatterbox, Resemble AI and third-party licence terms. A Quickque entitlement controls access to Quickque features; it does not replace or expand rights granted by those licences.

## Trust and storage

The issuer uses Node's Ed25519 implementation; Rust uses ed25519-dalek strict verification. The signature covers `quickque-lease-v1\n<keyId>\n<base64url payload>`. Unknown keys, tampering, wrong product/schema/device and invalid policy are rejected. The envelope is verified before claims become trusted. Key rotation uses a compiled allowlist of public keys.

Mac identification hashes the stable IOPlatformUUID with a Quickque-specific domain. Raw serial numbers, network addresses and script/voice contents are not sent. OS updates do not change this fingerprint. The purchase key and signed envelope live in macOS Keychain. Clock high-water marks and a monotonic in-process clock detect ordinary rollback; a valid online renewal can recover after correcting the clock. This is not resistance to a user patching the binary or restoring an entire machine backup.

## Configure a test deployment

1. Generate Ed25519 keys using `node artifacts/api-server/scripts/licence-admin.mjs keys directory=/secure/location id=production-1`. Do not commit the generated private key.
2. Apply `lib/db/migrations/0001_licences.sql`, then `0002_licence_purchase_identity.sql`, to the intended PostgreSQL database. These migrations are supplied but are not automatically run at application startup.
3. Set server secrets `QUICKQUE_LICENCE_PRIVATE_KEY` (PEM), `QUICKQUE_LICENCE_KEY_ID` and `DATABASE_URL`. Deploy the existing API server over HTTPS. Routes: POST `/api/licences/activate`, `/renew`, `/deactivate`; request `{ licenceKey, deviceId }`. Successful responses are signed envelopes. Purchase keys are hashed in the database. Transactions serialize device allocation (two Macs by default).
4. Build the desktop app with `QUICKQUE_LICENCE_PUBLIC_KEYS` set to the JSON array from public-keys.json and `QUICKQUE_LICENCE_SERVER=https://your-host/api/licences`. `QUICKQUE_RELEASE_TIMESTAMP` remains in the lease schema for compatibility with older test leases but does not limit Lifetime updates. Never embed the private key.
5. Grant a test entitlement with `node artifacts/api-server/scripts/licence-admin.mjs grant plan=perpetual email=customer@example.com` or `grant plan=subscription paid-through=YYYY-MM-DD email=customer@example.com`. This prints the random purchase key once for operator delivery. Activate it in Settings → General with the testing bypass off.
6. Exercise offline launch, expired subscription returning to Free, modified lease, the two-device limit, deactivation, clock correction, and Lifetime access on a later app release. Full Keychain/device/audio verification requires a Mac build.

No production key, licence endpoint, entitlement database or Stripe checkout is provisioned by these code changes. Unconfigured builds explain that activation is unavailable and retain the testing bypass. Monthly/lifetime buttons do not simulate a completed purchase.

## Stripe boundary

Purchase records associate a stable licence UUID with a customer email and optional Stripe customer, subscription and checkout references. Email lookup ignores case and surrounding whitespace, but email is neither a unique purchase ID nor proof of ownership. Changing it must not change licence or device identity. Existing test records may have no email; their migrated `purchased_at` is the migration time, not a recovered historical purchase date. New operator grants require email. Production fulfilment must populate the verified checkout references; unique checkout/subscription indexes prevent duplicate purchase rows.

Email stays on the server and is not included in the signed lease. Future recovery must verify mailbox ownership before replacing a key or allowing device management; never return licence details simply because someone supplies an email. Recovery is not implemented yet. The database stores authoritative purchases and activations; the app stores the current signed lease. Keeping every lease blob is unnecessary for offline validation. A future issuance audit can record lease ID, licence ID, device hash and timestamps without raw keys or customer email.

Add a server-only fulfilment handler after verifying Stripe webhook signatures and recording event IDs for idempotency. Only verified billing events may create or extend `paid_through`, grant Lifetime, or revoke access. New paid features must use explicit feature entitlements rather than silently narrowing an existing Lifetime licence. Never accept plan, features or expiry from the desktop or checkout return URL. The lease endpoint reads the authoritative entitlement row. Do not expose the operator grant CLI as an unauthenticated HTTP endpoint. Configure a shared rate limiter at the deployment edge when running multiple API instances (the included in-process limiter is per instance).

## Validation

`cargo test --manifest-path lib/licence-core/Cargo.toml`
`node --test artifacts/api-server/tests/lease.test.ts`
Frontend and browser regression tests cover onboarding, licence settings, trial stop and upgrade choices. The pure Rust verifier is testable on Linux without Tauri's desktop GUI dependencies.
