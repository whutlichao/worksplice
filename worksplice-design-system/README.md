# worksplice Design System

A reusable, source-backed design system for **worksplice**, a local-first encrypted
multi-agent + human collaboration workspace. Extracted from the Open Design prototype
`worksplice-app.html` (project "Web Prototype", `228a9bdf-…`) and packaged so any
future surface — or an agent — can build on-brand UI without re-deriving tokens.

## What's here

```
DESIGN.md              human-facing contract: theme, color, type, spacing, layout,
                       components, motion, voice, anti-patterns
colors_and_type.css    canonical color + typography tokens (the --bg/--surface/--fg/
                       --muted/--border/--accent contract), oklch() only
tokens.css             spacing, radius, elevation, layout, motion, z-index
SKILL.md               agent-facing: how to compose new surfaces with this system
README.md              this file
context/
  provenance.md        where every value came from + fidelity notes
  source-context.md    Open Design handoff record
assets/                brand-mark.svg, wordmark.svg, icon-sprite.svg (source vectors)
build/                 icons.svg (compiled sprite) + icons.json (id → viewBox)
fonts/                 (empty) — system stack is intentional; no font files shipped
preview/               focused review cards + index.html manifest
ui_kits/app/           applied interface kit (AppShell, rail, stream, board, dock …)
screens/               sliced per-surface reproductions of the source monolith
  channel-view.html    full three-column app shell + messages + composer
  task-board.html      kanban / list task board with drag state machine
  thread-panel.html    right-dock task thread (status, assign, timeline, reply)
  agent-detail.html    right-dock agent overview / runtime / activity
  modals.html          new-channel, new-task, new-agent, reminders, settings, members
  search-command.html  search view + ⌘K command palette
  mobile-shell.html    responsive drawer shell (≤900px)
  workspace-sidebar.html  standalone rail with every nav state
  overview.html        full-page panorama index of all slices
```

## Start here

1. **Reviewers**: open `preview/index.html` — a manifest linking every focused card.
   Best first cards: `preview/colors-primary.html`, `preview/typography-specimens.html`,
   `preview/components-buttons.html`, then `preview/applied-app-shell.html`.
2. **Designers/engineers**: read `DESIGN.md`, then import
   `colors_and_type.css` + `tokens.css`.
3. **Agents**: read `SKILL.md`.

## Core principles

- **One accent, many meanings.** A single indigo-blue `--accent` is the agent/action
  color. Status hues (`--online/--working/--error/--offline`) are reserved for agent
  presence and task state — color is never decorative.
- **Layered surfaces, not shadows.** Depth comes from `--bg → --panel → --surface`
  plus hairline borders; shadows only for popovers, modals and drawers.
- **Monospace as structure.** Identifiers, timestamps, counts, metrics, key/value
  rows and uppercase section labels are all `--mono` with tabular numerals.
- **The token contract is load-bearing.** Existing components depend on
  `--bg / --surface / --fg / --muted / --border / --accent` by name. Never rename.

## Direction

`modern-minimal` — Linear / Vercel register: near-white paper, tight 13px density,
small radii, hairline dividers, a restrained single accent. Bound verbatim from the
source file's own `:root` block, reproduced unchanged in `colors_and_type.css`.

## Fidelity

Every token, component class and copy string was read from `worksplice-app.html`.
The brand mark, wordmark and icon set are SVG reconstructions of the inline vector
paths in that file (no binary assets existed in the source). See
`context/provenance.md` for the full account and known gaps.
