# A held write that never got revised

The interesting part of multi-agent orchestration is not the transport. It is the
small set of semantics that decide what happens when two agents act on the same
stale belief. We built four of them for worksplice, wrote tests for all four, and
then found out that one of them did not work at all in a real run — in the one
place the tests could not see.

This is the story of that seam, including the exact payloads.

*(The design reasoning behind the four semantics is in
[Orchestrating Coding Agents](./orchestrating-coding-agents.md). This piece is
about what broke when we ran them for real.)*

## Two agents, one checkout

The scenario is mundane. Two coding agents work the same repository. A human
owner asks one to refactor the parser. Twenty seconds later the other — woken by
an unrelated message that happened to mention the parser — decides to do the same
refactor. Both finish. Neither is lying about what it saw.

Message passing does not fix this, because the race is not about communication.
It is about the absence of a shared notion of what is true right now: one plan is
valid against version 41 of the room, the other against version 43, and neither
agent can tell from the log whether it missed something.

## The semantics we chose

worksplice puts several pi sessions into shared channels. Four rules carry the
weight:

- a wake hint carries no message body, only a pointer (`{agentId, targetId, seq,
  reason}`);
- an inbox is a cursor, not a queue: reads do not advance it, an ack does;
- **a write states which version of the room it was based on; if the room moved,
  the write is held rather than merged**; the author then chooses a policy —
  revise, resend, stay silent, or explicitly bypass;
- a task is not done because its author says so; approving it requires somebody
  else.

The third rule is the one that answers the two-agents-one-file problem. It is
also the one that broke.

## The protocol held up

We proved the rule in isolation first, with no model in the loop at all. Send two
messages, then send a third that claims to be based on the first version:

```
HTTP 409
{
  "held": true,
  "roomSeq": 3,
  "whatHappened": "1 new message(s) arrived in this target (seq 3)"
}
```

The room is untouched — the second message is still there and the stale write is
not. Resending the same content against `baseSeq: 3` lands normally (`HTTP 201`).

That is the whole idea, and it works exactly as designed. It is also the reason
the bug below survived so long: the mechanism was real, so every test that
exercised the mechanism passed.

## Then we ran it for real

The real run needs a genuine agent, a real wake, and a human interjection timed
into the window where the agent is thinking. The recipe that finally worked:

1. wake an agent with a question it has to read a file to answer;
2. watch its session file until the round marker appears
   (`[worksplice:target=<channel> seq=N]`) — that marker *is* the drain, and it
   tells you which version of the room the agent read;
3. at that instant, post a second message from the owner, moving the room to
   `N+1`;
4. wait.

The hold fired, as designed. `round_logs` for that round:

```
status=error  reason="revised reply had no content"  base_seq=3
```

Not `replied`. Not `silent`. An error, on the path whose entire purpose is to
hand the draft back to the agent so it can rewrite it. Four independent runs
produced the same line.

The loop was swallowing the reason, so we temporarily logged the underlying
error from `promptSession`. There it was, from pi's own SDK:

```
[probe] prompt failed: Agent is already processing. Specify streamingBehavior
('steer' or 'followUp') to queue the message.
| head: "Your reply to channel hold-run-004148 was held bec..."
```

The revision prompt was being sent immediately after `prompt_done` — and
`prompt_done` only means *this prompt call returned*. The agent was still
settling, so the SDK rejected the next prompt outright. The empty text that came
back was classified as a failed round.

## Why no test caught it

Every test of the revise path injects a fake prompt function:

```ts
promptFn: async (revisionPrompt) => { ... }
```

That fake is the right shape for testing the *policy* — which of the four
branches gets taken, how retries are capped, what happens when the model answers
`ignore` — and it is exactly why the seam was invisible. The bug lived between
the loop and the wrapper: the loop's notion of "this round's prompt is finished"
against the SDK's notion of "this agent is idle". Fakes agree with whatever the
test author believed about that boundary.

This is the general lesson, and it is not specific to worksplice: **your
invariants die at the seam where your own code meets a runtime's lifecycle
vocabulary**. A unit test with an injected collaborator cannot see that seam,
because the test author's belief about the collaborator is the thing being
tested.

## What the system did right while it was broken

Worth stating plainly, because it is the difference between a bug and data loss:

- the message was not lost. The cursor did not advance, the trigger stayed
  pending, and the next wake retried it;
- the status point reported `error` instead of pretending success;
- the other three policies worked: the escape hatch (`anyway`) really did send,
  `silent` really did stay silent, and yielding on an unclaimable task really did
  yield.

So the failure was honest and recoverable. It was also fatal to the feature's
purpose: the agent never revised anything.

## The fix, and what it changed

`promptSession` now waits for the session to actually report idle before sending,
with a bounded timeout — and if the timeout expires it sends anyway, so the SDK's
real error surfaces instead of being swallowed. Two regression tests pin the
seam: a fake session that rejects prompts while "still processing" and emits
`prompt_error`, exactly as the wrapper does. The tests fail without the fix, and
the fix is four lines plus the wait.

Re-running the same scripted scene produced the artifact we were originally
after. From the agent's session file — this is the revision prompt, verbatim:

```
Your reply to channel hold-run-085200 was held because the room changed while you were writing.
What happened: 2 new message(s) arrived in this target (seq 4–5)
The room is now at seq 5.

Messages that arrived while you were writing:
#4 @Owner: 等一下——按逗号切分在引号里的逗号上会出错。先说方案，别直接改。
#5 @Owner: 等一下——按逗号切分在引号里的逗号上会出错。先说方案，别直接改。

Your held draft was:
---
已读完 parser.js 和 README.md。
...
[worksplice:revision]
```

The agent's next message acknowledged the interjection and rewrote the plan. The
held draft never reached the room; nobody's message was overwritten. The round
closed as `replied`, `base_seq=5`.

## Two things to take away

**Test the seam, not the belief.** If a rule depends on what a runtime means by
"done", "idle", or "settled", a fake will not tell you that you are wrong. Make
the fake refuse what the real thing refuses — in this case, make it reject a
second prompt while it is still processing — and the seam becomes visible.

**A concurrency rule that only works in the happy path is worse than no rule**,
because you will build a story on top of it. Ours said "the author chooses what
to do instead of silently overwriting", and for a while the only thing the author
could actually choose was failure.

## Reproducing it

Three scripts, all runnable against a local worksplice on `127.0.0.1:3105`:

- `scripts/evidence/part-a-mechanism.sh` — the protocol proof above. No model, no
  cost, deterministic.
- `scripts/evidence/part-c-review.mjs` — the review rule ("The builder cannot
  verify their own work"). No model, no cost, deterministic.
- `scripts/evidence/part-b-real-run.sh` — the real run, with the drain-marker
  timing. Needs a model (any model, including a free one) and the two
  preconditions documented in the script: the agent must have drained before you
  interject, and the interjection must not wake it into a competing round.

`scripts/evidence/README.md` has the exact commands.
