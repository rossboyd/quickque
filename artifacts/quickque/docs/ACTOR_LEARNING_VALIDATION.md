# Actor learning validation pack

Status: research preparation only  
Recommended first study: five adult beginners  
Last updated: 15 September 2026

## 1. Purpose and limits

This pack tests whether Quickque can help an actor move from an unfamiliar,
rights-cleared scene to a useful first rehearsal, and whether guided prompting
or off-book practice deserves further product investment.

It is not evidence that actors want a teaching platform. No participant has
been recruited or observed through this pack, and no quote, count, duration or
success rate below is an existing research result. The targets are provisional
decision rules for a future pilot, not statistically representative proof.

This work does not:

- perform outreach, schedule sessions or collect participant data;
- record a participant or enable new product telemetry;
- provide legal, safeguarding or consent-policy assurance;
- redistribute commercial play text;
- assume that younger actors form one age group or need one kind of guidance;
- commit Quickque to classroom, educator or learning-management features.

## 2. Concise product brief

### Problem to validate

An actor beginning an unfamiliar scene must understand the cast, choose their
role, arrange the other voices, wait for any local audio preparation, and start
rehearsing without damaging the source text or mistaking an incomplete setup
for a ready scene. After rehearsal they may want structured help learning the
scene, but it is unknown whether Quickque adds learning value beyond their
current method.

### Intended outcome

A first-time adult beginner can independently:

1. import an unfamiliar scene;
2. recognise that a `CONTINUED` cue belongs to the existing character;
3. choose the role they will perform;
4. configure the other roles, including recording or assigning a permitted
   local voice where the study build supports it;
5. distinguish active setup time from model download or audio generation;
6. begin a rehearsal only when the scene is genuinely ready;
7. recover from an interrupted or incomplete setup;
8. add a personal note without altering imported dialogue or writer notes; and
9. compare guided or off-book practice with their current learning method.

### Primary research questions

- Can a first-time actor reach the first useful rehearsal without facilitator
  intervention?
- Do they understand who is In Person, who is an AI Partner, and which voice
  will speak each partner role?
- Does the interface prevent false-ready starts and accidental source edits?
- Does cold-start preparation feel trustworthy when waiting time is excluded
  from active setup time?
- Can an actor resume after interruption and recover from a setup mistake?
- Does guided prompting or off-book practice improve the actor's learning
  process compared with what they already do?
- What accessibility needs affect setup, waiting, reading and rehearsal?
- Would a younger actor need different language, pacing, controls or adult
  support? What age ranges and educator roles should be studied separately?

### Recommended sequence

Run one formative pilot with five adult beginners first. Fix safety-critical
and journey-blocking problems before considering research with under-18s.
Only then design a separate minor study with an appropriate educator or
safeguarding lead, guardian consent, young-person assent and arrangements
suited to the setting and age range.

## 3. Evidence-to-hypothesis register

Evidence labels:

- **Observed note**: a statement in the attached user-test notes. It reports one
  observed test and is not a prevalence estimate.
- **Current-code corroboration**: behaviour asserted by current automated tests
  or project documentation. It is not participant evidence.
- **Hypothesis**: a claim the pilot must test.
- **Open question**: intentionally unresolved.

