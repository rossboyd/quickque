# Icon and script appearance checks

## Reproducible icon assets

The original is `../../attached_assets/0_quickque_1789167367786.png`.
It is not redrawn. `scripts/prepare-icons.py` removes the connected exterior
white margin and photographic shadow, removes the white matte from boundary
pixels, and centres the complete dark silhouette on a square transparent
canvas without changing its aspect ratio. It leaves the enclosed artwork alone.
The measured source bounds are `(93, 90)` to `(1162, 1148)` (exclusive).

To regenerate with Python 3 and ImageMagick 7 available:

```sh
pnpm --filter @workspace/quickque icons:prepare
pnpm --filter @workspace/quickque icons:check
```

Neither tool is needed for ordinary app builds: generated assets and the source
are committed release inputs. The manifest records their hashes. ICNS contains
16, 32, 64, 128, 256, 512 and 1024 pixel PNG representations with alpha.
The configured Tauri bundle icons and local browser icons use these assets.
Unused platform icons left by the earlier Tauri setup are not bundle inputs;
this change does not add another platform installer.

## Build and inspect on a supported Mac

Use the existing Apple Silicon macOS 26 / Xcode 26 packaging process in
`DESKTOP.md`. `desktop:build` now checks the icon inputs before that process,
then checks the generated app's `CFBundleIconFile` and compares the resource
byte-for-byte with the supplied ICNS after Tauri finishes. It still runs the
existing Swift debug/release and Rust tests and builds the same helper.

```sh
pnpm --filter @workspace/quickque desktop:build
pnpm --filter @workspace/quickque desktop:check-icon
```

After installing from the new DMG:

```sh
sh artifacts/quickque/scripts/check-mac-icon.sh /Applications/Quickque.app
```

Record actual results rather than treating a successful frontend build as a
Mac installation check:

| Check | Result in this Linux environment |
| --- | --- |
| Source crop, transparent corners and small-size artwork inspection | Checked |
| Asset hashes, ICNS size records, explicit bundle icon configuration | Checked |
| Fresh native `.app` / DMG build and bundle resource inspection | **Unverified — requires supported Mac** |
| App icon in mounted DMG, Applications/Finder, Get Info and running Dock | **Unverified — requires supported Mac** |
| Offline native font rendering and native restart persistence | **Unverified — requires supported Mac** |

## Development verification (2026-09-12)

- `icons:prepare` reproduced identical outputs on repeated generation before the
  explicit Retina representations were added; `icons:check` passes on the final
  assets, including all standard/Retina ICNS records. The 1024px master's four
  corners have alpha 0 and its centre alpha 1. Artwork was inspected on grey and
  at 16/32px sizes.
- `typecheck`, the web Vite build, and the desktop Vite frontend build pass.
  Vite reports existing startup-script, dependency sourcemap and large-chunk
  warnings; these do not fail either build.
- Appearance/persistence/anchor/contrast tests pass. The Flow (31), remote (28),
  reader-surface (3), presentation (20), and library (29) tests pass.
- Browser journey: Georgia and a custom hex colour applied to the editor and
  reader without recolouring controls; the native picker and hex entry stayed
  synchronized. Invalid hex showed an error after blur. Choices survived a
  reload; individual reset buttons restored System sans/theme-default colour.
  Light and dark screens, manual pause/resume and section navigation were checked.
- Browser compact appearance controls were reachable at 620×380 and 360×260.
  At the minimum size the dialog had vertical-only overflow (321px content and
  scroll width). Existing reader HUD/content is crowded at this size; this task
  does not redesign the reader. Text-size controls are also available in the
  scrollable appearance dialog through the existing reader command handler.
- The focused browser font-change check kept the measured word at the same
  viewport top (264px) while its glyph width changed. A reusable, stricter
  mid-script DOM assertion is in `tests/reader-appearance.browser.mjs`; it is a
  Playwright helper, not part of the Node arithmetic unit suite. That stricter
  helper was added after the interactive check and was not separately run.
- `desktop:build` passed the icon-input check and stopped at the existing native
  guard: “Quickque Apple Speech builds only on Apple Silicon macOS Tahoe 26 or
  newer.” No new `.app` or DMG was produced here. Native Flow reflow, installed
  icon display, Mac WebView rendering and physical phone operation remain
  **unverified**, regardless of browser and protocol-test results.

### Installed-app visual checklist

1. Open the newly built DMG. Check the Quickque application icon, not a stale
   DMG file icon or a shortcut to a previous build. Drag it into Applications.
2. Run the installed-app resource check above. In Finder and Get Info, confirm
   the supplied rounded-square artwork has no white exterior margin or halo.
3. Quit any older Quickque instance, then launch the copy in Applications and
   check the Dock icon. Check it at both small and large Dock sizes.
4. If the resource is missing or the comparison fails, this is a packaging or
   stale-install problem. Do not call it caching. Rebuild/reinstall the candidate.
5. If the installed resource/reference is correct but Finder or the Dock still
   shows the old icon, quit the app, remove the old Dock shortcut, reopen the
   installed copy, and restart Finder/Dock or log out and back in. Recheck before
   recording a pass. Do not change the bundle identifier to bypass icon caching.
6. Disconnect internet access before launching. In Settings, try System sans,
   Arial / Helvetica, Georgia and Monospace. Check the preview, editor, full
   reader and compact reader. The stacks use local fonts and generic fallbacks,
   not remote services; exact metrics can differ between operating systems.
7. Change the font after scrolling partway through a long section. Confirm the
   same words remain at the reading guide. Repeat in Manual and Voice Follow.
   Check previous/next sections, play/pause, manual scrolling and phone controls.
8. Choose a custom colour, restart the app, and confirm it and the chosen font
   persist without changing navigation or button colours. Confirm Flow's active
   word and read/unread differences remain clear.
9. Restore theme-default colour and default font. Switch light/dark themes and
   confirm default copy adapts. Check custom low-contrast colour warnings and
   readable labels. In a transparent overlay, confirm contrast against the real
   window underneath; a colour can be readable in the preview but not on video.
10. Test opacity 0%, 40% and 100%, then leave compact mode and return to the
    library. Follow the existing transparent-overlay and phone-remote checklists.