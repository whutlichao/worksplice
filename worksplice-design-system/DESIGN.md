# worksplice Design System

> Category: Project Design System
> Surface: web
> Direction: `modern-minimal` (Linear / Vercel register) — bound from the source tokens
> Source: Open Design project "Web Prototype" (228a9bdf-5a68-4d36-a153-9771522ea041),
> copied file `worksplice-app.html` (1,865 lines).

worksplice is a local-first, encrypted multi-agent + human collaboration workspace.
Humans and Agents share Teams / Channels and cooperate over Work Objects (messages,
tasks). The interface is a **three-column Next.js application shell** — a persistent
workspace rail on the left, the channel main column in the center, and a contextual
detail dock on the right — with modals and a command palette layered on top.

This document is the human-facing contract. `colors_and_type.css` is the machine
source for color + type; `tokens.css` adds spacing / radius / elevation; `SKILL.md`
tells an agent how to compose new surfaces with it.

---

## 1. Visual Theme & Atmosphere

A calm, legible operator console for human–agent teamwork. The mood is **technical
but warm**: a near-white paper canvas, hairline separators, and a single indigo-blue
accent that reads as "the agent color". Density is high (13px base, 6–8px vertical
rhythm) yet never cramped — every row has breathing room, and the layered surfaces
(`--bg` → `--panel` → `--surface`) create depth without shadow noise.

The signature is **status made visible**: agents carry a live presence dot
(online / working / error / offline), tasks carry a state-machine color, and both
appear consistently in the rail, the message stream, cards, and the dock. Nothing is
decorative; every hue means something.

Restraint rules observed in the source:

- One accent hue for the entire app; it is the agent/action color and appears sparingly.
- Radius is small and consistent (6/8/12/16). No pill-shaped cards; pills only for
  counts, tags, status and reaction chips.
- Shadows are hairline and directional, used only for popovers, modals and the
  message hover toolbar — never on resting content.
- Monospace is a first-class voice: every identifier, timestamp, count, token metric,
  key/value row and section label is mono with `tabular-nums`.

## 2. Color

All color is authored in `oklch()` in `colors_and_type.css`. Do not introduce hex.

### Surfaces & text (the load-bearing `--bg --surface --fg --muted --border --accent` contract)

| Token | Value | Role |
| --- | --- | --- |
| `--bg` | `oklch(99% 0.002 240)` | page canvas behind the main column |
| `--surface` | `oklch(100% 0 0)` | cards, panels, header chrome, popovers |
| `--panel` | `oklch(97.4% 0.004 250)` | rail, board columns, stat wells, pin strip |
| `--panel-2` | `oklch(95.6% 0.006 250)` | nested wells, inactive tags, code chips |
| `--fg` | `oklch(21% 0.014 255)` | primary text, active tab underline, toolbar fill |
| `--muted` | `oklch(50% 0.014 255)` | secondary text, inactive nav / tab labels |
| `--faint` | `oklch(56% 0.013 255)` | tertiary text, meta, placeholders, scrollbar |
| `--border` | `oklch(92% 0.006 250)` | hairline separators |
| `--border-strong` | `oklch(85% 0.008 250)` | inputs, composer, interactive borders |
| `--accent` | `oklch(56% 0.17 256)` | primary action + agent identity |
| `--accent-hover` | `oklch(50% 0.17 256)` | primary pressed/hover |
| `--accent-soft` | `color-mix(--accent 11% transparent)` | soft fills, active nav tint |
| `--accent-line` | `color-mix(--accent 40% transparent)` | softened accent borders |

### Semantic status

| Token | Value | Meaning |
| --- | --- | --- |
| `--online` | `oklch(64% 0.15 152)` | agent idle / granted / success |
| `--working` | `oklch(74% 0.15 78)` | agent busy / pending review / highlight |
| `--error` | `oklch(60% 0.19 27)` | failure, destructive, unread dot |
| `--offline` | `oklch(78% 0.008 250)` | agent offline / closed |

Task status maps directly: `todo → --faint`, `in_progress → --accent`,
`in_review → --working`, `done → --online`, `closed → --offline`.

### Avatar palette

Five deterministic pastel tints keyed by member index (`--av-0…--av-4`): blue, teal,
amber, coral, and a neutral used for "you". Avatar tiles are 7px-radius squares, not
circles — a deliberate differentiator from chat products.

## 3. Typography

One system sans for everything, one monospace for anything numeric or structural.
No display serif, no third family. The system stack is deliberate — it renders the
Chinese UI (`PingFang SC`) and Latin identically across platforms, which a webfont
would not without shipping megabytes.

```
--font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
        "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif;
--mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
```

