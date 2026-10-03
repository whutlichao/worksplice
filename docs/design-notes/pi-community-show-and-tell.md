<!--
POST DRAFT — worksplice technical archive post for pi community Discussions.

WHAT THIS IS FOR: a public, searchable record of the design, so the launch post
on Discord has somewhere durable to point at. It is deliberately NOT a pitch:
no "please try it", no "feedback welcome", no @mentions, no star request.
Expect it to get few or no replies — the six existing "Show & tell" posts in
this repository average under one comment, so treat reach as a bonus.

BEFORE POSTING:
1. Pick one of the titles under "Title options" and use it as the post title
   (GitHub Discussions takes the title separately from the body).
2. Post everything from the "BODY" marker onward, verbatim.
3. Delete this entire comment block and the "Title options" heading and list.
4. Do not open an issue or PR in this repository — CONTRIBUTING.md closes them
   by default and blocks accounts for tracker spam.
-->

## Title options

1. **Show & tell: worksplice — channels, freshness holds, and review for several
   pi agents** ← recommended: keeps the community's title convention while
   staying descriptive and searchable
2. worksplice: what several pi agents in one room need that message passing does
   not give them
3. worksplice — a local workspace for collaborating with persistent pi agents

<!-- BODY MARKER — POST FROM HERE -->

[worksplice](https://github.com/whutlichao/worksplice) is a local workspace that
puts several pi sessions into shared channels with a human owner. The
interesting part is not the UI — it is the set of semantics that keeps those
sessions from stepping on each other, and those turned out to be the whole
design.

The problem it starts from: pi gives you one session, one agent, one working
directory. Point a second agent at the same checkout and nothing fails loudly.
So the questions show up immediately. What wakes an agent, and how much of the
new message reaches it? How does an agent know what it has already read? What
happens when two agents reply to the same thing based on the same stale belief?
Who is allowed to say a piece of work is finished?

Four answers, all in the local server rather than in a UI:

- **Wake hints carry no body text.** A wake is `{agentId, targetId, seq,
  reason}` and nothing else. The agent drains its own inbox by cursor. Keeping
  the message out of the wake signal means an unactionable wake costs almost
  nothing, and nothing attacker-controlled reaches the code path that decides
  whether to start a run.
- **The inbox is a cursor, not a queue.** Reads do not advance it; a separate
  ack does, at the end of a round. So re-running a crashed round re-reads
  exactly the same input, and the retry is safe instead of silently dropping a
  message.
- **Writes are held, not merged.** Every message carries the target's `seq`
  version from when it was written. If the room moved, the write is rejected
  with a description of what changed, and the agent picks a policy: revise,
  resend, go silent, or explicitly bypass. No last-write-wins.
- **The builder does not verify their own work.** Tasks move through a real
  state machine, and only a member who is not the task's owner can approve it.
  Reopening a task locks it against auto-claim until a human takes it over.

I wrote up the reasoning, including the parts I got wrong, here:
[design notes on orchestrating coding
agents](https://github.com/whutlichao/worksplice/blob/main/docs/design-notes/orchestrating-coding-agents.md).

## Running it

Published to npm, and it needs Node.js 22.19.0 or newer:

```bash
npx worksplice --demo   # a seeded workspace, no agents run, nothing to configure
npx worksplice          # the real thing, on your own pi sessions and models
```

Then open http://127.0.0.1:30142. It binds to loopback by default, and it reads
your existing pi session files, so anything already in `~/.pi/agent/sessions`
shows up in the sidebar.

## Two honest boundaries

This is not a general-purpose agent framework and it is not trying to be. It is
deeply coupled to pi — it uses pi's session files, its `AgentSession` lifecycle,
its model and skill management, and its per-cwd session rules. What is worth
taking from it if you are building something similar is the four semantics
above; reactions, attachments, pinned messages, and the reminder scheduler are
product surface, not the load-bearing part.

The second boundary is upstream: pi's roadmap includes a **pi server** that will
cover part of what worksplice does. This is the version that exists today —
local, one SQLite file, readable end to end — and if the official one makes it
redundant, that is a good outcome.
