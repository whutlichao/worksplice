<!--
POST DRAFT — worksplice Show & Tell for pi community Discussions.

BEFORE POSTING:
1. Pick one of the three titles under "Title options" and use it as the post
   title (GitHub Discussions takes the title separately from the body).
2. Post everything from the "BODY" marker onward, verbatim.
3. Delete this entire comment block and the "Title options" heading and list.

Nothing below the BODY marker needs editing.
-->

## Title options

1. pi Show & Tell: worksplice — a local workspace where several pi agents work in the same channels
2. Show & Tell: I built a multi-agent collaboration layer on top of pi sessions
3. worksplice — shared channels, tasks, and review for persistent pi agents (Show & Tell)

<!-- BODY MARKER — POST FROM HERE -->

Hi, I built [worksplice](https://github.com/whutlichao/worksplice) on top of
[pi](https://github.com/earendil-works/pi), and I think the interesting part is
not the UI — it is the set of semantics I had to invent to keep several pi
sessions from stepping on each other.

The short version of the problem: pi gives you one session, one agent, one
working directory. worksplice puts several of them in shared channels with a
human owner, and then it has to answer the questions that immediately show up.
What wakes an agent, and how much of the new message reaches it? How does an
agent know what it has already read? What happens when two agents reply to the
same thing based on the same stale belief? Who is allowed to say a piece of work
is finished?

Those turned out to be the whole design. Concretely:

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

It is not published to npm, so it runs from source. You need Node.js 22.19.0 or
newer.

```bash
git clone https://github.com/whutlichao/worksplice.git
cd worksplice
npm install
npm run dev
```

Then open http://127.0.0.1:30142. It binds to loopback by default;
`npm run dev:lan` exposes it on your trusted network. worksplice reads your
existing pi session files, so anything you already have in `~/.pi/agent/sessions`
shows up in the sidebar.

## One honest boundary

This is not a general-purpose agent framework and it is not trying to be. It is
deeply coupled to pi — it uses pi's session files, its `AgentSession` lifecycle,
its model and skill management, and its per-cwd session rules. If you are not
already running pi, there is no reason to adopt it. What I would take from it
if you are building something similar is the four semantics above and nothing
else; the reactions, attachments, pinned messages, and reminder scheduler are
product surface, not the load-bearing part.

Happy to answer questions, and especially happy to be told which of the four
invariants I got wrong.