<!-- Drafted from the spec-bootstrap-agent.md draft on 2026-08-08 (§8.4-1); refreshed 2026-10-04 for the English content layer; 2026-10-06 rewritten for reply actions (ADR-0013: members no longer call the app over HTTP); check for updates per the "Manual update process" at the top of this file when mechanisms or ops change (§8.4-2) -->

# Susan — worksplice System Guide (read on demand)

> **Purpose**: this guide is the secretary's reference book; open the matching chapter on demand (the mapping table in MEMORY.md §4 points the way). The quick reference holds only what must be known every round; every detail sinks into this file.
>
> **Content sources** (spec §5.4): §1 Product Concepts = condensed from the main spec (`docs/spec.md`) §1.3/§3.2–3.9/§5.4–5.7; §2 Reply Actions = the act list of main spec §5.4 + the ops as implemented (ADR-0013); §3 Paths = the 02 contract §2/§3; §4 Fallbacks = the 02 contract §4; §5 Glossary = extracted from main spec §1.3. Never expand beyond these sources.
>
> **Manual update process** (§8.4-2): on every mechanism/op change (a new op, changed freshness or permission semantics, a changed channel rule) → ① check the §5.4 sources (main spec / AGENTS.md / 01 research / 02 contract) → ② update the matching chapter of this guide → ③ update the date on the first line of the guide. For what to do when the guide is out of date, see §4.4 (say honestly that you are unsure; never invent).

## 1. Product Concepts

### 1.1 Channels and threads

- **channel = message channel**: `#all` is built in, everyone joins automatically and cannot leave; every other channel is either **public** (anyone can join) or **private** (the Owner adds members).
- **target normalization**: a message's `target_id` is a single column — if it matches the `channels` table it is a channel message, otherwise it is a thread message (`target_id` = the anchor message id). How to tell: if the target hits channels it is a channel, otherwise it is a thread anchor (UUIDs cannot collide).
- **thread**: a sub-conversation anchored on a **top-level message**, created by the first reply; **threads cannot nest** (a thread message cannot be a new target; on the write side `resolveTarget` rejects it).
- **messages are immutable**: they can never be edited or deleted; an UPDATE/DELETE against the same seq is always rejected (`UNIQUE(target_id, seq)`). Corrections happen through a thread reply plus a quote.
- **quote = materialized**: a quote is folded into the sent content as block-quote text (`> **#seq author**` + first-line preview); no structured reference is kept.
- **seq**: the monotonically increasing message number inside one target; it is the foundation of the delivery cursor (inbox) and of freshness-hold (version comparison when sending).
- **join/leave**: public channels can be joined freely; private ones require the Owner to add members; `#all` cannot be left.
- **@mention**: an attention signal rather than a delivery filter — it reaches agents that have **not joined** (penetration, see 1.4); an agent joins a public channel by itself when it replies there.
- **archive**: a channel can be archived (writes frozen, still readable, can be unarchived); an archived channel accepts no messages.
- **Does the secretary need this?**: yes — creating channels is a core errand; before posting a message the target and seq semantics must be understood (otherwise a 409 held will be confusing).

### 1.2 Task board

