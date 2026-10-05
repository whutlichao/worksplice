# worksplice — 90s promo v2 (“The refused write”)

HyperFrames project for the worksplice 90-second launch video (2026-10-04).
Silent, English designed in-frame captions, 1920×1080, 30 fps, ≈90 s.

- Final film: `renders/worksplice-90s-v2.mp4`
- Storyboard (approved): `STORYBOARD.md` · sketch sheet: `storyboard.html` / `storyboard-v1.png`
- Brief: `BRIEF.md` · design system: `frame.md`

## What it is (content layer)

Nine frames: a designed collision (F1–F2), the real product room (F3), the four
room rules on real captures (F4–F7), where it runs + the honest note (F8), install
end card (F9). Every product surface is a real capture of the running product; the
one piece of non-capture evidence (the held-write session excerpt) is the verbatim
revise prompt from a real run. F1/F2/F5's diagram layers are design, labelled as
such on screen.

The F1/F2 collision is staged on the write path the product actually guards — one
**room task card** (`#7`, a single title line, board column `In progress`), the same
object a message or a task-state write would move. It is deliberately not a file:
worksplice holds room writes (freshness hold), not file locks, and the diagram must
not read as a claim about files.

## Reproduce

Prerequisites: Node v25, `bun`, Chrome (system), `ffmpeg`/`ffprobe`, and the
HyperFrames CLI. This project pins **hyperframes@0.8.90** (see `package.json`);
`npx hyperframes@latest upgrade --check` was probed on 2026-10-04 and hung with no
output, so the run stays on the pinned version.

```sh
# 0) worktree root
cd <worktree>            # the repo checkout
bun install
bun run build                        # bin/worksplice.js runs `next start`, so it needs .next

# 1) demo room + board capture (F3 / F5 / F7)
#    seed into its own data dir — do NOT use --demo, which needs demo/worksplice.db
WORKSPLICE_DATA_DIR=/tmp/ws-demo3 node scripts/seed-demo.mjs
#    then: capture-scripts/demo-add-cards.mjs (+ demo-finish-cards.mjs) adds 1–2
#    English task cards per column through the collaboration domain layer
#    (createTask / claimTask / updateTaskStatus); the seeded Chinese secretary
#    channel is renamed to `secretary-office` (no rename API exists — data-only, and
#    the room is labelled demo data on screen)
WORKSPLICE_DATA_DIR=/tmp/ws-demo3 PI_CODING_AGENT_DIR=/tmp/ws-v2r3/pi-agent \
  node bin/worksplice.js --port 3123 --no-open     # demo room for captures
#    capture: capture-scripts/demo-capture.mjs (+ demo-channel-take.mjs, demo-align-cuts.mjs)

# 2) real-run capture (F4 / F6; optional — assets/ already ships them)
#    needs a second, non-demo instance + a temp PI_CODING_AGENT_DIR (see below)
#    capture: capture-scripts/real-run-capture.mjs

# 3) rebuild the assembled index (restores hoisted videos first!)
bash rebuild.sh                       # -> index.html + transitions injected

# 4) verify + render (HYPERFRAMES_BROWSER_PATH avoids the managed-Chrome hang)
npx hyperframes check
HYPERFRAMES_BROWSER_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  npx --yes hyperframes@0.8.90 render --quality high --video-frame-format png \
  --output renders/worksplice-90s-v2.mp4
```

The render must run in the **foreground**: a `nohup … &` render is killed when its
parent shell exits (`render_cancelled_parent_exited`), part-way through the capture.

## Real-run capture recipe (for the F4/F6 evidence)

```sh
mkdir -p /tmp/ws-v2r3/{pi-agent/sessions,project,data,out}
ln -s ~/.pi/agent/auth.json ~/.pi/agent/models.json /tmp/ws-v2r3/pi-agent/   # symlink, never copy keys
#  ↓ the point of this recipe: an EMPTY settings.json, i.e. no default model
echo '{}' > /tmp/ws-v2r3/pi-agent/settings.json
#  ↓ English is enforced twice: in the agent dir (global) and in the run project
printf '# Language\n\n- The people in this workspace speak English. Always answer in English.\n' \
  > /tmp/ws-v2r3/pi-agent/AGENTS.md
cp /tmp/ws-v2r3/pi-agent/AGENTS.md /tmp/ws-v2r3/project/AGENTS.md
WORKSPLICE_DATA_DIR=/tmp/ws-v2r3/data PI_CODING_AGENT_DIR=/tmp/ws-v2r3/pi-agent \
  node bin/worksplice.js --port 3126 --no-open
# then run capture-scripts/real-run-capture.mjs (creates agent+channel, waits for quiet,
# records the channel with Playwright, posts the wake, waits for the session's
# `[worksplice:target=<ch> seq=N]` drain marker, mutes the channel, posts the
# interjection, waits for `[worksplice:revision]`, then holds on the reply)
```

