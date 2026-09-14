# Sparkle update channel

Quickque will use Sparkle 2 for updates to the packaged macOS app. Do not add
Tauri's updater alongside it.

## Distribution layout

- Appcast: `https://quickque.rossly.co/appcast.xml`
- Release assets: GitHub Releases for `rossboyd/quickque`
- Supported build: Apple Silicon, macOS 26 or newer
- Verification: Sparkle EdDSA enclosure signature plus Apple Developer ID
  signing and notarization

## Release setup

1. On a trusted release Mac, use Sparkle's `generate_keys` tool once.
2. Keep the private key in that Mac user's Keychain. Never export it into this
   repository, Replit Secrets, CI logs or chat.
3. Embed only the generated public key as `SUPublicEDKey` in the packaged app.
4. Set `SUFeedURL` to the HTTPS appcast URL above.
5. Sign and notarize the app and DMG.
6. Upload the final release asset to GitHub Releases.
7. Run Sparkle's `generate_appcast` against the release directory so the
   enclosure receives its EdDSA signature.
8. Publish the resulting appcast at the configured website URL.
9. Install the previous signed release on a clean Mac and verify both automatic
   discovery and the manual **Check for Updates…** action.

## Release rules

- Sparkle stays disabled until a real public key and reachable signed appcast
  are configured.
- Never use a placeholder key, unsigned enclosure or HTTP feed.
- The update channel does not alter licence policy. Free remains Free after an
  update, Monthly requires an active paid period, and Lifetime keeps the
  included Pro features on up to two activated devices.
- Lifetime includes future Quickque updates when released, but updates are not
  guaranteed. New paid features may require another licence or paid upgrade.