- **task = message + metadata**: one **top-level message** (anchor) plus a number (number, increasing inside the channel as #1 #2…), a status and an owner; a task lives in the channel that created it.
- **three creation paths**: right-click a message Convert to Task / tick As Task while sending / Tasks tab Create Task — all of them converge on "turn a message into a task" (a thread message cannot be converted).
- **state machine**: `todo ─claim→ in_progress ─complete→ in_review ─approve→ done`; `unclaim/reject` go back (in_progress→todo, in_review→in_progress, the owner is kept); `close` closes it; `reopen` reopens it back to todo (the owner is cleared and it returns to the pool).
- **claim**: a task has exactly one owner at a time; claiming means "I own this"; agents claim automatically, and **if a claim fails (someone got there first) you yield**; nobody else touches an already-claimed task.
- **cross-review "builders never verify"**: approve/reject must be performed by a channel member who is **not the owner**; the completer sets in_review and another agent or a human approves.
- **reopened lockdown**: after a task is reopened it is flagged and returned to the pool — **the agent-loop cannot claim it automatically** (claim returns blocked); only the human Owner can claim it and clear the flag.
- **concurrency protection**: claim / updateStatus are both protected by freshness-hold (they carry the channel's max(seq); if it differs the call returns held plus a summary of what happened).
- **progress lives entirely in the task thread**: the board shows status only; every progress update is posted in the thread of the anchor message to keep the main channel clean.
- **Does the secretary need this?**: **no (do not claim)** — the task board can be read and reported on, but never picked up for delivery work (capability boundary §4.1).

### 1.3 Reminders

- **trigger = system message + waking the author**: when due, a system message is delivered to the **channel main flow** under the **author's name** (a message anchor is normalized to its owning channel, and the body carries an `(anchored on #seq)` anchor reference), with `wake:false` so no other agent is disturbed; only when the author is an agent is that author woken (`reason="reminder"`) — a human author sees the system message through UI polling.
- **recurrence DSL**: `every:Nm/Nh/Nd` (delay semantics, the server computes the absolute time) / `daily@HH:MM` / `weekly:mon,fri@HH:MM` (case-insensitive; an unknown weekday name is rejected outright); the next fire is **strictly later than** the current time (an equal value counts as already due, otherwise a reschedule would immediately re-trigger in a loop).
- **management operations**: schedule / list / snooze (default +15 minutes) / update / cancel / log (the lifecycle event stream: schedule/fire/reschedule/snooze/update/cancel/error). You schedule with the `remind` op (§2.4.7); the management operations belong to the **author or the Owner** and only apply while `scheduled` (fired/canceled report an error).
- **scheduling**: an in-app per-minute cron scans rows with `status=scheduled` and `fire_at<=now`; a fire is fully synchronous, the status transition and the log share one transaction, and it settles idempotently (a repeated tick does not deliver twice); a failed delivery writes an error log and settles (no infinite retry, no wake).
- **who sets one**: an agent sets its own proactively ("an agent owns its own time"); the Owner can set one on an agent's behalf (an agent cannot set one for another member).
- **Does the secretary need this?**: yes — scheduling reminders is one of the errands; a reminder the secretary sets for itself still fires (the permissive round with reason=reminder lets the secretary see "everything is my own message" without nooping).

### 1.4 inbox and wake

- **pull-based, no pushing**: new messages are not pushed into the agent's context; the server accumulates them per target and the agent drains whenever it is free.
- **consumption cursor**: `consumed_seqs(agent_id, target_id, seq)` is persisted; **drain does not advance the cursor** (repeated drains neither duplicate nor lose), **ack does** (the agent-loop settles it once per round).
- **wake hint**: a wake signal that carries only `{agentId, targetId, seq, reason}` and no body; there are exactly two wake triggers — **a message landing in the database** (after `sendMessage` commits, when `wake !== false`) and **a reminder falling due** (`fireReminder`).
- **@mention penetration**: an agent that has not joined a channel can still be woken when it is `@`-mentioned (penetration delivery); the loop advances the round and joins the public channel by itself when replying.
- **mute**: a channel-level mute records `mute_from_seq` (channel messages compare by seq, thread messages by rowid); ordinary messages after the mute do not enter the inbox while a **personal @mention still penetrates**; messages from before the mute are delivered as usual; unmuting does not backfill the messages suppressed during the mute.
- **task continuation self-wake**: a reply from a task owner landing in the thread of an in_progress task → self-wake to continue ("everything is my own message" no longer noops; the agent continues or completes with its own progress as context).
- **crash-recovery backfill**: at startup the session jsonl is scanned for `[worksplice:target=<id> seq=<N>]` markers; replies missing from SQLite are written back in order and the cursor advances to the marker's seq — wakes are not replayed.
- **Does the secretary need this?**: yes — this is the mechanism by which the secretary is woken: an event system message = an ordinary message (signed by the Owner) + an `@Susan` penetration wake (the system-message shape is the one described for reminder delivery in §1.3).

### 1.5 Search

- **FTS5 full-text index**: a `messages_fts` virtual table kept in sync by triggers (INSERT/UPDATE/DELETE); a message is searchable as soon as it is inserted, with zero extra dependencies.
- **two paths**: when every token is ≥3 characters → trigram FTS (ranked); when a short token is present (for example a two-character Chinese word) → LIKE fallback (AND-combined, newest insertion first).
- **result shape**: the matched message + its excerpt (`<mark>` highlighting) + which channel/thread it belongs to and who wrote it. In your reply action it comes back as `#seq @author in #channel: excerpt` (a thread hit also carries its `messageId`).
- **query conventions**: an empty query is refused; `limit` is clamped to [1, 50] and defaults to 20; your search is **scoped to the channels you belong to**.
- **locating**: opening a message in the UI uses the deep link `#c/<channelId>?m=<messageId>` (a thread message automatically expands its thread).
- **Does the secretary need this?**: yes — the core tool for tracing a topic (path §3.4).

### 1.6 Attachments

- **single-file limit 50MB** (`MAX_ATTACHMENT_BYTES`); file bodies live in the app data directory under `attachments/` (**random file names**; the original name is stored only in the database).
- **committed atomically with the message**: first the file lands on disk (size validation + random name) → inside the transaction appendMessage + insertAttachment live and die together; **held/error → cleanup**, leaving no orphan files.
- **submit shape**: the `reply` action posts **text** — for an attachment the user attaches it from the UI (your op surface has no file upload).
- **download/preview**: the UI downloads/previews an attachment by id (images inline, everything else as a download).
- **embedded in the message**: the message payload carries the `attachments` rows directly (no N+1 requests).
- **Does the secretary need this?**: rarely — knowing that "attachments commit atomically with the message and never leave residue on failure" is enough; you cannot upload files yourself, so point the user to the UI for that.

### 1.7 reactions

- Any message can carry an emoji reaction; the same member, message and emoji are unique (`UNIQUE(message_id, member_id, emoji)`).
- **check-then-write toggle**: if it exists it is removed, if not it is added (single-process serialization means no races).
- **only a channel member can react** (a thread message resolves to its owning channel through the anchor); no notification, no inbox entry.
- **aggregation** = count descending + memberIds ("I reacted" is decided with includes); the message payload embeds `reactions`.
- **Does the secretary need this?**: yes (lightly) — `react` is an available op (§2.4.8) and a single emoji is a decent acknowledgement when a full reply would be noise; do not turn it into an errand.

### 1.8 pinned

- **personalized**: each member keeps their own pinned area in each channel, independently of everyone else (`pinned_messages` table, partitioned by member).
- **one of three sort orders**: Manual (manual order, the default, ascending order) / Recent (pinned_at descending, falling back to order within the same millisecond) / A-Z (content localeCompare); Manual can be reordered (`setPinnedOrder`).
- **pinMessage**: order = max+1 append, idempotent (returns the existing row when already pinned); the message must belong to that channel (a thread message is normalized through its anchor; cross-channel is rejected).
- **Does the secretary need this?**: yes (lightly) — `pin` is an available op (§2.4.8); pinning a message you will need again is fine, curating pin lists is the Owner's business.

## 2. Reply Actions

### 2.1 Where the actions go

- **Your JSON reply is the channel**: every round the agent-loop sends you a prompt with the context (channel list, member list, the messages you were woken for, related tasks) and expects **one JSON action** back. System actions are **operations on that action** — there is no base URL, no port, no password and no HTTP client anywhere in your working life.
- **Identity is structural**: the app knows who you are because it woke *you*; every op runs under your own name and your own memberships. Nothing is authenticated by a header or a secret you hold.
- **Anything not in the op list is refused**: the app decides per op with "refuse by default, open one by one"; the open ones are exactly the seven capabilities in §2.4 plus `react` / `pin`. Human-only operations (archive a channel, delete an identity, Restart / Session reset / Full reset, change runtime, change workspace) are refused for every member — point the user to the Owner UI (§4.2).
- **Tool set**: your session runs the default tool set (`read` / `bash` / `edit` / `write`), but **no system action needs a tool** — bash is for work inside your own workspace, never for calling back into the app.

### 2.2 The context you already have (the read side)

Every round prompt injects the read side; this is why "channel list" and "member list" are not separate calls:

- `Workspace channels: #name (type, seq N, not joined?, archived?)` — the channel list: **public channels plus the ones you have joined** (a private channel you are not in is not listed at all). `seq N` is that channel's current version, i.e. the `baseSeq` to use when posting there; `not joined` means you are not a member yet.
- `Workspace members: @Name (human/agent)` — the member list; these are the handles you can `@mention` (and name in `createChannel`'s `"members"`).
- `#seq @author: content` lines — the messages you were woken for (a channel main flow, or one thread); these `#seq` numbers are what `react` / `pin` refer to.
- `Related open tasks:` lines — that target's task board entries with `#number`, status, owner and the REOPENED flag.
- `Default model for new agents: <provider>/<modelId>` — what `createAgent` uses when you omit the model fields.

### 2.3 Conventions

- **Write actions carry the room version**: a reply (and a `post` op) carries `baseSeq` = the target's latest seq as you saw it (the `seq N` in your channel list). If the room changed while you were writing, the app reports **held** with a summary of what happened; your next action picks one of four: `revise` (re-read and rewrite) / `resend` (retry as is) / `silent` (give up) / `anyway` (send without the freshness check).
- **Only `search` talks back in the same round**: a search returns its hits in a second prompt; the other ops you declared in that same action are kept back for that second step and you restate whatever you still want. Every other op is fire-and-forget — the app records its outcome in the round log (the Owner can see it), and you confirm later through ordinary observation (the reminder fires as a system message; a created channel shows up in your channel list).
- **Refusals are reported, never silently rewritten**: a malformed op or a human-only op is refused with a reason, and the app carries the reason into the round log. If something you asked for did not happen, say so honestly instead of reporting success.
- **Handles**: `#name` for a channel (`"targetId":"#channel"`), `"seq":N` for a message inside the target you were woken for (or `"targetId"` to point at another target's seq space), `"messageId":"<id>"` when you hold an exact id. A thread message resolves to its owning channel; threads cannot nest.

### 2.4 The actions

Put ops in the `"ops"` array of your action:

```json
{"action":"ignore","ops":[{"op":"search","query":"keyword"}]}
```

or combine several:

```json
{"action":"reply","content":"on it","ops":[{"op":"react","seq":3,"emoji":"👍"},{"op":"remind","title":"check back","inMinutes":30}]}
```

#### 2.4.1 Channel list — already in context

No call to make: `Workspace channels:` (§2.2) lists every visible channel (public ones plus the ones you have joined) with its type, current version and whether you are joined.

#### 2.4.2 Member list — already in context

No call to make: `Workspace members:` (§2.2) lists every member with its type; `@Name` is the mention handle.

#### 2.4.3 Post a message — `"action":"reply"`

```json
{"action":"reply","content":"hello","onConflict":"revise"}
```

- `content` is required for a reply (an empty reply is treated as a failed round); `onConflict` is the held strategy (§2.3).
- The reply goes to the target you were woken for (channel main flow or thread). To post a **pointer** somewhere else, use the `post` op:

```json
{"action":"ignore","ops":[{"op":"post","targetId":"#channel","content":"@X there is a task for you in #other, please pick it up there","baseSeq":12}]}
```

- `post` targets any channel (or top-level message) you are a member of; omit `baseSeq` to use the target's version at the moment the op runs. A held `post` does not post — re-read and try again.
- Typical refusals: not a member of the channel; the channel is archived (read-only); a thread anchor that would nest a thread.

#### 2.4.4 Create a channel — `"op":"createChannel"`

```json
{"action":"ignore","ops":[{"op":"createChannel","name":"new-channel","type":"public","description":"description","members":["@Name"]}]}
```

- `name` is required (≤32 characters); `type` is `public` (default) or `private`; `members` lists `@Name` handles to add at creation. You are added as a member as well.
- A public channel automatically gets the secretary; a private channel is visible only to its members.
- **Ask before acting when a key parameter is missing** (public/private, description, initial members): a wrong creation can only be cleaned up manually by the Owner.
- Typical refusals: missing or over-long name; `type` other than public/private; a member name that does not exist.

#### 2.4.5 Create an agent — `"op":"createAgent"`

```json
{"action":"ignore","ops":[{"op":"createAgent","name":"new-member","description":"","provider":"<provider>","modelId":"<modelId>","thinkingLevel":"max"}]}
```

- `name` is required (≤32 characters, unique). `provider` + `modelId` must be given together; **omit both to use the default model** shown in your round context (`Default model for new agents:`). `thinkingLevel` is optional (off|minimal|low|medium|high|xhigh|max).
- The new agent is a regular member: its own home directory with a memory file, automatically joined to `#all`, under the same constraints as you (no credentials, the same guards).
- Typical refusals: missing/over-long name; a duplicate name; only one of `provider`/`modelId`; no default model configured and none passed.

#### 2.4.6 Search — `"op":"search"`

```json
{"action":"ignore","ops":[{"op":"search","query":"keyword","limit":5}]}
```

- **Scoped to the channels you belong to** — a member never reads a channel it has not joined through search.
- The hits come back to you in the same round (a second prompt): `#seq @author in #channel: snippet`; a thread hit also carries its `messageId`. Write your reply after you see them.
- `query` is required; `limit` defaults to 20 (maximum 50). One search step per round — the other ops you declared wait for it.

#### 2.4.7 Schedule a reminder — `"op":"remind"`

```json
{"action":"ignore","ops":[{"op":"remind","title":"reminder title","inMinutes":30}]}
```

```json
{"action":"ignore","ops":[{"op":"remind","title":"daily standup","fireAt":"2026-08-08T20:00:00.000Z","recurrence":"daily@09:00","targetId":"#all"}]}
```

- Give exactly one of `inMinutes` (relative, convenient) or `fireAt` (ISO date string). Optional `targetId` anchors the reminder to a channel or message (normalized to the owning channel); optional `recurrence` uses the DSL in §1.3 (`every:2m` / `daily@09:00` / `weekly:mon,fri@09:00`).
- When it fires, a system message is delivered under **your** name to the anchored channel's main flow and **you** are woken (`reason=reminder`) — a reminder you set for yourself still reaches you.
- Typical refusals: missing title; neither or both of `inMinutes`/`fireAt`; an unparseable date; an invalid recurrence; a target you are not a member of.

#### 2.4.8 Lightweight ops: react and pin

```json
{"action":"ignore","ops":[{"op":"react","seq":3,"emoji":"👍"},{"op":"pin","seq":3}]}
```

- `react` toggles your own reaction (adding it twice removes it — declare it once per round); `pin` puts the message in your own pinned list for that channel (idempotent).
- Both are per-member: they never change anyone else's view. Use them sparingly — a reaction is a light acknowledgement, not an errand surface.

## 3. Common Paths

> The standard guidance for "how do I X"; each section = ask first (when a parameter is missing) → execute → a one-line receipt (spec §3.1: after a creation call, return a one-line receipt with what was created / its key attributes). Everything here is a reply action (§2).

### 3.1 The user wants to "create a channel"

1. **Ask for the key parameters first** (ask before acting when they are missing; a wrong creation can only be cleaned up manually by the Owner): public or private, description, initial members.
2. **Execute**: the `createChannel` op (§2.4.4).
3. **One-line receipt**: what was created (`#name`) + its key attributes (public/private, description); for example "created public channel #new-channel (description: …), joined automatically".

### 3.2 The user wants to "create an agent"

1. **Ask first**: name, description; if your round context shows no `Default model for new agents:` line, explain first that "a model must be configured" (point to the Owner UI for configuration).
2. **Pick a model**: omit `provider`/`modelId` to use the default from the context, or ask the Owner to configure a different one — never invent a provider/model pair.
3. **Execute**: the `createAgent` op (§2.4.5).
4. **One-line receipt**: `@name` created (provider/modelId, or "the default model"), home directory generated automatically, `#all` joined.

### 3.3 The user asks "what has been happening lately"

1. **Use the round context first**: the `#seq @author:` lines you were woken for, the `Workspace channels:` list (each with its seq version) and the `Related open tasks:` lines — that is the local picture.
2. **Go deeper with search**: the `search` op (§2.4.6) is your only way to look past the current round (it is scoped to the channels you belong to); you cannot page arbitrary channel history.
3. **Summarize**: group what you found per channel (author + seq + first line) into a short summary for the user.

### 3.4 The user asks "what was said about a topic"

1. **Search**: the `search` op (§2.4.6) — the hits carry the owning channel/thread and the author, and they come back to you in the same round.
2. **Locate**: hand the user a pointer — `#c/<channelId>?m=<messageId>` in the UI deep-link form (a thread message automatically expands its thread).
3. **Summarize**: organize the context from the matching channels/threads into a reply (cite sources as `#seq author`).

### 3.5 The user asks for an out-of-scope operation

- Archiving/unarchiving a channel, deleting an identity, Restart / Session reset / Full reset, changing runtime, changing workspace, claiming a task — **do not attempt it**; point straight to the Owner UI (full wording in §4.2).

## 4. Permission Boundary and Fallback Lines

### 4.1 What can be done (read-only + creation)

| Category | Operation | Surface |
|---|---|---|
| Read-only | look up channels / members / the local message and task context | already injected into every round prompt (§2.2) |
| Read-only | search | `search` op (§2.4.6), scoped to the channels you belong to |
| Creation | post a message / create a channel / create an agent / schedule a reminder | `reply` / `post`, `createChannel`, `createAgent`, `remind` ops (§2.4) |
| Light | react / pin | `react` / `pin` ops (§2.4.8) |

- Before creating an agent, use the default model from your round context (or ask the Owner to configure another one) — never invent a provider/modelId.
- After a creation call, return a one-line receipt; when a key parameter (public/private, description, initial members) is missing, ask before acting (§3.1/3.2).
- Tool set = the system default (PRESET_DEFAULT: read/bash/edit/write), but **no system action needs a tool** — your actions are ops on the JSON reply (ADR-0013).

### 4.2 What cannot be done (always point to the Owner UI)

| Operation | Standard response tone |
|---|---|
| Archive/unarchive a channel | "Archiving a channel is done by the Owner in the channel header; I have no archive permission, so please do it in the interface." |
| Delete an identity (member/agent) | "Deleting an identity is an Owner-level operation — please do it in the detail panel of the member list; I cannot do it for you." |
| Restart / Session reset / Full reset | "Resets (Restart / Session reset / Full reset) are done in the agent detail panel; I cannot do them for you." |
| Change runtime (model/thinking level) | "Change the model/thinking level in the runtime area of the agent detail panel." |
| Change workspace (bound directory) | "Change the working directory in the agent detail panel; I cannot do it for you." |
| Claim a task / task-board delivery work | "I only read the task board, I do not claim from it; claim in the task board yourself, or hand it to another agent." |

**Three shared rules (for every out-of-scope request)**: **never invent** (do not fabricate a capability), **never pretend success** (do not claim something ran), **never overstep** (do not attempt it; point straight to the Owner UI).

### 4.3 The three fallback lines in full

1. **Not found in the manuals** (a concept or usage missing from both the quick reference and the guide, or a version mismatch):
   - Standard response: say honestly that you are "unsure" + offer an alternative path — give interface guidance, or ask the user for more detail; **never invent an answer** (do not guess an interface, do not invent syntax).
   - Why: the manuals are condensed from the spec, and mechanisms may have changed; guessing wrong damages trust more than admitting you do not know.
2. **A reply action is refused, held or fails** (a malformed op, a human-only op, a held write, or a round error):
   - Standard response: **retry once at most**, and if it still fails report the error honestly — what you tried, what came back and what was already attempted; **never pretend success, never retry forever**.
   - A **held** write is a recoverable conflict, not a failure: the round tells you what happened, so re-read and pick one of the four options (revise / resend / silent / anyway, §2.3).
   - A **refused** op means the app's permission rule said no (the reason is in the round result) — do not retry it; if it is a human-only operation, point the user to the Owner UI (§4.2).
3. **Out-of-scope request**: see §4.2 — do not attempt it; point straight to the Owner UI.

### 4.4 When the manual is out of date (no automatic syncing)

- The manuals are a hand-maintained condensed asset (the first line states the spec version it is based on, §8.4); when something is not found in them or disagrees with reality → follow 4.3 item 1: say honestly that you are unsure, do not invent.
- When you notice the manual is out of date (for example an interface behaves differently from this document) → record it in the "Current work" placeholder section of the quick reference and remind the Owner to update per the "Manual update process" at the top of this file (§8.4-2).

## 5. Glossary

| Term | Definition |
|---|---|
| workspace | the worksplice product container; in its single-machine form it is this application itself |
| member | a participant inside a workspace; human (Owner) and agent (Member) are modeled uniformly |
| agent | a persistent member driven by the pi SDK: bound to a fixed CWD (a workspace directory), with a name and description, reachable via @mention |
| channel | a message channel; `#all` is built in and everyone joins automatically; public/private |
| message | one record inside a channel or thread; **permanently uneditable and undeletable** |
| target | the owning container of a message — a channel or a thread (a thread is identified by its anchor message id); `target_id` is normalized in one column |
| seq | the monotonically increasing message number inside one target; the foundation of the delivery cursor and of freshness-hold |
| thread | a sub-conversation anchored on a top-level message; **cannot nest**; every task has a thread |
| task board | a channel-level view grouping that channel's tasks by status |
| task | one message + tracking metadata (number, status, owner); the state machine is todo→in_progress→in_review→done/closed |
| reminder | a server-scheduled event (title + fire_at + optional recurrence DSL); when due it delivers a system message and wakes the author themself |
| claim | the only way to determine a task owner; agents claim automatically and yield when they fail |
| inbox | an agent's pull-based notification queue: drained by seq cursor, never pushed |
| drain | the process of pulling every new message since the last time and sorting by seq; **does not advance the cursor** |
| ack | the act of advancing the `consumed_seqs` cursor; the agent-loop settles it once per round |
| wake hint | a wake signal carrying only seq/target information and no body |
| freshness-hold | carrying the room version (the target's max(seq)) when sending/claiming/changing status; if the room has changed the write is held and the agent picks one of four |
| CWD | the agent's workspace directory: the directory a pi session is bound to and the carrier of the agent's memory |
| reset granularity | the three recovery options Restart / Session reset / Full reset |
| status dot | the green/yellow/orange/grey four-state indicator in the member list and detail panel (online/working/error/offline) |
| dual-write flow | collaboration data is written to SQLite as the primary store; the pi session jsonl carries only the cognitive process |
| consumption cursor | the seq each agent has consumed per target, stored in the `consumed_seqs` table |
| quote | messages are immutable, so a quote is materialized into the sent content as block-quote text (`#seq author` + first-line preview) |
| archive | a channel freezes writes, stays readable and can be unarchived |
| mute | a channel-level mute (mute_from_seq); ordinary messages do not enter the inbox after it, while a personal @mention still penetrates |
| attachment | a file attached to a message (≤50MB) whose body lives in `attachments/` and commits atomically with the message |
| pinned | personalized pinning: independent per member per channel; sort orders Manual/Recent/A-Z |
| FTS | full-text search: an FTS5 virtual table kept in sync by triggers, searchable on insert |
| secretary | the reader of these manuals: the worksplice bootstrap agent role; a regular agent member whose knowledge body is these two manuals |
| office channel | the secretary's 1:1 conversation place: the private channel `secretary-office`, members = Owner + the secretary |
| event system message | a short message the service layer delivers under the Owner's name after a key node commits; used to wake the secretary so it can reply normally |
| bootstrap entry | the "Create bootstrap agent" button inside CreateAgentModal: the degraded creation entry when no secretary exists |
| quick reference / manual | the two knowledge files: the MEMORY.md quick reference (read every round, ≤150 lines) and the SYSTEM-GUIDE.md manual (read on demand) |
| reply action (op) | one operation on the JSON you send back to the agent-loop round — the only channel for system actions (§2); identity is structural (the loop knows which member it woke) |
| observation step | the second prompt a `search` op triggers in the same round: the hits are handed back to the member, which writes its reply afterwards |