**Why the empty `settings.json` matters.** worksplice auto-creates the secretary
“Susan” on startup *only when* a default model is configured, and Susan is what pulls
the Chinese in: her creation posts the Chinese event messages (`新频道 … 已建立`,
`新成员 … 加入频道`) from `lib/domain/collab/event-messages.ts`, and her welcome
replies come from her own model. With no default model, `autoCreateSecretary` logs
`secretary auto-create skipped: no default model configured`, no Susan is created,
`findSusanMember()` returns undefined and **no event message is posted at all** — the
room stays English. Beware: creating the run's agent writes the session's model into
that same global `settings.json`, so a later server restart *would* create Susan;
reset the file to `{}` before every fresh run.

Model choice matters too: most ids in this provider have no upstream channel. Probing
`pi -p --provider new-api --model <id> "Reply with exactly: OK"` is the quick gate —
`space-bunny-free`, `agnes-*`, `step-5-preview`, `deepseek-v4.1-flash` answered,
everything else 503'd or rejected pi's `developer` role. This cut uses `step-5-preview`.

The wake prompt must ask for **English replies** and say “revise instead of anyway”.
The interjection must land **right after the drain marker** (she is mid-draft) and
the channel must be **muted** first so the interject does not wake a second round
(mute blocks wake, not the hold). The free model is flaky: expect retries.

## Pitfalls (learned the hard way)

1. **`assemble-index.mjs` hoists `data-frame-video="approved"` videos destructively** —
   it replaces them with comment placeholders inside the frame files. Always run
   `bash .hyperframes/video-sources/restore.sh` before (re-)assembling; `rebuild.sh`
   does this automatically. Never hand-edit a frame that has been hoisted without
   checking `</video>` still exists.
2. **Hoisted videos paint above the whole frame** (DOM order, no z-index). Any DOM
   overlay that must sit over footage needs an explicit `z-index ≥ 2`. This also
   makes the layout audit report false `text_occluded` / contrast findings on those
   overlays; mark intentional layering with `data-layout-allow-occlusion` /
   `data-layout-allow-overlap`.
3. **Element ids must start with a letter** — `id="06-card"` throws in
   `querySelector`/GSAP and fails lint (`id_requires_css_escape`). Use `f06-…`.
4. **No GSAP tweens on layout properties** (`width` / `height` / `top`) — lint
   `gsap_non_transform_motion`. Convert to `scaleX` / `scaleY` / `y` with a
   `transform-origin`.
5. **Captions with `line-height < 1`** trigger `content_overlap` in the layout audit
   even when they look fine; use ≥ 1.04.