| ID | Type | Traceable source | Finding or claim | Research implication |
| --- | --- | --- | --- | --- |
| E01 | Observed note | Attached notes, lines 3-10 | Setup issues were easy to miss; Rehearse and Start Rehearsal appeared before voice setup was complete. | Observe whether the current journey communicates readiness before action. |
| E02 | Current-code corroboration | `tests/performance-setup.spec.ts`, lines 58-66; `tests/workspace-home.spec.ts`, lines 49-60 | An incomplete performance now opens an actionable “Finish setting up your performance” view and does not enter rehearsal. | Treat blocking as implemented behaviour to validate with people, not an unresolved code assumption. |
| E03 | Observed note | Attached notes, lines 43-44 | `Continued` was parsed as a separate character. | Include a continued-character cue and record whether the participant notices, resolves or is protected from duplication. |
| E04 | Observed note | Attached notes, lines 26-27 | Voice choice and a preselected voice were not sufficiently obvious. | Ask the participant to explain assignments before rehearsal; do not infer comprehension from task completion. |
| E05 | Current-code corroboration | `SCENE_PARTNER.md`, lines 27-47 | Cast members can be In Person or AI Partner; AI Partners require explicit local voice selection and preview, with no silent substitution. | Test mental models for performer ownership, voice assignment and preview. |
| E06 | Current-code corroboration | `SCENE_PARTNER.md`, lines 31-34 and 104-108 | All-AI supports a full read-through; all-In-Person supports silent manual cues; manual turn-taking needs no microphone model. | Represent dialogue, monologue and all-human/manual alternatives rather than assuming AI audio is always desirable. |
| E07 | Observed note | Attached notes, lines 31-35 | A ten-second recording, absent countdown and unclear naming caused voice-creation friction. | Include one recording task, while separately observing readiness, startle, naming and consent to record. |
| E08 | Observed note | Attached notes, lines 39-42 | Audio generation appeared static for about 30 seconds and looked crashed. | Separate active setup from passive preparation and ask what the participant believes is happening. |
| E09 | Current-code corroboration | `docs/SCRIPT_AUDIO.md`, lines 3-32 | Saved Chatterbox audio prepares after committed edits, can reuse unchanged passages, preloads before Start, and has no live fallback for stale or missing audio. | Include cold-start waiting, edit/regeneration and a false-ready check. Do not promise zero-latency playback. |
| E10 | Current-code corroboration | `SCENE_PARTNER.md`, lines 85-91 | Entering rehearsal does not start speech or microphone capture; Start begins playback, and pause/resume has defined behaviour. | Check whether the two-stage start is understood and whether resuming feels predictable. |
| E11 | Observed note | Attached notes, lines 13-18 | Accidental edits to imported text were considered serious; personal notes should remain separate. | Include a personal-note task and verify dialogue and supplied notes remain byte-for-byte unchanged. |
| E12 | Current-code corroboration | `tests/performance-setup.spec.ts`, lines 69-110 and 113-128 | Markdown save, cast persistence, rehearsal navigation, error retention and discard behaviour have automated coverage. | Use these as recovery probes, but do not treat test coverage as proof of human comprehension. |
| E13 | Current-code corroboration | `docs/SCRIPT_AUDIO.md`, lines 54-67; `SCENE_PARTNER.md`, lines 146-152 | Browser and Linux checks do not prove Mac audio quality, native installation or hardware handoff; Mac checks remain outstanding. | Record test device/build and avoid attributing native reliability from browser results. |
| H01 | Hypothesis | Derived from E01-E05 | A guided readiness sequence will allow at least four of five adult beginners to reach first rehearsal without intervention. | Apply the provisional completion target after five sessions; inspect failures qualitatively. |
| H02 | Hypothesis | Derived from E07-E10 | Immediate, truthful preparation feedback lets participants distinguish waiting from failure and resume without restarting unnecessarily. | Capture belief during cold start, passive wait duration and recovery action. |
| H03 | Hypothesis | Derived from E11-E12 | Source locking plus a separate personal-note action prevents accidental dialogue or writer-note changes. | Compare source before and after; target zero accidental changes. |
| H04 | Hypothesis | New learning direction | Guided prompts or off-book practice provides learning value beyond the participant's current method. | Compare methods using recall confidence, cue dependence, perceived usefulness and educator judgement; avoid claims about learning efficacy from preference alone. |
| Q01 | Open question | Not established | Which beginner experience range is most useful: first acting experience, occasional amateur, student, or returning actor? | Record experience bands without collecting unnecessary biography. |
| Q02 | Open question | Not established | Which under-18 age ranges, if any, can use the journey independently? | Do not recruit minors until age bands, adult presence and safeguarding arrangements are agreed. |
| Q03 | Open question | Not established | Should an acting educator facilitate, observe, or only review the concept in a minor study? | Ask educators and the safeguarding lead before defining the study. |
| Q04 | Open question | Not established | Is recording a local voice useful enough to justify its setup burden for first rehearsal? | Compare recorded/local voice, installed system voice and all-human/manual paths. |
| Q05 | Open question | Not established | Does guided prompting transfer to improved off-book performance, or merely make the interface feel supportive? | Use educator judgement and observable cue dependence; a larger efficacy study would be separate. |

### Interpretation rule

Keep evidence, interpretation and recommendation in separate fields during
synthesis. “The participant selected AI Partner” is evidence. “They understood
the assignment” is an interpretation only if their explanation or later action
supports it. “Make the label larger” is a recommendation, not a finding.

## 4. Rights-cleared study material

The following text was written for this research pack and may be used in
Quickque validation sessions. Keep this notice with copied study materials.
Do not replace it with a commercial audition side unless the researcher has
explicit written permission to use and reproduce that text for the study.

