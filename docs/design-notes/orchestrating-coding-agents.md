# Orchestrating Coding Agents: What "Just Let Them Message Each Other" Misses

## Two agents, one file

You have two coding agents in the same repository. A human owner asks agent A to
refactor the parser. Twenty seconds later, agent B — woken by an unrelated
message that happened to mention the parser — decides to do the same refactor.
Both agents are working from a checkout they believe they own, both believe they
are the only actor, and both will finish. One of them will overwrite the other's
work, or worse, the human will merge two diffs that each look correct in
isolation and neither is correct together.

"Message passing" does not solve this. You can give both agents a shared
message log, an inbox, a `reply` tool, a `send_message` tool, and you still have
the race — because the race is not about communication. It is about **absence of
a shared notion of what is true right now**. Agent A's plan is valid against
version 41 of the channel. Agent B's plan is valid against version 43. Neither
knows the other exists, and neither can tell from looking at the log whether it
missed something.

So the hard part of multi-agent orchestration is not the transport. It is a
small, unglamorous set of semantics:

- how an agent learns that it should look at something (and how much of that
  "something" is allowed into the wake signal);
- how it decides what it has already seen (a cursor, not a list);
- what happens when two writers act on the same stale belief;
- who is allowed to declare someone else's work finished.

This article walks through how [worksplice](https://github.com/whutlichao/worksplice)
answers those four, for engineers deciding which parts are load-bearing.

---

## 1. Wake carries metadata, not content

The instinct is to push the message body into the notification. "New message in
`#refactor`: <full text>" feels obvious and helpful.

worksplice refuses. The wake hint is a four-field struct in
`lib/domain/collab/wake.ts`:

```ts
export interface WakeHint {
  agentId: string;
  targetId: string;
  seq: number;
  reason: "message" | "reminder";
}
```

`notifyMessageWakes` (same file) walks the target's channel members and emits
one of these per agent. There is no body field, and the struct is deliberately
this shape. A few things fall out of that:

**Cost of the wrong wake is not symmetric with its usefulness.** Every agent
member of a channel gets woken by every ordinary message — that is the
subscription model, and it means the wake fires far more often than it is
actionable. If the hint carried the body, every one of those fires would be a
full-text push into a prompt that mostly decides to do nothing. Keeping the hint
to `{targetId, seq}` means the decision to spend tokens happens *after* the
drain, where the agent already knows whether there is anything new to read.

**It forces the pull shape.** Because the hint cannot be the content, the
consumer has to go read. That is not an accident of the type — it is the type
doing the architectural work. `sendMessage` in `lib/domain/collab/messages.ts`
emits wake hints *after* the transaction commits and *outside* it, precisely so
a rolled-back write never wakes anybody.

One more benefit: a hint is generated entirely from server-side facts — which
member is agent-typed, whether they are the author, whether they muted the
channel, which member ids a mention token resolved to. No attacker-controlled
free text reaches the code path that decides whether to start a run. If the hint
carried the body, "here is text that just arrived" and "here is an instruction
for you" would be the same object, and every future consumer of the bus would
have to re-derive that distinction.

Mute and mention are handled in `notifyMessageWakes` too: a muted member is
skipped for ordinary traffic but still woken by a personal `@mention`, and an
agent that has not joined the channel can still be woken by a mention. Wake is
attention, not command; deciding whether to respond is a separate step with its
own rubric.

---

## 2. The inbox is a cursor, and drain is a pure read

`consumed_seqs` is a table with one row per `(agent_id, target_id)` holding the
highest `seq` that agent has finished processing in that target. It is the
agent's entire memory of "what I have already dealt with".

The read/advance primitives in `lib/domain/collab/inbox.ts` separate reading
from advancing:

```ts
export function drain(agentId: string, targetId: string): DrainResult
export function ack(agentId: string, targetId: string, seq: number): void
export function drainAndAck(agentId: string, targetId: string): DrainResult
```

`drain` reads `consumed_seqs`, fetches everything after it, and **does not move
the cursor**. `ack` is a separate write. The agent loop (`runAgentRound` in
`lib/agent-loop/loop.ts`) drains at the start of a round and acks at the end.

That split is the whole point. It makes "what has this agent seen?" a property
of the database rather than of the scheduler, and it buys a property that is
easy to underrate: **draining twice returns the same messages**. It neither
duplicates nor drops. Which means a round that crashes half way through — after
the model ran, before the reply landed — is safe to simply run again: the retry
re-reads the same input.

If `drain` advanced the cursor, a crash between "read" and "write the reply"
would permanently consume the message. The agent would never see it again, and
the target would sit at a `maxSeq` that equals its cursor, so nothing would even
look pending. The only recovery would be an audit log of prompt bodies, which is
a much worse thing to have to build.

`drain` also returns `maxSeq` — the target's current version — which becomes the
`baseSeq` the agent writes against. That value is a fact read at a specific
moment, and section 3 is about what happens when the moment is stale.

Mute filtering lives inside `drain`, not in the driver, so it applies uniformly
to every consumer. Channel-level traffic is compared by `seq` against the mute's
`mute_from_seq`; thread traffic has its own `seq` space, so it falls back to
global insertion order (`rowid`) against the mute's recorded `mute_rowid`. Two
comparison axes for one policy, because "what came after the mute" is not the
same question in a channel and in a thread.

---

## 3. freshness-hold: reject the write, do not merge it

Every message carries a monotonic `seq` within its target, and messages are
immutable — there is no edit, only a correction posted as a new message. That
makes the target's version exactly `max(seq)`, with no version table needed.

When a writer submits a message, it passes the version it was written against as
`baseSeq`. Inside the transaction, `sendMessage` compares:

```ts
const roomSeq = getDb().maxSeq(target.targetId);
if (input.baseSeq !== undefined && input.baseSeq !== roomSeq) {
  return {
    held: true as const,
    roomSeq,
    whatHappened: summarizeChanges(target.targetId, input.baseSeq),
  };
}
```

The result is a tagged union, so the outcomes are hard to confuse:

```ts
export type SendMessageResult =
  | { held: false; message: MessageRow }
  | { held: true; roomSeq: number; whatHappened: string };
```

**Why not last-write-wins.** Because "last write wins" is only safe when the two
writers are interchangeable. Here they are not: the failure mode we are
preventing is an agent posting a reply that contradicts or duplicates a reply
that arrived thirty seconds earlier. Overwriting is silent. Being held is loud.

The held response also refuses to be content-free. `summarizeChanges`
(`lib/domain/collab/messages.ts`) returns a human-readable description of what
landed in the interval — the count and the `seq` range — not just a boolean. The
writer now knows it was wrong *and* why, which is the difference between a
protocol and a mutex. It is reused verbatim by task claims and status
transitions in `lib/domain/collab/tasks.ts`: a task operation writes shared state
under the same assumption, so it gets the same freshness check and the same
held shape from the same function. One fact, one code path.

### Four answers to being held

Rejecting the write pushes the decision back to the writer, which is a model. A
model handed "you were wrong" will do something arbitrary. So the reply protocol
(`parseAgentAction` in `lib/agent-loop/loop.ts`) requires the agent to declare a
policy up front, and `deliverWithFreshness` executes it:

| `onConflict` | What happens | Bounded by |
| --- | --- | --- |
| `revise` | Re-prompt with the messages that arrived during the write, parse the new answer, try again | `MAX_REVISE_RETRIES` (2) |
| `resend` | Retry the same bytes against the new `roomSeq` | `MAX_RESEND_RETRIES` (3) |
| `silent` | Drop the reply, advance the cursor, end the round | once |
| `anyway` | Resend explicitly bypassing the freshness check | once |

`revise` is the default and the interesting one: `buildRevisionPrompt` (same
file) puts `whatHappened`, the new room version, and the full text of the
messages that arrived into the next prompt, then re-enters the loop. An agent
that was about to say "the parser already handles this" can now see the message
that says it does not, and say something else.

`anyway` exists because every retry policy eventually deadlocks. If two agents
keep waking each other, `revise` can starve forever. `anyway` is the explicit
escape hatch: send without `baseSeq`, knowingly. It is recorded as its own round
status rather than folded into `replied`, because "it went through because we
bypassed the check" is exactly the kind of thing you want to count later.

Exhausting retries collapses to `silent` rather than looping. And one asymmetry is
deliberate: a revise that comes back with *no* content is an `error`, not a
`silent`. `silent` advances the cursor and terminates; an error does not, so the
held message stays pending and a later wake retries it. Calling that "abandoned"
would be a lie — `isAbandonedRound` in `lib/domain/collab/rounds.ts` encodes
exactly this distinction, so the observability badge cannot claim a round was
dropped when it is actually queued for another attempt.

---

## 4. The builder does not verify their own work

Tasks are anchored to a message and move through a state machine. The transition
table in `lib/domain/collab/tasks.ts` maps each status to the reachable statuses,
each with an authorization predicate:

```ts
const TRANSITIONS: Record<TaskStatus, Partial<Record<TaskStatus, {
  authorized: (task: TaskRow, actorId: string) => boolean;
  clearOwner?: boolean;
  reopen?: boolean;
}>>> = {
  todo: {},
  in_progress: {
    in_review: { authorized: (task, actorId) => task.owner_id === actorId },
    todo:      { authorized: (task, actorId) => task.owner_id === actorId, clearOwner: true },
    closed:    { authorized: () => true },
  },
  in_review: {
    done:        { authorized: (task, actorId) =>
                     task.owner_id !== null && reviewAuthorized(task, actorId) },
    in_progress: { authorized: (task, actorId) =>
                     task.owner_id !== null && reviewAuthorized(task, actorId) },
    closed:      { authorized: () => true },
  },
  done:   { todo: { authorized: () => true, clearOwner: true, reopen: true } },
  closed: { todo: { authorized: () => true, clearOwner: true, reopen: true } },
};
```

Two properties first.

The graph is **not** fully connected. `in_progress → done` does not exist. An
agent that finishes work cannot declare it finished; it can only move it to
`in_review`. The shortest path from "started" to "done" passes through a second
actor.

And the authorization is per-edge, not global. It is a predicate evaluated
against the task row, so "who may do this" travels with "what this is". A client
cannot skip the table, because `updateTaskStatus` consults `TRANSITIONS` inside
the transaction, and the one edge the table deliberately omits — `todo →
in_progress`, which is a claim, not a transition — is handled by `claimTask`
instead, sharing its owner-uniqueness and reopen rules with the table's own
edges through `claimBlockReason`.

Now the rule:

```ts
function reviewAuthorized(task: TaskRow, actorId: string): boolean {
  if (isTaskInDM(task)) return actorId === CURRENT_MEMBER_ID;
  return task.owner_id !== actorId || actorId === CURRENT_MEMBER_ID;
}
```

**The builder does not verify their own work.** Approving or rejecting requires
being a channel member who is *not* the task's owner. The `CURRENT_MEMBER_ID`
escape hatch exists for a specific reason: the human owner is the single
operator of most installs, and without an exemption a task the human completed
alone would sit in `in_review` forever with nobody eligible to move it. The
exemption is scoped and commented, not a general bypass.

Why is this worth building? Because an agent asked to verify its own output is
being asked the wrong question when nobody else is watching. The same model that
produced the claim will produce the confirmation; it has no independent
information to bring. The second actor is a structural substitute for that
missing independence, not a quality gate left to the model's judgement. It is
not free either: which is why the DM special case above says that in a
one-to-one channel an agent is never the reviewer. A two-party setting makes the
constraint unsatisfiable, so it degrades to "the human reviews" rather than
quietly becoming a no-op.

The same reasoning shows up in the UI. `reachableStatuses` in the same file
returns the statuses the current actor may actually move a task to, and the
board view highlights exactly those columns — the client never mirrors the
transition table, so the two cannot drift.

---

## 5. Reopening a task locks it against automation

`done → todo` and `closed → todo` are the only transitions flagged `reopen`.
They clear the owner back to the pool *and* set a `reopened` flag on the task
row. That flag does one thing:

```ts
function claimBlockReason(current: TaskRow, memberId: string): string | null {
  if (current.owner_id !== null) return "Task is already claimed";
  if (current.reopened === 1 && memberId !== CURRENT_MEMBER_ID) {
    return "Task was reopened — awaiting the owner";
  }
  return null;
}
```

A reopened task cannot be auto-claimed by an agent. The agent loop's
`runTaskOperation` treats this as a `yielded` round outcome and stands down. A
human claiming it takes over and clears the flag, at which point agents can
compete for it again.

Read this as a threat model, not a workflow preference. Reopening a task is a
statement that something about the previous completion was wrong — the automated
verification that said it was fine was wrong, or the environment moved. The
system that produced that wrong verdict is the same system now being offered the
chance to retry. The lock is the system's way of declining to grade its own
make-up exam.

That is a *flag on state*, not a workflow rule in the prompt — enforced in the
same transaction as the claim, so it cannot be talked past.

---

## 6. Deep modules: one entry, straight imports inside

`lib/domain/collab/index.ts` is the only door into the domain. Nothing outside
`lib/domain/collab` imports a submodule directly; all 40 external consumers go
through the index — 35 of them via the `@/lib/domain/collab` alias (33 route files
under `app/api`, plus `components/SearchView.tsx` and `instrumentation.ts`) and
5 under `lib/` via the relative path. The index itself is a barrel of
`export *` over 18 submodules.

Submodules import *each other* by relative path and never route back through the
index. That direction is not cosmetic: an index that its own members import
through is a cycle, and cycles make the module graph depend on evaluation order.

The same pattern appears one level up. `lib/agent-loop/index.ts` re-exports
exactly one thing, `createAgentLoop`; `runAgentRound`, `deliverWithFreshness`,
`backfillAgentReplies` and the rest are internal, and the tests import them from
`loop.ts` directly rather than through the public face. `lib/cwd-mutex.ts` is a
third example — a narrow interface centered on `withCwdMutex`, `isCwdBusy`, and
`findBusySession`, consumed by both the agent runtime and the loop driver, with
`realpathSync` normalization, the settle-event set, and legacy aliases all
living inside it.

**What this buys.** The domain becomes mockable at one seam: a test that needs
`notifyMessageWakes` to be inert mocks the whole collab domain in one place
instead of stubbing functions across many files. Route handlers cannot reach
past the domain boundary into the data layer, because the one thing deliberately
*not* re-exported from the index is `getDb()` — that lives in
`lib/data/db-singleton.ts` and must be imported explicitly, which makes a layer
violation visible at the import site instead of invisible at runtime. And when a
submodule's internals change, there is exactly one file whose exports could
break a consumer, and consumers are already pointed at it.

**What it costs.** A barrel file is a maintenance tax with no compiler help:
forget to add a line when you add a submodule and the new capability is
invisible to everyone outside. `export *` also means an import site tells you
which *domain* a function belongs to, not which module defines it, so you go to
the index to find out — one extra hop on every "where is this?" question. And
the test suite here has to be willing to reach past the public face into
`loop.ts` internals, a deliberate documented exception rather than a principle.
If you are building something small, one honest module with direct exports and
no index is less total work and loses almost nothing.

A single entry point is worth it when the domain has many consumers and needs
to be swapped in tests. It is overhead when it has two.

---

## 7. What this cost, and when not to build it

The full shape of the above is roughly 46,000 lines of non-test TypeScript
across `app/`, `components/`, `lib/`, and `hooks/`, behind 77 route files under
`app/api/`, with 465 tests. Reproduce the counts with:

```bash
find app/api -name route.ts | wc -l
find app components lib hooks -name '*.ts' -o -name '*.tsx' \
  | grep -v '\.test\.' | xargs wc -l | tail -1
npm test
```

That is a lot of machinery for what is conceptually a message log with extra
rules. A cursor, a freshness check, and a transition table are a few hundred
lines; the rest is the cost of making them survive agents that run unattended,
crash mid-write, and restart with no memory except the database:

- **Crash recovery.** `backfillAgentReplies` in `lib/agent-loop/loop.ts` scans
  each agent's session file for marker-tagged prompt rounds and re-lands replies
  the process wrote but never committed. Behind it sits
  `backfillOwnershipGate`, which refuses to backfill a file unless its header
  `cwd` matches the member's workspace, no other member references it, and its
  `mtime` is not older than the member's creation time. A per-round
  cross-author content check (`hasMessageByContentByOther`) catches the case the
  file-level gate misses. This exists because of a real bug where an agent
  inherited a deleted agent's session file and re-attributed their replies under
  its own name, silently, on restart.
- **Serialisation at the workspace.** Two sessions on one directory run one at a
  time, enforced by `lib/cwd-mutex.ts`. Real parallelism means a git worktree,
  which means a different cwd, which is naturally outside the lock.
- **Observability.** Every round that reached a conclusion lands in
  `round_logs`, with a status vocabulary wide enough to distinguish "the agent
  chose not to respond" from "the round failed and will be retried" —
  conflating those two is how you end up with a monitoring view that is
  confidently wrong. Only seven statuses are persisted; rounds that never got
  anywhere — nothing new to read, the agent skipped, the session already busy —
  are filtered out at write time.

So: **who should build this?**

Build something like it if you are running multiple unattended agents against
shared state for long enough that agents will collide, crash, and disagree — and
someone is accountable for the result. That is a multi-agent system with a human
owner, not a batch script and not a single agent with good tooling. It also
earns its keep when the agents are *durable*: they keep state between rounds, so
a bug in a cursor or a backfill path does not reset your world.

**Do not build it** if:

- You have one agent, or agents that never write to shared state. Everything in
  sections 1–5 is coordination overhead with no work to coordinate.
- Your agents run once and exit. The cursor, the ack discipline, the backfill
  path — none of it earns its keep. A fresh process can read everything.
- You cannot staff the review. Cross-review in section 4 assumes a second
  eligible actor exists. If your agents are the only participants, you have
  built a lock, not a review, and the honest thing is to not build the state
  machine either.
- You want parallelism on one checkout. These semantics are deliberately serial
  per workspace. Real parallelism is worktrees, a different mechanism entirely.
- You are optimising for a demo. This is a lot of surface to get subtly wrong,
  and `tsc --noEmit` passing tells you nothing about whether an agent will
  double-approve its own work.

If you do build it, build the four things first — cursor, freshness check, state
machine, review constraint — and leave wake hints, reminders, reactions,
attachments, and full-text search for later. The first four make collaboration
safe; everything after that is a product.

---

Repository: <https://github.com/whutlichao/worksplice> (MIT). The design
decisions behind this live in `AGENTS.md`, `CONTEXT.md`, and `docs/adr/`.