6. **Renders hang on “Checking browser”** unless `HYPERFRAMES_BROWSER_PATH` points at
   the system Chrome (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`).
7. The demo site in a source checkout needs `node scripts/build-demo-db.mjs` once;
   otherwise `--demo` refuses to start.
8. `localStorage` is per origin: set `worksplice-locale=en` again after changing port.
9. Render gates on video coverage: every declared video must actually fall inside the
   assembled clip window, or the render aborts (a short sample cut can orphan one).
10. **Keep every video window inside its source**: `data-media-start + data-duration`
   must be ≤ the asset's duration, or the clip freezes on its last frame (Chromium
   clamps the seek) for the remainder of the window. If a scene needs more footage
   than an asset has, re-cut the asset from the webm master instead of stretching the
   window.
11. **The first seconds of a Playwright recording show the pre-navigation state**
   (the previously open channel — in this run, another room full of join-event
   messages). Start capture cuts after the navigation/click settles. The masters live
   in `/tmp/ws-v2/run2/webm/`; the shipped `hold-wake*.mp4` are cut from 3.5s onward.

## Files

```
BRIEF.md · STORYBOARD.md · STORYBOARD.sample.md · frame.md · storyboard.html · storyboard-v1.png
index.html                      # assembled standalone composition (regenerate with rebuild.sh)
compositions/frames/01..09-*.html
capture-scripts/                # the drivers that produced assets/*.mp4 (see the recipes above)
assets/*.mp4 (real captures, pre-cropped) · assets/fonts/*.woff2 (brand faces)
.hyperframes/video-sources/     # video declarations + restore.sh (hoist guard)
rebuild.sh                      # restore → assemble → transitions → verify
verify-f03-bracket.mjs          # pixel check: F3's crop bracket vs the board's real columns
renders/worksplice-90s-v2.mp4   # final film
renders/sample-f2-f6.mp4        # gate sample: new F2 (5s) + F6 head (16s)
```

## Truthfulness inventory (per frame)

Legend: **现场真跑** = fresh recording of the real (non-demo) instance driven by a
real pi agent; **--demo** = recording of the local demo site; **设计动效** = designed
type/diagram layer authored in HyperFrames; **证据文本** = verbatim text from the
product/session, rendered as designed type.

The real-run footage is **English end to end**. The previous cut was not: worksplice's
server-side event templates are Chinese, and the run room had a secretary, so
`@Susan … 已建立` rows and her Chinese welcome landed in the shot. The capture now runs
against an agent dir with **no `defaultModel`**, so `autoCreateSecretary` skips Susan
entirely (`lib/domain/collab/event-messages.ts` returns early when there is no Susan),
and both the agent dir and the run project carry an English `AGENTS.md`. The result is a
real run of the real product with zero CJK in the room — verified before and after the
take by scanning every message row for CJK. The evidence card in F6 reproduces that
run's own revise prompt as a paths-free verbatim excerpt.

The demo footage comes from a locally seeded demo room (`scripts/seed-demo.mjs` into its
own data dir), extended for the board capture with one or two extra English task cards
per column — added through the product's own collaboration domain layer
(`createTask` / `claimTask` / `updateTaskStatus`), never by editing the seed script or
writing rows directly, so every card sits in a state the product's own state machine
allows. F3's bracket still lands on the same column edges (429/615/801/987/1173) as the
approved cut: adding cards does not move the columns.

`storyboard.html` / `storyboard-v1.png` are the **approved storyboard sketch from gate 2**
and are kept as delivered; they predate the F1/F2 task-card rework, so their F1/F2 mocks
still show the old `parser.js` card. `STORYBOARD.md` is the current description.

| Frame | Category | Source of every visible pixel |
| --- | --- | --- |
| 01 Two writers | 设计动效 | designed diagram: the **room** first (channels, the five board columns with cards and counts, four agents) then the one task card (`#7` · one title line · `In progress`) where the two writers collide — labelled as the default behaviour, no captured surface; pixel avatars use the product's own 8×8 seed algorithm |
| 02 Held, not lost | 设计动效 | designed; card carries the same field values as F1 (`#7` · same title · `In progress`); copy mirrors the product's own `held · the room moved while you were writing` wording |
| 03 The room | --demo | real capture of the locally seeded demo room (`board.mp4`, `channel.mp4`) — every board column carries real cards; the plate is never moved, the crop bracket is |
| 04 A wake is a pointer | 现场真跑 + 证据文本 | real-run capture (`hold-wake.mp4`, `hold-wake-story.mp4`) + documented payload shape `{agentId, targetId, seq}` |
| 05 A cursor, not a list | 设计动效 + --demo | designed diagram over a dimmed demo capture (`messages.mp4`, which really scrolls during F5's scene 2); the read line rests in the real gap between messages `#11` and `#12` and the readout names `seq 11` → `seq 12`; marked on screen |
| 06 The held write | 现场真跑 + 证据文本 | real-run capture (`hold-wake.mp4`, `hold-wake-story.mp4`, `hold-reply-story.mp4`) + the verbatim revise-prompt excerpt from that same run |
| 07 Approve by other | --demo + 证据文本 | real demo capture (`review.mp4`, hover only — no click) + the enforced review rule; the OK-stamp is coral `#F97264` |
| 08 Local, one file | 设计动效 + 证据文本 | designed; honest note verbatim from `docs/launch-plan.md` §2 |
| 09 Install | 设计动效 + 证据文本 | designed; `npx worksplice` + repo URL from the README Quick Start |