### Sample A: dialogue with a continued cue

**Title: The Spare Key**

**Characters**

- **Rae** — the participant's suggested role
- **Dev** — scene partner

**Writer note:** Evening. A hallway light keeps switching off.

**RAE:** You said the key would be under the blue pot.

**DEV:** It was, yesterday.

**RAE:** Yesterday is not much help when the door is locked now.

**DEV:** Wait. Do not pull the handle.

**RAE:** Why?

**DEV:** Because I may have left the other key on the inside.

**RAE:** That is not how spare keys work.

**DEV:** I know.

**RAE:** Then why are you smiling?

**DEV (CONTINUED):** Because the kitchen window is open.

**Writer note:** Rae looks toward the dark side path.

**RAE:** You are going first.

Expected import model: two characters, Rae and Dev. `DEV (CONTINUED)` is Dev,
not a third character. Writer notes remain source material.

### Sample B: short monologue

**Title: Before the Bell**

**Writer note:** The speaker is alone beside a closed classroom door.

**SAM:** I practised the first sentence all morning. It sounded certain in the
kitchen, and brave on the bus, and almost funny by the gate. Now the corridor
is quiet and the sentence has gone somewhere else. So I will not begin with the
sentence. I will begin with the door. I will open it, take one breath, and let
the next true thing be enough.

Expected import model: one In Person character and no AI Partner requirement.
Use manual controls or silent cues.

## 5. Adult beginner pilot

### Suggested sample

Five adults who describe themselves as new or relatively new to learning
scripted scenes. This is a small formative sample chosen to reveal journey
friction. It cannot establish market size, prevalence, teaching effectiveness
or statistically representative demand.

Avoid collecting names, exact ages, employers, schools or copies of their own
scripts. A session code such as `A01` is enough. Record only a broad,
self-described experience band when it is needed for interpretation:

- no previous scripted acting;
- some informal or beginner experience;
- regular acting experience, included only as a comparison.

### Recruitment screener template — adults

Use this manually only after recruitment is approved.

1. Are you 18 or older? `Yes / No`  
   Stop if no; the minor pathway is separate.
2. Which broad description fits your experience with scripted acting?
3. Do you use any assistive technology or need an adjustment to read, hear,
   speak, operate the device or take part comfortably?  
   Ask for the adjustment, not a diagnosis.
4. Are you comfortable testing with original sample text supplied for the
   session rather than uploading your own script?
5. The session can run without storing audio or video. Are you comfortable
   trying a local voice-recording step if you can stop or skip it at any time?
6. Do you have any conflict that would make feedback feel compulsory, such as
   direct supervision by the product team? If yes, review recruitment.

Do not collect responses through the product or contact anyone automatically.

### Adult consent information template

> You are invited to help evaluate an early rehearsal setup and learning
> concept. Participation is voluntary. You may pause, skip the voice-recording
> task, withdraw or ask for your session notes to be deleted without giving a
> reason. We are testing the product, not your acting ability.
>
> We plan to take structured written notes using a study code. We will not
> collect your name, exact age, personal script, account data, audio, video or
> transcript unless a separate, explicit permission has been agreed before the
> session. The supplied scenes are original study text. A local voice sample,
> if used, must be deleted or confirmed absent at the end of the session.
>
> The researcher will explain who can access the notes, where they are kept,
> how long they are retained and how deletion can be requested before asking
> for consent. This template is not legal advice; the study owner must review
> the final process for the place and organisation running the research.

Consent record: `Agreed / Declined`, date, study code, facilitator initials.
Do not add a participant name or signature unless the reviewed process requires
it.

## 6. Facilitator script: first rehearsal journey

### Preparation

- Use a study device and an approved build; record build and platform.
- Reset the study library without affecting a participant's device or files.
- Keep Sample A available as a permitted import file.
- If testing a true Chatterbox cold start, arrange enough time and storage.
- Prepare an all-human/manual fallback so the session is still useful if local
  audio cannot run.
- Verify that screen zoom, keyboard access and any agreed adjustment are ready.
- Start two timers only when relevant:
  - **active setup**: participant is reading, deciding, typing or operating;
  - **passive preparation**: download, generation, preload or device startup.
- Do not silently fix the setup. Record an intervention before helping.

### Opening

Read:

> We are testing Quickque, not you. Please work as you normally would and say
> what you expect when that feels natural. I may stay quiet for a while. You can
> pause or stop, and the acting itself is not being judged.

Ask:

