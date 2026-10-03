<!--
SUBMISSION DRAFTS — the two Awesome lists that are reachable today.

WHEN: D-3 (2026-10-13), silently. Neither submission asks for anything from the
maintainer beyond a listing, and neither should mention the launch.

RULES
1. Do not open issues or PRs in earendil-works/pi — that repository closes new
   contributors' issues and PRs by default and blocks accounts for tracker spam.
2. Fill in <PLACEHOLDERS> at submission time; screenshots and the screencast only
   exist after the recording session.
3. Keep the tone factual. Both lists reject marketing language.
-->

# Awesome list submissions

Two lists are reachable now. They are not equal: the first is a lightweight issue
form with no star threshold; the second is a vendor directory with a heavy entry
format, and **every entry in it carries the maintainer's own product pitch**
(an `agentAnalytics` block with a CTA to agentanalytics.sh). Read §B before
deciding whether to submit there at all.

## A · slavakurilyak/awesome-ai-agents

**Why it qualifies**: public repository, a substantive non-automated commit
within the last six months (179 commits in the last 30 days), no license or star
requirement. Submission is an issue form — the preferred path for project
founders, and it needs no Go toolchain:

<https://github.com/slavakurilyak/awesome-ai-agents/issues/new?template=project-submission.yml>

**Paste-ready field values:**

| Field | Value |
| --- | --- |
| Project name | `worksplice` |
| What does it do? | `A local, self-hosted workspace that puts several persistent pi coding agents into shared channels over one SQLite file. Its useful behavior is the coordination semantics: a wake hint tells an agent that something moved without carrying the message body, an inbox is a cursor rather than a queue, a write based on a stale version of the room is held and handed back to its author instead of being merged, and a task can only be approved by a member other than its author. It helps developers who already run more than one coding-agent session against the same repository.` |
| Public source repository | `https://github.com/whutlichao/worksplice` |
| Recent substantive commit | `https://github.com/whutlichao/worksplice/commit/6790aad2733dd3cf9f9129cef1957b29fd73b7b9` — the held-write fix, with two regression tests. **Replace with the newest substantive commit at submission time** (do not cite a docs-only or version-bump commit). |
| Evidence and how to try it | Seeded demo with no agents and no configuration — run `npx worksplice --demo`. Plus the design notes (`https://github.com/whutlichao/worksplice/blob/main/docs/design-notes/orchestrating-coding-agents.md`), a failure report with three runnable reproduction scripts (`.../when-a-held-write-could-not-be-revised.md`), and a 90-second screencast: `<SCREENCAST URL>` |
| Suggested category | `Multi-Agent Orchestration` (the list already uses it) |
| Founder submission | yes |
| Current project maintainer | `whutlichao` |
| Public evidence for current maintainers | `The repository's commit history and README are the public evidence; there is no MAINTAINERS file.` |

## B · Agent-Analytics/awesome-multi-agent-orchestrators

**Read this first.** Their data model gives every entry an `agentAnalytics`
block — a written pitch for the maintainer's own product, with a CTA link
(`ctaHref`) — and an entry also needs a logo file under `public/logos/` plus a
screenshots array. So submitting means shipping assets into someone else's
repository *and* having our entry co-promote their analytics product. The list
has ~149 stars. Recommendation: **open an issue offering the entry and let the
maintainer slot it themselves** (they can fill their own analytics block), rather
than opening a PR that carries their marketing copy in our name. Skip it outright
if that trade does not appeal — the reach is small next to the effort.

If you do submit a PR, this is the entry to propose in
`src/data/orchestrators.ts` (`accent` picked from their existing union; `rank`
is theirs to choose):

```ts
{
  slug: "worksplice",
  rank: 0, // maintainer decides
  title: "worksplice",
  githubRepo: "whutlichao/worksplice",
  accent: "mint",
  mark: { kind: "image", src: "/logos/worksplice.png", label: "worksplice logo" },
  summary:
    "A local, self-hosted workspace where several persistent pi coding agents share channels, claim and review tasks, and coordinate through held writes instead of last-write-wins.",
  note:
    "Centers orchestration on shared-room semantics: wake hints without message bodies, an inbox that is a cursor, writes held on a stale room version, and review by someone other than the author.",
  overview: [
    "worksplice puts several pi sessions into shared channels with a human owner, over one local SQLite file, and serves a browser workspace on loopback.",
    "It belongs in Open Orchestrators because it treats agent coordination as a room with rules rather than as message passing: a wake tells an agent that something moved without carrying the body, reads are tracked by a durable cursor, a write based on a stale version of the room is rejected with a description of what changed, and a task cannot be approved by the member who did it."
  ],
  bestFor: [
    "Several coding agents sharing one repository",
    "Task handoff with review",
    "Local, self-hosted agent workspaces"
  ],
  tags: ["coding agents", "channels", "task review", "local workspace", "concurrency"],
  links: [
    { label: "GitHub", href: "https://github.com/whutlichao/worksplice", emphasis: "primary" },
    {
      label: "Design notes",
      href: "https://github.com/whutlichao/worksplice/blob/main/docs/design-notes/orchestrating-coding-agents.md"
    },
    {
      label: "Failure report",
      href: "https://github.com/whutlichao/worksplice/blob/main/docs/design-notes/when-a-held-write-could-not-be-revised.md"
    }
  ],
  screenshots: workspliceScreenshots, // needs an assets pass; see below
  agentAnalytics: /* the maintainer's own block; let them fill it */
}
```

**Assets a PR would need**: `public/logos/worksplice.png`, a
`workspliceScreenshots` const, and the screenshot files it points at. The four
existing shots in `docs/screenshots/` (channel, task board, agent panel, search)
are the natural set — but they should be re-taken after `--demo` exists, so they
match what a reader sees. That puts this submission **after the recording
session** (D-4), not at D-3.

## Not submitted

`kaushikb11/awesome-llm-agents` has a **25-star minimum**, which worksplice does
not meet yet. Revisit at the D+14 milestone (launch checklist M1). Its
"Multi-Agent Orchestration" and "CLI Agent Harnesses" sections are a good fit once
the threshold is met, and its CI validates the entry mechanically.
