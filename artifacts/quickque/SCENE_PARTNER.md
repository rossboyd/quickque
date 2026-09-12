# Scene partner

Quickque can read the other characters while you perform one or several roles.
Use a phone or separate camera to make your self-tape. **Quickque does not
record video or audio, save takes or export generated speech.**

## Set up a scene

1. Choose **New script** → **Performance / Self-tape**, then open **Scene Partner**.
   For an existing script, change **Script type** to **Performance** first.
   Switching **Partner audio** off keeps the performance type, cast and
   assignments for later. You can change the script type back to Presentation.
2. Add characters, using the names and optional age/age-range, gender and
   performance descriptions you choose. These free-text descriptions are
   visual reminders, not automatic voice-generation instructions or promises
   of an exact age or acting performance.
3. Choose **In Person** for each character you or another person will perform,
   and **AI Partner** for characters Quickque will read with a local system voice.
   All AI Partner means a full read-through; all In Person means silent turn cues.
   Choose a **Character colour** preset or custom accent for each character.
   Colours follow the cast through turns, the editor and rehearsal; dialogue
   stays neutral and readable. Existing My role assignments become In Person.
4. Assign one character to each section. Each section is one dialogue turn.
   Split at the text cursor, move turns up/down, or reassign them. Splitting
   preserves the dialogue verbatim and keeps notes on the first part.
   Unassigned turns are flagged and are never spoken.
5. Put only spoken dialogue in the main text. Use the separate **Notes** field
   for director instructions and cues. Notes also work in ordinary scripts.
   Neither notes nor character descriptions are automatically read aloud.
6. Choose an installed local system voice and its relative speaking rate for
   each partner, then use **Preview voice** explicitly. A missing saved voice
   requires a new selection; Quickque never silently substitutes another
   voice. Voice identifiers can differ between browsers and Macs.

Deleting a cast member asks whether to reassign their turns or leave them
unassigned. It also removes that character from the In Person assignments. Cast, notes,
assignments and voice metadata travel with duplication, JSON exports, full
backups, Trash/restore and native library files. Ordinary text/document imports
are not automatically parsed or guessed into a cast.

## Write the whole script in Markdown

Choose **Markdown** in the editor to write in a single pane. Use `#` for the
script title, `##` for a section or turn, `**Alex:**` to begin Alex’s dialogue,
and `>` for notes. For example:

```markdown
# The return
## Opening
**Alex:** Welcome home.
> Take a breath before speaking.
**Jamie:** I had to come back.
```

Existing names reuse their cast settings, assignments, colours and voices.
New names create AI Partners; finish assigning roles and voices in Scene
Partner. Adding characters to a plain presentation opens performance setup.
Every character name must be unique to use name-based Markdown cues.
Prefix a markup line with a backslash to keep it as spoken text. Other text
stays as dialogue; this editor does not render HTML or fetch embedded media.
**Save script** updates the visual editor. Errors keep the draft open; closing
with unsaved edits offers **Keep editing** or **Discard edits**.

## Rehearse

Choose **Rehearse** in the editor. With Partner audio enabled, setup checks
flag empty dialogue, unassigned turns and missing partner voices. Select an
issue to return to the relevant dialogue, character assignment or cast setup.
Local voices are checked before opening a rehearsal with partner lines.

Opening the reader does not start speech or microphone capture. Use **Start**.
Quickque plays assigned partner turns in order and waits on your roles.
Use the visible next-turn control, right-arrow key or existing phone Next
control when you have finished. Left-arrow/Previous revisits an earlier turn;
Replay repeats the current partner line. Pause cancels an interrupted partner
line; resuming replays that line from its beginning rather than guessing a
word-level audio position. Start over uses the normal presentation countdown.

An always-visible **Now / Up next** panel shows character names, In Person or
AI Partner assignments, colour accents and the next line. It stays visible
when dialogue scrolls or controls fade, and follows the chosen mirror layout.
The In Person cast is listed above it.

Current-turn ownership, character context and optional notes appear beside the
dialogue in full/compact and mirrored presentation. Hide notes when you do not
need them. Scene mode does not use timed auto-scroll. Its elapsed clock is
active-session time (including time spent performing your role), not the length
of a recording or a promise of an exact spoken duration.

In a browser, only voices reported by the browser as local are offered. If none
are available, assign every character as **In Person** for silent turn cues, or
switch **Partner audio** off to read at your own pace. That preview does not
contact a cloud voice service. Native macOS speech uses a separate system-voice
helper; manual turn-taking needs no recognition model or Flow microphone access.

## Optional Flow following

Flow is opt-in for the scene and follows only your current actor turn. It
requires the Mac app, the existing on-device Flow setup and microphone
permission. Use the manual Next control for uncertain matches. Silence never
finishes a turn. The native inactivity stop remains active; use explicit Resume
Flow after it stops rather than waiting for an automatic restart.

Scene completion deliberately requires contiguous, exact normalized **final**
recognition from the beginning of the current turn. A trailing phrase, fuzzy
match or uncertain recognition does not complete it. Short turns (fewer than
four normalized tokens) and single-word repetitions require manual Next.
After an uncertain match, use Next or explicitly restart following rather than
expecting Quickque to guess.

Partner playback waits for the Flow helper's shutdown acknowledgement.
Actor capture waits for speech teardown. Cancellation and turn generations
discard stale playback/recognition results. This is implemented protection;
actual microphone/speaker handoff on Apple Silicon still needs the hardware
checks in `DESKTOP.md`.

## Privacy and optional expressive voices

There is no cloud inference, account, API billing, user voice-cloning upload or
media export. Generated speech and recognized speech stay transient; they are
not included in backups or phone-remote messages. The remote continues to
receive only existing transport/presentation state, not cast, dialogue or notes.

**Chatterbox-Turbo is unavailable.** See `TURBO_EVALUATION.md` for immutable
source/model evaluation pins, approximate weight size, unsupported controls,
watermarking, rights and packaging blockers, and the predeclared Mac benchmark
thresholds. No Turbo installer, runtime, model or reference voices are shipped.
Do not interpret its MPS code path as verified Mac performance.

## Verification boundary

Browser/unit checks establish data handling and control logic, not audible
quality, successful native installation or hardware audio isolation. Native
Swift/Tauri compilation and Apple Silicon audio/compact-window smoke testing
are unverified in this Linux workspace. Do not distribute this feature as a
Mac-validated release until those checks have been completed.