1. How do you currently learn an unfamiliar scene?
2. What tells you that you are ready for a first read-through?
3. What, if anything, do you use for someone else's lines?

### Scenario and tasks

Give one instruction at a time. Do not mention control labels unless providing
a recorded intervention.

#### Task 1 — import

> Import “The Spare Key” and prepare it as a performance you can rehearse.

Observe:

- where the participant starts;
- whether they understand the imported title, dialogue and writer notes;
- setup notices they see, miss or misinterpret;
- whether they try to edit source text.

#### Task 2 — continued character

> Check that the cast matches the scene.

Observe:

- whether Rae and Dev are the only characters;
- whether `DEV (CONTINUED)` appears or is treated as a third character;
- whether the participant can resolve a duplicate without losing or changing
  dialogue;
- confidence after resolution.

If the build already resolves it automatically, ask:

> How many characters do you expect, and what happened to “continued”?

Do not create artificial failure merely to force a repair.

#### Task 3 — choose a role

> Set yourself to perform Rae. Arrange Dev as the partner who will read with
> you.

Ask before moving on:

> In your own words, who speaks Rae, who speaks Dev, and what will happen when
> each turn is reached?

Score comprehension from the explanation, not from the saved setting alone.

#### Task 4 — record or assign a voice

> Give Dev a voice you can recognise. Please try the recording route if you are
> comfortable; you can stop or use an installed local voice instead.

Observe:

- whether recording start, countdown, expected length and stop are understood;
- whether the participant is rushed or startled;
- whether naming and saving are clear;
- whether preview confirms the chosen assignment;
- whether skipping recording remains a complete route;
- any mismatch between expected and actual privacy or storage.

Never pressure a participant to record. Do not retain the sample as research
data. If the tested build does not support the intended recording route, mark
the task **not testable in this build**, not participant failure.

#### Task 5 — cold-start preparation

> Make the scene ready for rehearsal.

Run a real cold start only when technically and operationally appropriate.
During the wait, do not reassure unless the participant asks or safety demands
it. At natural pauses ask:

- What do you think is happening now?
- Is there anything you think you need to do?
- What would you expect if you left this screen and came back?

Record active setup and passive download/generation/preload separately. Note
whether the participant:

- believes the app has crashed;
- starts duplicate work;
- changes a finished setup unnecessarily;
- believes the scene is ready before current audio is ready;
- can cancel or leave without losing comprehensible state.

#### Task 6 — first rehearsal

> Start the scene and complete one read-through.

Observe:

- whether Rehearse is unavailable or clearly redirects while incomplete;
- whether entering the reader is mistaken for starting audio;
- whether Start is discovered;
- whether the participant knows when it is their turn;
- whether Dev's voice matches their explanation;
- use of Next, Previous, Replay or Pause;
- false-ready entry, stale audio or unexpected fallback;
- readability, sound, motion, focus and motor-control barriers.

#### Task 7 — interrupt and resume setup

After the first read-through, provide this neutral situation:

> Imagine you had to stop during setup and return later. Leave this scene,
> return to it, and check whether anything still needs attention before another
> rehearsal.

If there was a real earlier interruption, use it instead. Observe whether
assignments and preparation state are understood, and whether the participant
can find the next required action without repeating completed work.

#### Task 8 — personal note without source change

> Add a private reminder for yourself: “Wait for Dev to finish before turning.”
> Keep the imported dialogue and writer notes exactly as supplied.

After the task, compare the stored/imported source with Sample A. Record:

- whether a separate personal-note route is found;
- any attempted or completed dialogue change;
- any attempted or completed writer-note change;
- whether undo, cancel or discard restores the source;
- whether the personal note remains visually distinguishable.

If the build has no separate personal-note capability, record a **product
blocker**. Do not invite the participant to put the note into source text.

### Close

Ask:

1. What, if anything, made the scene feel ready?
2. Which assignment or preparation state was least clear?
3. What would you worry about losing or changing?
4. How did this compare with your current rehearsal method?
5. What adjustment would make reading, hearing or operating it easier?
6. Would you use this for a monologue, a dialogue, both or neither? Why?

Confirm deletion or absence of any local test recording according to the
approved session process.

## 7. Training concept study

Run this only after the core setup tasks, so setup friction does not masquerade
as a judgement about learning value. Use original Sample B for monologue and
Sample A for dialogue. Counterbalance concept order across participants where
practical.

### Conditions

1. **Current method baseline**
   - Give the participant a short extract.
   - Ask them to practise as they normally would for a fixed, disclosed period.
   - Record their method in their own words.
