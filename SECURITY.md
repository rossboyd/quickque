# Security

Quickque is a source-only, local-first project. This file describes how to
report a concern without making a promise about a private reporting channel
that may not be enabled for this repository.

## Scope and useful context

* Browser and desktop storage are separate local stores; there is no Quickque
  account or server-side script store.
* Local Flow processes microphone input in memory. Audio and recognition text
  are not intended to be saved as recordings or transcripts.
* The optional phone remote is reachable on a private LAN and uses local HTTP.
  It is approval-gated, but local HTTP is not encrypted; do not expose it to an
  untrusted network.
* Source builds are the supported form at present. No release installer,
  production service, or support response time is promised.

## Reporting

Please do **not** put credentials, tokens, private scripts, meeting material,
audio, transcripts, personal data, or complete exploit details in a public
issue, pull request, or commit.

Check the repository's GitHub **Security** tab for a private vulnerability
reporting option. Use it only if GitHub actually presents that option for this
repository; this document does not promise that private reporting is enabled.
No security email address is published here.

If no private GitHub option is available, do not disclose sensitive exploit
details publicly. You can open a minimal public issue containing only a
non-sensitive description and the affected source area, without attaching
secrets or proof-of-concept material. Wait for a maintainer to provide a safe
follow-up path before sharing details. If the issue itself would reveal
meaningful exploit information, do not open it.

Include, when safe:

* the affected revision or package;
* the platform and version;
* a concise impact description;
* safe reproduction steps using synthetic data; and
* any mitigation you have already applied.

Please allow time for triage. There is currently no published severity
classification, response deadline, or supported-version policy.

## Dependency and model notices

Before reporting a suspected issue in a dependency or model, check
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the notices next to the
relevant source. Keep upstream reports separate from Quickque-specific
behavior, and do not upload private meeting data to reproduce a problem.