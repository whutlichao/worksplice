---
format: 1920x1080
duration: 90s
message: "Several pi agents, one local room — a colliding write is held, not lost."
arc: "Collision → held write → the room's rules → where it runs → install (PAS)"
audience: pi ecosystem developers (first channel: pi Discord #share-your-pi)
mode: collaborative
music: none
---

# worksplice — 90s promo (v2, "The refused write")

## Video direction

- **palette** — from `frame.md`: cream `#FFFAEF` ground; ink `#141111` borders + type; accents rationed two-to-three per frame — **yellow** `#FFD440` (brand/attention), **pink** `#FE7DA8` (product accent), **cyan** `#27CCF3` (second writer / agents), **coral** `#F97264` (conflict / held), **lime** `#A9D877` (resolved). Closing plate is ink. Never gradients, glows, or blurred shadow; hard offset shadow on one featured block per frame at most.
- **motion grammar + reveal model** — every frame reveals each piece **on its spoken cue** (the caption line that names it); long-tail eases (`power3`), no front-loading. In-frame designed captions replace a narration track (project is silent: `music: none`, no `SCRIPT.md`): caption lines are typeset in the frame and revealed one beat at a time, never as one paragraph. Real-footage frames keep the footage's own motion as the primary motion; designed overlays enter only on their cue.
- **rhythm / held frames** — F2 (the held card) and F8 (the local-file plate) are deliberately calm; F6 is the climax and the longest; F1/F5 are designed-motion frames; F3/F4/F7 ride real captured motion. No frame may be front-loaded-then-frozen.
- **negative list** — no slideshow (front-load then freeze), no screensaver (independent floating elements with nothing cued to the caption), no fake product UI (every product surface is the real capture), no generic SaaS gradients/glows/rounded cards, no unlabeled metaphor presented as product behavior, pure black `#000` / pure white `#fff` banned.
- **captions** — no caption track; copy is part of each frame's composition in the bottom-left reading zone (below content, above the mono meta footer). All copy is English and states only what the footage or the product actually does.

## Frame 1 — Two writers

- scene: The room draws itself first — channels, a task board with cards in every column, four agents — then the camera lands on the ONE task card (`#7`, one title line, `In progress`) where two pixel-avatar writers collide; the second write blanks the first and a coral stamp lands: LAST WRITE WINS.
- voiceover: onscreen
- duration: 7s
- poster: 5s
- transition_in: cut
- status: outline
- src: compositions/frames/01-two-writers.html
- type: hook
- persuasion: Pain validation
- beat: tension
- blueprint: kinetic-type-beats (Adapt)
- focal: none (typographic + procedural avatars)
- asset_candidates: (typography-and-diagram frame — no asset files; pixel avatars are generated with the product's own 8×8 seed algorithm).

Open on what the product actually is — **several pi sessions in one local room** — and only then narrow to the collision. The premise must not read as "worksplice fixes multi-agent writes to the same file": nothing here is a file. The room is the subject (channels, a task board, agents), and the collision happens on the write path the product really guards, a task card **inside** that room. No product yet, and the frame must read as a diagram, not as a product screen. Caption cues: "Several pi sessions." → "One room." → "The default: last write wins." The third cue lands with the coral stamp. The card's field values (`#7` / one title line / `In progress`) are exactly what Frame 2 replays. Honesty: this frame depicts the default behavior the README names ("last write wins"); it is explicitly labeled as the default, never as worksplice, and it is a diagram — no product surface is captured or implied. The room's drawing uses the same element language as F3 (channel rows, status lanes, avatars) without copying F3's real capture.

Scene 1 (0.0–2.9s): cream ground, frame chrome (mono topbar, pill). The **room** draws itself in one plate: an ink-bordered panel whose header reads `THE ROOM` / `4 AGENTS ONLINE`; a left rail of channels (`#all` selected, `stream-sync`, `bug-hunt`, `infra-cost`) with counts; a board of the product's five real columns — `Pool`, `In progress`, `In review`, `Done`, `Closed` — each lane carrying a head with its count and small task cards; and a roster of four agents with pixel avatars (nova, quill, iris, marlow) and their online marks. Cue 1 `Several pi sessions.` lands as the room arrives; cue 2 `One room.` follows, and a coral ring marks one card in the `In progress` lane: `#7`.
Scene 2 (2.9–3.4s): the camera lands on that one card — the room pushes past the lens while the card arrives at the same size and seat, so the move reads as one continuous push, not a cut.

Scene 3 (3.4–5.2s): the two writers. A cyan cursor ring + pixel avatar (nova) enters from the left and sweeps a coral write-bar across the card's title line; a pink cursor ring + avatar (quill) answers from the right and its pink write-bar runs onto the SAME line, so both writes sit on one field at once — the mirrored step-in is the collision.
Scene 4 (5.2–7.0s): the earlier write is blanked in one beat as the coral sweep runs the line; the third cue lands as a coral block-stamp rotates in (−6deg) over the card's empty right end with `LAST WRITE WINS`; the frame holds still for the read.

## Frame 2 — Held, not lost

- scene: The same collision replays on the same task card (`#7`, same title, `In progress`) — but the second write freezes mid-sweep into an ink-bordered HELD card that lists exactly what changed.
- voiceover: onscreen
- duration: 5s
- poster: 4s
- transition_in: cut
- status: outline
- src: compositions/frames/02-held-not-lost.html
- type: product_intro
- persuasion: Negative contrast
- beat: relief + control
- blueprint: compose
- focal: none
- asset_candidates: (typography-and-diagram frame — no asset files).

The value claim lands by beat 2: same collision, opposite outcome. The card carries the identical field values F1 shows — `#7`, the same one-line title, the same `In progress` column — so the replay reads as the same task, not a second example. Copy cues: "Not here." → "The write is held — not merged, not overwritten." Mono line on the card: `held · the room moved while you were writing`. Honesty: this is the product's real behavior (freshness hold); copy mirrors the product's own wording, and the card is still a diagram — no captured product surface.

Scene 1 (0.0–1.6s): the F1 end-state holds one beat (continuity), then the sweeping write-bar freezes mid-sweep, turns ink, and the card re-seats as a `HELD` card — the freeze is the signature move.
Scene 2 (1.6–3.4s): the coral verdict is replaced in place by the ink `HELD` chip and one mono line types in beneath it on the card, on its cue; the card's `TASK TITLE` field and its title line sit above the writes throughout.
Scene 3 (3.4–5.0s): a second, cream-and-ink "what changed" panel slides up under the card carrying the mono line; the frame holds still.

## Frame 3 — The room

- scene: Real capture: the demo board fills the frame while a crop bracket steps across its columns, then cuts to a real channel where a conversation reads like work.
- voiceover: onscreen
- duration: 15s
- poster: 11s
- transition_in: zoom-through
- status: outline
- src: compositions/frames/03-the-room.html
- type: product_intro
- persuasion: Show-don't-tell proof
- beat: clarity
- blueprint: device-surface-showcase (Adapt)
- focal: assets/board.mp4
- roles: board = cutout · channel = cutout · chrome = supporting
- asset_candidates: assets/board.mp4 — the real demo board, five columns, pointer over cards; assets/channel.mp4 — the real demo channel with agent messages.

Introduce the product by its surface, with real motion (this is what v1 replaced with static screenshots). Copy cues: "Several pi sessions. One local room." → "Channels, a task board, review." → "A workspace — not a chat log." Honesty: both clips are captures of the running product with demo data; no invented UI.

Scene 1 (0.0–5.0s): the real board plays as a cutout plate (ink border, hard offset shadow) seated centre-right; the caption line types in bottom-left; the plate enters with a short push-in (zoom-through from F2).
Scene 2 (5.0–10.0s): as the second cue lands, the crop bracket steps onto the board's real columns — left edges 429/615/801/987/1173, the bracket exactly one column wide (186px) — stopping on Pool → In progress → In review → Done; the mono chip under the bracket names the column the bracket is actually sitting on. Four stops, not five: the stop timing is frozen, so the run ends one column short of Closed. The footage itself never moves.
Scene 3 (10.0–15.0s): hard cut inside the frame to the channel capture (same plate geometry) as the third cue lands; the conversation scrolls once and holds.

## Frame 4 — A wake is a pointer

- scene: Real capture: a wake message lands in the real channel; over it, a mono payload card opens the envelope to show the whole message that was sent.
- voiceover: onscreen
- duration: 11s
- poster: 8s
- transition_in: crossfade
- status: outline
- src: compositions/frames/04-wake-is-a-pointer.html
- type: feature_showcase
- persuasion: Mechanism clarity
- beat: curiosity → trust
- blueprint: cursor-ui-demo (Adapt)
- focal: assets/hold-wake.mp4
- roles: hold-wake = cutout · payload-card = cutout · chrome = supporting
- asset_candidates: assets/hold-wake.mp4 — the real run: messages land in the live channel while the agent's status turns working.

Show the mechanism on real state change. Copy cues: "Wake an agent — this is the whole message." → "`{ agentId, targetId, seq }`." → "A pointer, not the body. The agent reads the room itself." Honesty: the payload shape is the documented real wake (`{agentId, targetId, seq}`); the arrival on screen is the real run capture.

Scene 1 (0.0–4.0s): the channel plate holds; the wake message row arrives with the product's own new-message highlight (real capture); a mono kicker "WAKE" marks it.
Scene 2 (4.0–7.5s): on the second cue, a compact mono payload card (ink border, hard shadow) slides in over the footage and the three fields tick in one by one.
Scene 3 (7.5–11.0s): the third cue: the payload card shrinks to a hint chip and docks beside the message while the sidebar status turns to working (real capture); the frame holds.

## Frame 5 — A cursor, not a list

- scene: A designed cursor diagram over the real messages: a read line advances only on an ack, so a restart resumes exactly where the agent stopped.
- voiceover: onscreen
- duration: 9s
- poster: 6.5s
- transition_in: crossfade
- status: outline
- src: compositions/frames/05-cursor-not-a-list.html
- type: feature_showcase
- persuasion: Friction reduction
- beat: insight
- blueprint: compose
- focal: assets/messages.mp4
- roles: messages = background (dim ~35%) · cursor-diagram = cutout
- asset_candidates: assets/messages.mp4 — the real demo message feed.

The second rule, said in one diagram. Copy cues: "What an agent has read survives a restart." → "Reading doesn't advance the cursor." → "An ack does — one durable position." Honesty: describes the documented cursor semantics; the feed behind is a real capture, dimmed as a backdrop, never claimed as the cursor itself.

Scene 1 (0.0–3.0s): the message feed plays full-bleed, dimmed; a single ink position line sweeps down the feed and stops in the real gap between message `#11` and message `#12`, with a coral `read: seq 11` tick (the tick is design) — the line rides the conversation, so it reads as a cursor mark, not a progress bar.
Scene 2 (3.0–6.0s): the second cue: the line stays put; the captured feed really scrolls under it (reading keeps reading, the position does not move).
Scene 3 (6.0–9.0s): the third cue: a lime `ack` chip drops onto the line and the position steps forward exactly one — `read: seq 11` rolls to `seq 12`, the next real message in the feed; a mono footnote reads `survives a restart`; hold.

## Frame 6 — The held write

- scene: The real run: the interjection lands while the agent writes; her draft is held; then her revised reply arrives, answering what actually happened — with the product's own revise prompt shown as evidence.
- voiceover: onscreen
- duration: 21s
- poster: 17s
- transition_in: zoom-through
- status: outline
- src: compositions/frames/06-the-held-write.html
- type: feature_showcase
- persuasion: Show-don't-tell proof
- beat: suspense → trust
- blueprint: agent-progress-theater (Adapt)
- focal: assets/hold-reply.mp4
- roles: hold-wake = cutout · hold-reply = cutout · evidence-card = cutout · chrome = supporting
- asset_candidates: assets/hold-wake.mp4 — the real run: the interjection lands while the agent is writing; assets/hold-reply-story.mp4 — the real run: her revised reply appears in the channel.

The centrepiece. Copy cues: "While she was writing, the room moved." → "Her draft was held — not merged, not overwritten." → "She re-read, rewrote, and answered what actually happened." → "This is her session file, not a UI effect." Honesty: every line is the real run; the evidence card reproduces that run's own revise prompt as a paths-free verbatim excerpt, and the reply shown is the real revised reply from the same run. The room is English-only end to end — the capture ran without a secretary, so no Chinese event messages were ever posted into it.

Scene 1 (0.0–6.0s): the channel plate holds the real footage; at the first cue the interjection row arrives with the product's highlight, and the held count `1 new message(s)` flickers in the sidebar as design annotation.
Scene 2 (6.0–12.0s): the plate pushes in to the message column; the second cue lands as an ink `HELD` stamp hits the writing row — the signature freeze-and-stamp, now on real footage. The freeze is short (the stamp lifts ~1.7s after it settles, so the beat never reads as a stall), and the plate stays on the room while the room's own status ticks over.
Scene 3 (12.0–17.5s): the evidence card slides up over a dimmed plate: mono, ink-bordered, three verbatim lines — `Your reply to channel parser-fix was held because the room changed while you were writing.` / `What happened: 1 new message(s) arrived in this target (seq 6).` / `Your held draft was:` — typed line by line on the third cue. The reply shown in the footage is the real revised reply of that same run.
Scene 4 (17.5–21.0s): the evidence card lifts away; the real revised reply is on screen in the channel (the footage from the same run) and the frame holds for the read on the last cue.

## Frame 7 — Only someone else can approve

- scene: Real capture: the board's In-review card, Approve/Reject hovered; a designed X lands on a self-approve attempt.
- voiceover: onscreen
- duration: 9s
- poster: 6.5s
- transition_in: crossfade
- status: outline
- src: compositions/frames/07-approve-by-other.html
- type: feature_showcase
- persuasion: Statistical proof (rule enforcement)
- beat: confidence
- blueprint: cursor-ui-demo (Reproduce)
- focal: assets/review.mp4
- roles: review = cutout · badge = cutout
- asset_candidates: assets/review.mp4 — the real board card in review, Approve/Reject under the pointer.

The fourth rule, on the real board. Copy cues: "\"Done\" is not a claim." → "It's a state machine." → "Only someone other than the author can approve." Honesty: the hover is real; no click is claimed (the demo state is not mutated); the rule is the product's enforced review rule.

Scene 1 (0.0–3.0s): the board plate holds on the In-review column (crop), the pointer travels to the card on cue.
Scene 2 (3.0–6.0s): the second cue: a mono state strip draws under the card — `claimed → in_review → done` — with the current state boxed.
Scene 3 (6.0–9.0s): the third cue: a coral OK-stamp lands on `Approve` while a small ink line reads `the builder cannot verify their own work`; hold.

## Frame 8 — Local, one file

- scene: A calm statement plate: one SQLite file, loopback, no accounts — with the project's honest note set as a small mono line.
- voiceover: onscreen
- duration: 7s
- poster: 5s
- transition_in: crossfade
- status: outline
- src: compositions/frames/08-local-one-file.html
- type: benefit_highlight
- persuasion: Risk reversal + honesty
- beat: peace of mind
- blueprint: titlecard-reveal (Reproduce)
- focal: none
- asset_candidates: (typography-and-diagram frame — no asset files).

The trust beat, and the project's own honesty discipline on screen. Copy cues: "Local. One SQLite file." → "Loopback by default. No accounts." Mono footnote, verbatim positioning from `docs/launch-plan.md` §2: `One honest note: pi's roadmap includes a pi server that will cover part of this. This is the version that exists today.` Honesty: the footnote is the project's own honest-overlap statement, used verbatim.

Scene 1 (0.0–2.4s): cream plate; the first line seats centre-left at display size on cue.
Scene 2 (2.4–4.8s): the second line appends beneath; a small ink file-chip (one rectangle labeled `worksplice.db`) draws beside them.
Scene 3 (4.8–7.0s): the mono footnote fades up beneath, smaller, quiet; the frame holds dead still (deliberate breather).

## Frame 9 — Install

- scene: Ink closing plate: the wordmark lockup, a terminal pill that types `npx worksplice`, then the repo line.
- voiceover: onscreen
- duration: 6s
- poster: 5s
- transition_in: cut
- status: outline
- src: compositions/frames/09-install.html
- type: cta
- persuasion: Friction reduction
- beat: motivation
- blueprint: prompt-type-submit-generate (install-command end card)
- focal: none
- asset_candidates: (typography-and-diagram frame — no asset files).

End on the real command from the README's Quick Start. Copy cue: "Run it with your own pi sessions." Command: `npx worksplice`; repo line: `github.com/whutlichao/worksplice`. Honesty: command and URL come from the README.

Scene 1 (0.0–2.0s): ink plate; the yellow-square wordmark lockup assembles from the very first frame (logo square pops, wordmark letters settle) while the cue lands — the plate is never an empty dark frame. The lockup is sized to hold the frame on its own.
Scene 2 (2.0–4.4s): a cream terminal pill springs in and types `npx worksplice` with a blinking caret; a mono line under it: `local · one sqlite file · no accounts`.
Scene 3 (4.4–6.0s): the repo line fades up; everything holds still to the last frame.