2. **Guided prompting**
   - Reveal or speak a cue, allow the participant to attempt the next line, then
     offer a graduated prompt: first word, short phrase, then full line.
   - Let the participant control when help appears.
3. **Off-book practice**
   - Hide the target line after an initial read.
   - Present the cue and let the participant attempt it.
   - Allow immediate reveal, repeat and return to the previous cue.

Do not claim that either concept teaches acting. The study asks whether it helps
line learning, rehearsal confidence or independent practice.

### Coverage matrix

| Material | Partner path | Concepts to compare | Key question |
| --- | --- | --- | --- |
| Sample B monologue | In Person; manual controls | Current method, guided prompt, off-book | Does help support recall without an artificial partner? |
| Sample A dialogue | Rae In Person; Dev local/system partner | Current method, guided prompt, off-book | Does hearing a cue reduce dependence on reading ahead? |
| Sample A dialogue | Rae and Dev both In Person | Current method, manual cues, off-book | Is the product still useful with another human and no generated voice? |

The all-human condition is not a degraded fallback. It tests rehearsal with a
real scene partner, accessibility preferences, unavailable audio and a user's
choice not to generate or record voices.

### Participant discussion guide

- What did you do in each method when you could not remember the next line?
- Which method helped you notice the cue rather than merely read the answer?
- Did prompts arrive too early, too late or at the right level?
- Could you choose how much help to receive?
- Which method would you use alone? With another actor?
- Did any method change confidence without changing recall?
- What would become frustrating over a longer scene?
- Would you want progress or scores? Why or why not?
- What information should never be shown to a teacher, parent or director
  without the actor choosing to share it?

### Acting educator discussion guide

Show the three conditions and anonymised observation summaries, not participant
audio.

1. What learning behaviour does each condition encourage?
2. Does graduated prompting support retrieval, or make dependence on prompts
   more likely?
3. What would count as improved learning value beyond interface preference?
4. When should a learner return to the full text?
5. How should cue pickup, intention, listening and line accuracy be balanced?
6. How might needs differ across broad developmental stages or experience
   levels? Do not ask for one universal “young actor” design.
7. Which activities require educator presence, and which can be independent?
8. What risks arise from scoring, correction, generated voices or imitation?
9. What accessibility adjustments should be designed into the practice method?
10. What evidence would make you recommend, limit or reject a larger study?

### Learning-value indicators

Use as formative indicators, not validated educational outcomes:

- number and level of prompts requested;
- ability to resume after an error without restarting the whole passage;
- cue dependence: whether the actor waits for and responds to the cue;
- self-rated confidence before and after, clearly labelled subjective;
- participant explanation of what helped;
- educator judgement about learning behaviour and possible transfer;
- preference, recorded separately from observed performance.

## 8. Accessibility and recovery probes

Ask about needs without requesting a diagnosis. Record whether the agreed
adjustment was available and whether it changed task completion.

### Accessibility checklist

- Keyboard-only operation and visible focus
- Screen-reader names, state and error announcements
- Text zoom/reflow without hidden readiness or rehearsal controls
- Contrast not dependent on cast colour alone
- Captions or visible state for spoken/prepared partner turns
- Adjustable pace, countdown and reduced-motion needs
- Alternatives to listening, speaking and voice recording
- Touch targets and alternatives to precise dragging
- Plain-language setup status and consistent control names
- Time to process instructions without automatic advance
- Support for fatigue, breaks and resumption
- All-human/manual route available without penalty

### Recovery prompts

Use only one or two naturally relevant probes per session:

- Leave during preparation and return.
- Pause during a partner line, then resume.
- Choose the wrong performer assignment, notice it in rehearsal, and recover.
- Encounter a missing local voice and select another or switch to In Person.
- Begin a source edit, then cancel or undo without data loss.
- Reopen the scene after a restart and explain current readiness.

Never simulate storage loss, delete participant files or disrupt assistive
technology in a live study.

## 9. Measures and provisional decision rules

### Core measures

