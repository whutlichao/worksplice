# Frame packet: 05-cursor-not-a-list

## Project inputs

- Project: /Users/apple/orca/workspaces/worksplice/screencast-v2/.scratch/promote-worksplice/evidence/screencast-v2
- Design tokens: /Users/apple/orca/workspaces/worksplice/screencast-v2/.scratch/promote-worksplice/evidence/screencast-v2/frame.md
- RULES_DIR: /Users/apple/.agents/skills/hyperframes-animation/rules

## Assigned storyboard block

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

Scene 1 (0.0–3.0s): the message feed plays full-bleed, dimmed; a single ink position line sweeps down the feed and stops at a coral `read: seq 42` tick (the tick is design).
Scene 2 (3.0–6.0s): the second cue: the line stays put; a subtle scroll of the feed passes under it (reading keeps reading, the position does not move).
Scene 3 (6.0–9.0s): the third cue: a lime `ack` chip drops onto the line and the position steps forward exactly one; a mono footnote reads `survives a restart`; hold.
