# Physical offline phone-remote verification

Status: **NOT RUN — requires a Mac and physical phone.**

The Linux protocol and browser-script checks do not establish physical LAN,
macOS permissions/firewall, camera QR handoff, or mobile browser behavior.
Use a supported Mac build; producing/signing an installer is separate work.

## Setup and record

- Record test date, Mac model, macOS version, Quickque build, phone model, OS,
  browser/version, LAN topology, and observed results without recording pairing
  links, controller tokens, or private script content.
- Keep the LAN router/access point and local DHCP functioning, but disconnect
  its internet/WAN uplink **before scanning or loading any remote page**.
- Disable cellular data on the phone. Do not use a previously loaded remote
  page as the first-load test. Clear the remote site's browser storage/cache
  or use a fresh browser profile. Allow ordinary local browser storage.
- Test Mac Wi-Fi + phone Wi-Fi, then Mac Ethernet + phone Wi-Fi on the same
  reachable LAN. Avoid guest/client-isolated Wi-Fi for the success case.

## Required flow

- [ ] Open a script in the Mac reader. Click its small Phone Remote icon once.
      Observe “starting” briefly followed by the QR; no Start Server action.
- [ ] Close/reopen the dialog and click repeatedly. The active QR session is
      preserved and no competing sessions or servers appear.
- [ ] Scan with the phone's ordinary camera and open in its browser. Confirm
      the address is the Mac's private LAN IP and local port, not localhost
      or any public site.
- [ ] On this fresh offline visit, the complete page loads and automatically
      requests approval without code entry or a Pair tap.
- [ ] Before approval, phone commands are unavailable; the Mac shows the
      pending request even if its dialog had been closed.
- [ ] Approve on the Mac. Confirm “connected” on both, and exercise play/pause,
      previous/next section, manual speed, font size, and position. Verify
      section, elapsed time, Manual/Voice Follow, speed, font, and position.
- [ ] If Flow models are already installed, switch to Voice Follow on the
      Mac. Confirm phone speed/position controls are disabled and the other
      controls keep the existing shared semantics. No model download is
      required or attempted by pairing.
- [ ] Reload and rescan on the same phone/browser while pending, then after
      approval. Confirm no new approval request or competing controller.
- [ ] Try a second browser/device. It must not gain control of the session.
- [ ] Briefly disconnect/reconnect the phone's Wi-Fi on the same LAN/address.
      Controls become unavailable, then resume with the current reader state
      without a new approval. The Mac reports disconnection after heartbeat
      timeout rather than claiming the phone is still reachable.

## Rejection, expiration, teardown, and help

- [ ] Start a new session, scan, and reject on the Mac. The phone clearly says
      rejected and asks for a new QR, not “waiting for approval” indefinitely.
- [ ] Create a new QR, wait more than five minutes without approval, then
      scan. The link expires and does not pair silently with another session.
- [ ] Scan before expiration but approve only after five minutes. Approval is
      refused; create and scan a fresh QR.
- [ ] Stop, replace, leave the reader, and quit Quickque in separate runs.
      Confirm the old controller cannot issue commands. Old links either
      cannot reach the stopped listener or clearly expire if its port is reused.
- [ ] Disconnect all usable Mac LAN interfaces. Clicking Phone Remote gives
      actionable guidance and no localhost QR.
- [ ] Check the optional bare local URL + code fallback.
- [ ] Check blocked firewall/local-network permission, guest-network isolation,
      and Mac sleep. Help should explain local connectivity, not suggest a
      cloud or internet fallback.
- [ ] Inspect the built `.app/Contents/Info.plist` and confirm it contains
      `NSLocalNetworkUsageDescription`. On macOS 15 or later, exercise the
      local-network permission prompt: allow, deny, then re-enable Quickque
      in System Settings → Privacy & Security → Local Network. Retry pairing
      after re-enabling and verify the phone can reach the Mac.
- [ ] Confirm the UI describes local HTTP as **unencrypted**, never as secure
      on untrusted/shared Wi-Fi.
- [ ] Confirm ordinary browser preview still provides manual reading and
      identifies hosting the remote as a desktop capability.

## Results

Record pass/fail for each item, browser/network variations, and any limitations.
Do not claim a successful physical offline test until this section contains
actual observations.