| Role | Size / weight | Usage |
| --- | --- | --- |
| Channel title (h1) | 16px / 680 | `#频道名`, `@成员名` in the header |
| Dock / thread title | 14–14.5px / 680 | panel subjects |
| Body | 13px / 400–650 | messages, nav, buttons |
| Caption / hint | 11.5px | card meta, field hints, helper text |
| Small | 12px | chips, list rows, secondary copy |
| Mono meta | 10.5px | timestamps, counts, `kbd` |
| Mono label | 9.5px / 600 | uppercase group + section labels (`letter-spacing .1em`) |
| Stat numeral | 17px / 700 mono | `--stat` metrics, `tabular-nums` |

Headings use `letter-spacing: -0.02em`; uppercase mono labels use `+0.1em`.

## 4. Spacing, Radius & Elevation

Truth lives in `tokens.css`. The base unit is **4px** with a 2px half-step.

- Spacing: `2 · 4 · 6 · 8 · 12 · 14 · 16 · 18 · 20 · 24 · 30 · 56` (`--sp-1…--sp-12`)
- Control heights: `--control-h: 32px`, `--control-h-sm: 27px`, `--tap-min: 44px`
- Radii: `--r-sm 6` (rows, chips), `--r-md 8` (buttons, inputs, cards),
  `--r-lg 12` (composer, modal, columns), `--r-xl 16` (modal), `--r-pill 99`
- Elevation: `--shadow-composer` (resting input), `--shadow-card` (card hover),
  `--shadow-pop` (popover, modal, drawers)

Layout constants: `--rail-w 252px`, `--dock-w 380px` (`340px` under 1080px),
`--stream-max 880px`, `--board-col-w 236px`.

## 5. Layout & Composition

```
┌──────────────┬─────────────────────────────────────┬──────────────────┐
│ workspace    │  channel header                     │  detail dock     │
│ rail         │  (title · tools · desc · pin · tabs)│  (agent | thread)│
│ 252px        ├─────────────────────────────────────┤  380px           │
│ ┌──────────┐ │  messages stream  (max 880px)        │  ┌────────────┐  │
│ │ brand    │ │  …                                   │  │ identity   │  │
│ │ search   │ │                                      │  │ tabs       │  │
│ │ actions  │ │                                      │  │ overview / │  │
│ │ channels │ │                                      │  │ runtime /  │  │
│ │ DMs      │ │  task board  |  search view          │  │ activity   │  │
│ │ agents   │ ├─────────────────────────────────────┤  └────────────┘  │
│ │ me       │ │  composer (messages only)            │                  │
└──────────────┴─────────────────────────────────────┴──────────────────┘
```

- **AppShell**: `display:flex; height:100dvh; overflow:hidden`.
- **Rail**: fixed 252px, `--panel`, right hairline; scrolls independently.
- **Main**: flexible, `--bg`; header (`--surface`) + view + composer stack.
- **Dock**: fixed 380px, `--surface`, left hairline; hidden by default and toggled.
- **Messages / search**: content is centered in a `--stream-max` (880px) column.
- **Board**: columns are fixed 236px and lay out horizontally with overflow scroll;
  no stretch-to-fill.

Responsive breakpoints observed:

- `≤1080px` — dock narrows to 340px.
- `≤900px` — `app` becomes a column; a sticky mobile topbar appears; the rail and the
  dock become off-canvas drawers (transform + scrim); the board collapses to a single
  full-width column stack.

## 6. Components

Full visual specimens live in `preview/`; the applied kit is `ui_kits/app/`.

- **Buttons** — `.btn` (32px, `--surface`, `--border-strong`), `.btn-primary`
  (`--accent` on white ink), `.btn-ghost`, `.btn-danger`, `.btn-sm` (27px).
- **Icon button** — `.icon-btn` 30px, transparent border, `--muted`; hover fills
  `--surface` and strengthens the border; `.is-on` uses `--accent-soft`.
- **Navigation row** — `.nav-row`: left accent bar `::before` when active, `--surface`
  fill + inset hairline, mono `#` marker turns accent.
- **Search field** — `.search-btn` (rail) and `.search-field` (search view); both
  reveal an accent ring on `:focus-within`.
- **Presence dot** — `.presence.{online|working|error|offline}`; `working` pulses
  (`pulse 1.5s`), disabled under `prefers-reduced-motion`.
- **Avatar** — `.avatar` square tiles with `.sm` / `.lg`; five tints.
- **Tabs** — underline tabs (`.tab`, `.dock-tab`) with mono count that turns accent.
- **Pin strip** — `.pin-strip`, `--panel` callout with an accent pin icon and a link.
- **Message** — `.msg` with hover fill, absolutely-positioned `.msg-tools` toolbar,
  `.msg-author.is-agent` accent, `.msg-tag` "Agent" capsule, mention + code inline,
  `.task-chip` linked work object, `.reactions` pills.
