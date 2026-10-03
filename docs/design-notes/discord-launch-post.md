<!--
POST DRAFT — worksplice launch post for the pi Discord ("The Shitty Coders Club").

HOW TO POST
1. Channel: **# share-your-pi**. Confirmed against the server's channel list on
   2026-10-03: it is the community's showcase surface, and unlike the pi
   repository's Discussions (where five of six "Show & tell" posts got no reply
   at all) it is actively used. `# pi-apps` is the second choice; `# extensions`
   is for pi extensions and worksplice is not one.
2. It is a **forum channel**: posting means a title plus a first message, and
   everything after that lives in the thread. So pick a title from below — in a
   forum the title is the only thing people see while scrolling.
3. Read `# rules` and any pinned guidance in `# share-your-pi` first. This draft
   is written to avoid every obvious ad pattern (no @, no ask, no superlatives),
   but the channel's own norms win.
4. Timing: 22:00 Beijing time on D-day = 14:00 UTC = 10:00 US Eastern =
   16:00 Central Europe. No first-hand data backs this hour; it is a heuristic.
5. Both the first message and the first reply must stay under Discord's
   2000-character limit. Post "MAIN" as the forum post, then "REPLY" as its first
   reply — MAIN is written to stand on its own if nobody opens the thread.
6. Attach the 90-second screencast to the first message. Discord's default
   per-file limit is 10 MB, so export it at 720p and check the size; the same
   file also goes into the GitHub Release for permanence.
7. Do not @ anyone, and do not post anything to the pi repository — its
   CONTRIBUTING closes new contributors' issues and PRs and blocks accounts for
   tracker spam.
8. Replace every <PLACEHOLDER> before posting.
-->

# Discord launch post

## Title

Discord forums show the title and nothing else while people scroll, so keep it
descriptive and searchable. Match whatever style the channel already uses once
you look at the list.

1. **worksplice: several pi agents in one local room — channels, tasks, held writes**
2. worksplice — a local workspace for running several pi agents as a team
3. several pi agents, one checkout: what message passing does not solve

## MAIN (target: under 2000 characters)

Two coding agents, one checkout. Nothing fails loudly. Each one believes it is
the only actor, each plan is valid against the version of the repo it read, and
you end up merging two diffs that each look right alone.

pi gives you one session at a time. **worksplice** puts several of them in one
local room — and adds the three things that keep a room from going wrong: **who
has read what, who may write, who verifies.**

It is a self-hosted workspace over one SQLite file: channels, a task board with
review, reminders, and wakeups that carry no message body.

- **Wake, not push.** A wake is `{agentId, targetId, seq, reason}` and nothing
  else. The agent reads the room itself, so an irrelevant wake costs nothing.
- **A cursor, not a list.** Reads do not advance it; an ack does. A crashed
  round re-reads exactly the same input instead of losing a message.
- **Held, not merged.** Every write states which version of the room it was
  based on. If the room moved, the write is rejected with a description of what
  changed, and the agent chooses: revise, resend, go silent, or bypass. No
  last-write-wins.
- **Review before done.** A task is not finished because its author says so.
  Approving it requires someone other than the author.

90 seconds, one of those in action: <SCREENCAST ATTACHED>

```bash
npx worksplice --demo   # seeded workspace, no agents run
npx worksplice          # the real thing, on your own pi sessions
```

Design notes, including the parts I got wrong:
https://github.com/whutlichao/worksplice/blob/main/docs/design-notes/orchestrating-coding-agents.md

## REPLY (first reply in the same channel; the parts that do not fit above)

One of those four was broken and I did not know it. The held-write path hands
the draft back to the agent to revise — and in a real run the revision prompt
was rejected by the SDK every time (`Agent is already processing`), so the round
failed and retried instead of revising. It took four runs to catch, because the
unit tests inject a fake prompt function and never touch that seam. The fix
waits for the session to actually settle. Full write-up: <EVIDENCE ARTICLE URL>

On where this sits: it is not an orchestrator in the "pick a leader agent" sense,
and it is not a parallel-terminal manager either. `agent-chat` deliberately
stays a messaging layer; tools like vibe-kanban and claude-squad answer "how do
I run many agents at once"; this answers "what has to be true for several agents
to share one repo without overwriting — or rubber-stamping — each other".

One honest note on overlap: pi's roadmap includes a **pi server** that will cover
part of this. worksplice is the version that exists today — local, one SQLite
file, readable end to end — and if the official one makes it redundant, that is
a good outcome.

If you already run several pi sessions, I would like to know where this falls
over. "It did not get past `npx`" is a useful answer:
https://github.com/whutlichao/worksplice/issues/new?template=tried-it.md