| Measure | Definition | Recording method |
| --- | --- | --- |
| Unassisted core completion | Import through first completed read-through with no facilitator intervention | `Yes / No / Not testable`; list blockers |
| Facilitator interventions | Any instruction beyond the scripted task, excluding safety, consent or agreed accessibility support | Timestamp, trigger, exact neutral help level |
| Active setup time | Time actively reading, deciding, typing or operating before first rehearsal | Stopwatch excluding passive preparation |
| Passive preparation time | Download, generation, preload or audio-device startup when participant is waiting | Separate stopwatch; classify stage if known |
| Assignment comprehension | Participant correctly explains who performs each role and which voice/path will be used | `Clear / Partial / Incorrect`, with behavioural evidence |
| Accidental source edit | Dialogue or supplied writer note changes when the participant intended only setup/personal notes | Compare before/after; attempted and committed separately |
| False-ready start | Product allows or participant reasonably believes rehearsal is ready while required setup/current audio is incomplete | `Yes / No`, state and consequence |
| Recovery | Participant identifies current state and continues after interruption or error without destructive restart | `Independent / Intervention / Failed / Not tested` |
| Personal note separation | Personal reminder is added without changing source dialogue/writer notes | `Pass / Product blocker / Participant error` |
| Accessibility impact | Barrier or adjustment affecting access, comprehension or completion | Describe barrier, adjustment and residual impact |

### Provisional targets

For the five-person adult beginner pilot:

- **Zero** committed accidental edits to imported dialogue or writer notes.
- **Zero** false-ready starts.
- **At least four of five** first-time participants complete the core journey
  without facilitator intervention.

These are go/no-go targets for the next iteration, not existing results and not
evidence of prevalence or statistical significance.

### Stop and safety criteria

Stop or skip a task when:

- the participant withdraws, appears distressed or asks to stop;
- consent is unclear or a recording begins without explicit agreement;
- source text or another person's files may be exposed;
- a safeguarding arrangement is absent for a minor;
- the app risks destructive change that cannot be safely reversed;
- the facilitator cannot provide the agreed accessibility adjustment;
- the tested build misrepresents recording, storage, model activity or
  readiness.

Pause the pilot for a product correction if any session produces:

- a committed accidental source edit that is not clearly recoverable;
- a false-ready rehearsal start;
- retained audio contrary to the approved process;
- a critical accessibility barrier that excludes the intended participant.

## 10. Research with under-18s: separate pathway

Do not simply reuse the adult pilot. Before any outreach or scheduling, the
study owner must establish an appropriate reviewed process for the country,
organisation, setting and age range.

Minimum boundaries:

- Define specific proposed age bands; “young actors” is not a demographic.
- Obtain appropriate guardian consent and the young person's affirmative
  assent. A guardian's permission does not replace assent.
- Make refusal and withdrawal understandable and consequence-free.
- Involve an educator or safeguarding lead in study design and session
  arrangements, with roles and escalation routes agreed in advance.
- Avoid one-to-one unsupervised contact and private communication channels.
- Use original study text; do not ask for school, production or audition
  scripts.
- Do not collect exact age, name, school, contact details, image, voice,
  transcript or account data unless the reviewed study genuinely requires it.
- Default to no recording. A local voice task needs specific explanation,
  permission, safe handling and a complete non-recording alternative.
- Do not rank, diagnose or evaluate the young person's acting ability.
- Make language, duration, breaks and controls appropriate to the chosen age
  band and individual access needs.
- Agree what the educator/guardian can observe or receive; do not assume they
  should receive private practice data.

### Guardian information and consent template

> This proposed session evaluates an early rehearsal tool using original sample
> text. It is not an audition, lesson assessment or evaluation of the young
> person's ability. Participation is optional. The young person can say no,
> pause, skip a task or stop even if a guardian has consented.
>
> The reviewed session plan must state who will be present, the educator or
> safeguarding arrangements, what written notes are kept, retention and
> deletion, and whether any local voice sample is created. The default is no
> audio, video or transcript recording and no collection of name, exact age,
> school, personal script or contact details.

Record guardian consent only through the organisation's reviewed process.
This template alone is not sufficient authorisation.

### Young-person assent script

> We are trying out a rehearsal tool. We are testing the tool, not your acting.
> You can ask questions, take a break, skip recording your voice, or stop. It is
> okay to say no even if an adult has said the session can happen. Would you
> like to take part?

Check understanding by asking the young person to explain how they can stop.
Do not proceed from silence, compliance or guardian consent alone.

### Questions that must remain open

- Which age bands should be considered, and which should not?
- Should an educator lead, remain present, or review only?
- What session length and language are appropriate for each age band?
- Is independent home use appropriate, or only supported rehearsal?
- What practice information, if any, should be shareable with adults?
- Is voice recording necessary enough to justify inclusion?

## 11. Minimal research data handling

The pilot needs no new telemetry. Use a controlled observation sheet outside
the product.

Collect only:

