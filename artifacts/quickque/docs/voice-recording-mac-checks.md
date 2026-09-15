# Voice recording checks on a physical Mac

These checks require the packaged Quickque Mac app and cannot be proven by browser mocks or a Linux build.

1. In System Settings, reset Quickque microphone permission. Open **Your Voices**, choose **New voice**, and confirm permission is explained before the system prompt.
2. Approve permission. Confirm no audio is captured and the microphone is released until **Record with 3-2-1 countdown** is pressed.
3. Confirm the visible and VoiceOver-announced 3, 2, 1 sequence completes before the microphone indicator appears.
4. Cancel during the countdown, during capture, and after review. Confirm the macOS microphone indicator turns off and no recording starts later.
5. Record samples ending at approximately 11.9, 12, 15, 20, and over 20 seconds. Confirm 11.9 is rejected, 12/15/20 are accepted, and capture stops at 20 without clipping a longer file into an apparently valid save.
6. Deny permission, revoke it during the journey, and disconnect or disable the selected input device. Confirm each failure releases the microphone and presents an actionable retry.
7. Listen to the captured sample, stop playback, re-record, then save with a required name. Simulate an unwritable app-data folder and confirm the reviewed sample remains recoverable and the UI does not claim it was saved.
8. Open and preview pre-existing 5–10 second voices. Assign one to a character and generate a short Chatterbox passage. Confirm legacy playback and generation remain available.
9. Create 12, 15, and 20 second voices and generate the same short passage with each. Confirm Chatterbox accepts the full reference or reports an explicit engine compatibility error; it must not silently trim to 10 seconds.
10. Edit only profile notes. Confirm the local voice ID, reference ID, recording checksum, and audio revision do not change.