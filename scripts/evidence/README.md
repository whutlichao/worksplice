# Evidence scripts

Three runnable checks behind
[When a held write could not be revised](../../docs/design-notes/when-a-held-write-could-not-be-revised.md).

They need a worksplice server that **you started yourself** — they drive it over
HTTP rather than importing the app. Start one on port 3105 first:

```bash
npm run build
node bin/worksplice.js --port 3105 --no-open
```

## A · The protocol, with no model in the loop

```bash
BASE=http://127.0.0.1:3105 OUT=/tmp/evidence bash scripts/evidence/part-a-mechanism.sh
```

Proves the freshness hold end to end: a write based on an old room version is
rejected with `409 {held, roomSeq, whatHappened}`, the room is left untouched,
and the same content against the current version lands normally. Deterministic,
free, no model involved.

## C · The review rule, with no model in the loop

```bash
WORKSPLICE_DATA_DIR=/tmp/evidence-review node scripts/evidence/part-c-review.mjs
```

Proves that the builder cannot approve their own work: the task owner is refused
(`The builder cannot verify their own work`) and a second member's approval moves
it to `done`. Runs against its own data directory, starts no server, and wakes
nobody.

## B · The real run: a real agent, a real hold

```bash
BASE=http://127.0.0.1:3105 \
OUT=/tmp/evidence \
PROJECT=/tmp/evidence-project \
WORKSPLICE_DATA_DIR=<the server's data dir> \
PI_CODING_AGENT_DIR=<the server's pi agent dir> \
MUTE=1 \
bash scripts/evidence/part-b-real-run.sh
```

This one needs a model (any model; a free one is fine) and a project directory
that the agent can work in. Two preconditions matter, and both were found the
hard way:

1. **Interject only after the agent has really drained.** The script watches the
   agent's session file for `[worksplice:target=<channel> seq=N]`; that marker is
   the drain, and `N` is the room version the agent read. Interject earlier and
   both messages are read by the same round, so nothing is ever held.
2. **Stop the interjection from waking the agent into a competing round.** With
   `MUTE=1` the script mutes the agent on that channel first — muting blocks the
   wake but not the hold, and the revision prompt still sees the new messages.

A successful run leaves `[worksplice:revision]` in the agent's session file and
`status=replied` in `round_logs` for that round. Free models are not perfectly
reliable here: they sometimes emit a task operation instead of a reply (the round
then yields) or choose the `anyway` escape hatch, so expect to retry.

## Notes

- These scripts write to throwaway paths (`/tmp/...`) and to the data directory
  you hand them. `part-c` refuses to run without `WORKSPLICE_DATA_DIR`.
- `part-b` prints the room, the round log, and copies the agent's session file
  into `OUT` as evidence. That session file embeds environment detail (including
  absolute paths from the machine that produced it) — redact it before
  publishing.