- study code;
- broad experience band;
- build/device and session condition;
- task outcomes, interventions and separate timing categories;
- concise behavioural observations;
- accessibility adjustment requested for the session and its effect, without
  diagnosis;
- participant ratings or paraphrased feedback clearly labelled as such.

Do not collect by default:

- name, exact age, date of birth, school, employer or contact details;
- personal scripts or commercial play text;
- account identifiers or analytics events;
- audio, video, screen recordings, voice samples or transcripts;
- unrelated personal circumstances.

Before recruitment, the study owner must fill in:

- approved storage location: `[define]`;
- people with access: `[define]`;
- retention period: `[define]`;
- deletion method and contact route: `[define]`;
- process for withdrawing notes: `[define]`;
- incident and safeguarding route, if applicable: `[define]`.

Keep the consent record separate from observation notes if identity is required
by the reviewed process. Delete local test voices at session close or document
why the approved build created none. Report results in aggregate where possible,
and redact any accidentally supplied personal or copyrighted text.

## 12. Issue severity and prioritisation rubric

Severity is based on user impact, not implementation effort.

| Severity | Definition | Examples | Response |
| --- | --- | --- | --- |
| S0 — Safeguarding/privacy stop | Consent, recording, minor safety or unnecessary personal/copyrighted data risk | Recording without permission; missing minor safeguards | Stop study; do not proceed until reviewed |
| S1 — Source/safety critical | Destructive or misleading state with serious actor impact | Imported dialogue changed; false-ready start; unrecoverable work loss | Pause pilot and fix before more sessions |
| S2 — Journey blocker | Prevents core completion or requires facilitator intervention | Cannot resolve continued character; cannot assign role/voice; no accessible route | Prioritise before expanding study |
| S3 — Major friction | Completion possible but understanding or trust is materially reduced | Static cold-start wait appears crashed; unclear performer ownership | Address in next journey iteration |
| S4 — Minor friction | Local inconvenience with a clear workaround and little outcome impact | Label wording or spacing that does not alter comprehension | Batch after higher-severity work |
| S5 — Opportunity | Desired enhancement without demonstrated failure | Optional learning score or extra practice mode | Validate value before building |

Prioritise within severity using:

1. number of sessions affected, reported only as a count in this pilot;
2. whether the participant recovered independently;
3. accessibility/exclusion impact;
4. impact on source integrity, readiness or trust;
5. evidence across monologue, dialogue and all-human paths.

Do not turn five formative sessions into prevalence percentages.

## 13. Observation sheet

Copy once per session.

### Session metadata

- Study code:
- Date:
- Facilitator:
- Build/platform:
- Experience band:
- Condition order:
- Agreed accessibility adjustment:
- Consent confirmed:
- Recording disabled or separately permitted:

### Task record

| Task | Outcome (`independent / intervention / failed / not testable`) | Active time | Passive time | Intervention and level | Behavioural evidence | Accessibility/recovery note | Issue ID |
| --- | --- | ---: | ---: | --- | --- | --- | --- |
| Import Sample A | | | n/a | | | | |
| Confirm continued character | | | n/a | | | | |
| Choose Rae / assign Dev | | | n/a | | | | |
| Record or assign voice | | | | | | | |
| Cold-start preparation | | | | | | | |
| First read-through | | | | | | | |
| Leave and resume | | | | | | | |
| Add personal note | | | n/a | | | | |

### Required checks

- Assignment comprehension: `Clear / Partial / Incorrect`
- Accidental source-edit attempt: `Yes / No`
- Committed accidental source edit: `Yes / No`
- Source restored independently if needed: `Yes / No / Not applicable`
- False-ready start or belief: `Yes / No`
- Recovery: `Independent / Intervention / Failed / Not tested`
- Personal note separate: `Pass / Product blocker / Participant error`
- Core journey completed without intervention: `Yes / No`

### Concept comparison

| Condition | Material/path | Prompts requested by level | Cue dependence observed | Confidence before/after | Participant usefulness | Educator note, if reviewed |
| --- | --- | --- | --- | --- | --- | --- |
| Current method | | | | | | |
| Guided prompting | | | | | | |
| Off-book | | | | | | |

### Issue record

- Issue ID:
- Evidence observed:
- Participant interpretation, if explicitly stated:
- Facilitator interpretation:
- Severity and reason:
- Recovery/workaround:
- Accessibility impact:
- Affected path: `monologue / AI-partner dialogue / all-human dialogue`
- Recommendation or open question:

Avoid reconstructed quotations. Use a quotation only when written down
accurately and permitted by the research process; otherwise paraphrase and
label it as a paraphrase.

## 14. Synthesis template

### Study boundaries

- Sessions completed:
- Adult/age pathway:
- Recruitment source:
- Builds/devices:
- Conditions represented:
- Missing or not-testable paths:
- Deviations from protocol:
- Data limitations:

### Target summary

| Provisional target | Result | Met? | Evidence and caveat |
| --- | --- | --- | --- |
| 0 committed accidental source edits | | | |
| 0 false-ready starts | | | |
| At least 4/5 unassisted core completions | | | |

Report counts, not percentages. Do not fill this table before sessions occur.

### Findings register

| Finding ID | Evidence across sessions | Contradictory evidence | Interpretation | Severity | Accessibility impact | Confidence (`low / medium / high within this pilot`) | Next decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | |

### Learning direction

Answer separately:

- Did guided prompting show observable value beyond preference?
- Did off-book practice show observable value beyond preference?
- Was value present in monologue, AI-partner dialogue and all-human dialogue?
- Did an educator identify plausible learning value and acceptable limits?
- Did either concept increase dependence, frustration or exclusion?
- What would require a larger or longer efficacy study?

### Younger-actor direction

- What adult-pilot issue must be fixed first?
- What evidence suggests different guidance may be needed?
- Which age bands remain plausible to study?
- What educator role is recommended and why?
- What safeguarding or accessibility question remains unanswered?
- Decision: `Do not proceed / Redesign protocol / Prepare separately reviewed minor study`

### Prioritised iteration

| Rank | Issue | Severity | Evidence | Proposed change or research action | Owner | Validation method |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | | | | | | |

## 15. Decision framework

### Support a focused training-direction iteration when

- core safety targets are met or failures have a clear, verified correction;
- at least four of five adult beginners complete the core journey unassisted;
- multiple participants show observable benefit from guided or off-book
  practice beyond saying they like it;
- an acting educator identifies credible learning value and boundaries;
- value appears in at least two paths, including the all-human/manual option;
- accessibility findings show a viable inclusive route rather than a single
  audio-dependent design.

This supports another formative iteration, not a classroom platform or a claim
of educational efficacy.

### Hold and improve the first-rehearsal foundation when

- source integrity, readiness or recovery targets fail;
- active setup is the dominant barrier;
- participants cannot explain performer and voice assignments;
- cold-start feedback undermines trust;
- learning concepts cannot be judged because setup consumes the session.

### Reject or substantially reframe the training direction when

- participants' current methods are consistently more effective and easier;
- guided/off-book concepts mainly create prompt dependence or reading ahead;
- an educator finds little plausible learning value or material pedagogical
  harm that cannot be designed out;
- value depends on retained recordings, personal data or inaccessible audio;
- monologue and all-human routes offer no meaningful use;
- interest is interface novelty without observed learning behaviour.

### Gate before any minor study

Proceed only if:

1. the adult pilot has no unresolved S0 or S1 issue;
2. the intended age band is explicit;
3. a suitable educator or safeguarding lead has reviewed the protocol;
4. guardian consent, young-person assent, adult presence and escalation routes
   are approved for the actual setting;
5. data minimisation, recording defaults and accessibility adjustments are
   documented;
6. the study asks a specific age-related question rather than treating minors
   as a route to broader demand evidence.

## 16. Research readiness checklist

Before the adult pilot:

- [ ] Build and platform recorded
- [ ] Sample A import file created from the original text in this pack
- [ ] Sample B available for concept study
- [ ] Commercial text excluded
- [ ] Adult consent wording reviewed for the study setting
- [ ] Observation sheets use study codes only
- [ ] Storage, access, retention and deletion fields completed
- [ ] No product telemetry added
- [ ] Recording disabled by default
- [ ] Local voice deletion/absence check prepared
- [ ] Active and passive timers prepared
- [ ] Manual/all-human fallback prepared
- [ ] Accessibility adjustments can be honoured
- [ ] Stop criteria understood by facilitator

Before any later minor study:

- [ ] Adult findings synthesised first
- [ ] Exact age band and research question defined
- [ ] Educator/safeguarding lead involved
- [ ] Guardian consent process approved
- [ ] Young-person assent process approved
- [ ] Session presence and communication boundaries approved
- [ ] Data and recording defaults reviewed
- [ ] Accessibility and break arrangements age-appropriate
- [ ] No outreach or scheduling begins before all checks are complete