- **Composer** — `.composer-box` with accent focus ring, auto-growing textarea,
  attach / mention / as-task icon buttons, hint, `.composer-send` accent square.
- **Kanban** — `.col` (236px, `--panel`), `.card` draggable with hover lift, drag
  `.drag-over` (accent) / `.invalid-over` (error) affordances, `.drop-hint` dashed
  empty slot, `.seg` board/list segmented control, `.filter-chip`.
- **Dock panels** — `.d-sec` + `.d-sec-title` sections, `.kv` key/value rows with
  dotted leaders, `.meter` progress, `.stat-grid` 2×2 metrics, `.log-row` level tags.
- **Thread** — `.tt-summary` sticky header, `.tt-status` state pill, `.assignee`
  pill, `.tt-actions` chip rows, `.tt-log` timeline with `ok` / `warn` / `err` /
  `is-now` dots, sticky `.tt-reply` composer.
- **Overlay / Modal** — `.overlay` (scrim + blur), `.modal` (`--r-xl`, pop shadow),
  `.field` + `.input/.textarea/.select`, `.member-opt` pick pills, `.radio-card`.
- **Command palette** — `.cmd` 520px, grouped `.cmd-group` labels, `.cmd-item` rows
  with hover `--accent-soft`.
- **Toast** — `.toast` (dark `--fg` fill, online dot) and `.toast.err`.

## 7. Motion & Interaction

- Transitions are short: `background/border/color .1–.12s ease`, `transform .2s ease`
  for drawers, `opacity .12s` for the message toolbar.
- Hover never lowers contrast. Surfaces move **up** in lightness (`--surface` fill,
  `--border` → `--border-strong`) while text moves toward `--fg`. Never `--muted`.
- Focus is always explicit: `:focus-visible { outline:2px solid var(--accent);
  outline-offset:2px }`; fields and the composer use a `0 0 0 3px var(--accent-soft)`
  ring instead of an outline.
- Loading: the only spinner-free affordance in-source is the pulsing presence dot;
  skeletons are a known gap (see anti-patterns) — reuse `--panel-2` shimmer blocks.
- The dragging card drops to `opacity:.4`; drop targets signal legality by color.
- All keyframes (`pulse`, `toast-in`) and transitions honor
  `prefers-reduced-motion: reduce`.

## 8. Voice & Brand

- Wordmark is lowercase `worksplice`; the product is described by the postmark
  `LOCAL · E2EE` set in mono uppercase under the name.
- UI locale is Simplified Chinese. Copy is direct, operational, and second-person
  neutral; agent copy is first-person ("我已扫描出 37 处裸色值").
- Agents are people-adjacent: named (`Susan`, `Atlas`, `Pixel`), role-tagged
  (`秘书 · 正在干活`), and spoken *to* with `@`.
- Counts and identifiers are always explicit and mono: `#3`, `37 处`, `1.2M`,
  `session-0412.json`.
- Messages are described as permanent: "消息不可编辑、不可删除，是永久记录。"
- Buttons are verb-first: 新建频道 / 新建任务 / 创建 Agent / 添加提醒 / 推进至进行中.

## 9. Anti-patterns

Do **not**:

- Introduce hex or RGB colors, extra hues, or gradients. Everything is `oklch()`
  derived from the tokens above.
- Round avatars into circles, or make cards into pills — squares/soft rectangles only.
- Add drop shadows to resting content; shadows are reserved for layered surfaces.
- Use color without meaning: status hues encode agent/task state and nothing else.
- Put emoji or decorative illustration into functional chrome (the ☕ in one
  tea-room message is content, not UI).
- Lower text contrast on hover, or gray out labels on interaction.
- Reproduce the message hover toolbar outside a hover/focus context — it is
  chrome-light by design.
- Let the 13px body inflate: this is an operator console, not a marketing page.
- Ship a second primary CTA for one action in a viewport.
- Break the token contract: existing components depend on
  `--bg/--surface/--fg/--muted/--border/--accent` names. Renaming them re-breaks
  the entire app.
- Use `letter-spacing`-loosened body text or webfonts that cannot render CJK.

### Known gaps (honest placeholders)

The source prototype implements no skeletons/spinners for async content, no dark
theme, and no image binaries (avatars are initial tiles). No logo/icon font files
exist in the source; the brand mark and icon sprite in `assets/` and `build/` were
reconstructed as SVG from the inline vector paths found in the source HTML.
