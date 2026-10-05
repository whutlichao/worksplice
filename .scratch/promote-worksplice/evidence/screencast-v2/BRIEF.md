---
workflow: product-launch-video
flow: automation
storyboard: yes
message: "Several pi agents, one local room — a colliding write is held, not lost."
destination: youtube-embed
aspect: 1920x1080
language: en
audience: pi ecosystem developers (first channel: pi Discord #share-your-pi)
length: 90s
angle: "conflict → the held write → the room's rules (PAS spine)"
---

## Intent

A 90-second promo for worksplice's open-source launch, made for pi ecosystem
developers. The pitch concept is **"The refused write"**: open on the collision of
two agents writing at once, make the *held* write the centerpiece of the film, and
resolve into the room's rules — who has read what, who may write, who verifies.
Tone: plain, technical, honest — no hype, no magic. Real UI and a real session-file
excerpt carry the proof; designed motion carries the story.

## Assets

- Live demo UI at `http://127.0.0.1:3123` (`node bin/worksplice.js --demo --port 3123 --no-open`) — real pages to be captured as motion for the film.
- `.scratch/promote-worksplice/evidence/part-b-revision-prompt.txt` (main repo) — real revise-prompt excerpt, publishable, no local paths.
- `.scratch/promote-worksplice/evidence/screencast/README.md` (main repo) — the v1 record: what to beat, and the replay recipe.
- `/tmp/orch-worksplice/old-90s.mp4` — the rejected v1, for the "beat it" bar only.

## Customizations

- Fully silent: no narration, no BGM, no SFX (`music: none` + no `SCRIPT.md`).
- English on-screen captions only; all interaction happens in the real product UI.
- Real motion: Playwright screen recordings of the running demo, plus a freshly
  re-run real hold/revise sequence including live message arrival and status change.
- Designed motion graphics: typography, the two-writes-collide motif, held-card,
  the three semantics, held-open evidence, install end card.

## Notes

- Truth anchors: `docs/launch-plan.md` §2 (positioning, four semantics, comparison
  discipline, one honest note) and issue 02/03 wording. No invented product behavior.
- Red lines: no local paths / usernames / keys / `part-b-session.jsonl` content on
  screen; no fake UI, no synthesized agent messages; captions and on-screen copy must
  match what actually happened in the captured runs.
- Craft bar: must be visibly better than v1 (static screenshots + ffmpeg zoompan).
  Real state changes and designed motion only — no slideshow, no screensaver motion.
- Bottom ~17% reserved for the caption band.
- Do not publish anything; the film's release is the user's decision after acceptance.
