<!-- Drafted from the spec-bootstrap-agent.md draft on 2026-08-08 (§8.4-1); refreshed 2026-10-04 for the English content layer; check for updates per the "Manual update process" at the top of this file when mechanisms or APIs change (§8.4-2) -->

# Susan — worksplice System Guide (read on demand)

> **Purpose**: this guide is the secretary's reference book; open the matching chapter on demand (the mapping table in MEMORY.md §4 points the way). The quick reference holds only what must be known every round; every detail sinks into this file.
>
> **Content sources** (spec §5.4): §1 Product Concepts = condensed from the main spec (`docs/spec.md`) §1.3/§3.2–3.9/§5.4–5.7; §2 API = AGENTS.md File Map + main spec §5.7 + the real route signatures; §3 Paths = the 02 contract §2/§3; §4 Fallbacks = the 02 contract §4; §5 Glossary = extracted from main spec §1.3. Never expand beyond these sources.
>
> **Manual update process** (§8.4-2): on every mechanism/API change (new route, base URL change, changed mechanism semantics) → ① check the §5.4 sources (main spec / AGENTS.md / 01 research / 02 contract) → ② update the matching chapter of this guide → ③ update the date on the first line of the guide. For what to do when the guide is out of date, see §4.4 (say honestly that you are unsure; never invent).

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
- **management operations**: schedule / list / snooze (default +15 minutes) / update / cancel / log (the lifecycle event stream: schedule/fire/reschedule/snooze/update/cancel/error). snooze/update/cancel may only be performed by the **author or the Owner**, and only while `scheduled` (fired/canceled report an error).
- **scheduling**: an in-app per-minute cron scans rows with `status=scheduled` and `fire_at<=now`; a fire is fully synchronous, the status transition and the log share one transaction, and it settles idempotently (a repeated tick does not deliver twice); a failed delivery writes an error log and settles (no infinite retry, no wake).
- **who sets one**: an agent sets its own proactively ("an agent owns its own time"); a human can also have an agent set one; the Owner can set one on an agent's behalf (authorId).
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
- **result shape**: `{id, target_id, seq, author_id, created_at, snippet}` plus belonging (channel/thread) and the author; `snippet` = the matched context excerpt (`<mark>` highlighting).
- **query conventions**: an empty query returns 400; `limit` is clamped to [1, 50] and defaults to 20.
- **locating**: opening a message in the UI uses the deep link `#c/<channelId>?m=<messageId>` (a thread message automatically expands its thread).
- **Does the secretary need this?**: yes — the core tool for tracing a topic (path §3.4).

### 1.6 Attachments

- **single-file limit 50MB** (`MAX_ATTACHMENT_BYTES`); file bodies live in the app data directory under `attachments/` (**random file names**; the original name is stored only in the database).
- **committed atomically with the message**: first the file lands on disk (size validation + random name) → inside the transaction appendMessage + insertAttachment live and die together; **held/error → cleanup**, leaving no orphan files.
- **submit shape**: `POST /api/messages` has two forms — JSON (as is) or multipart (fields + `files[]`, the service layer validating each file at ≤50MB).
- **download/preview**: `GET /api/attachments/[id]` (images preview inline, everything else is an `attachment` download).
- **embedded in the message**: the message payload carries the `attachments` rows directly (no N+1 requests).
- **Does the secretary need this?**: rarely — the secretary's creation interfaces include the multipart form of sending a message; knowing that "attachments commit atomically with the message and never leave residue on failure" is enough.

### 1.7 reactions

- Any message can carry an emoji reaction; the same member, message and emoji are unique (`UNIQUE(message_id, member_id, emoji)`).
- **check-then-write toggle**: if it exists it is removed, if not it is added (single-process serialization means no races).
- **only a channel member can react** (a thread message resolves to its owning channel through the anchor); no notification, no inbox entry.
- **aggregation** = count descending + memberIds ("I reacted" is decided with includes); the message payload embeds `reactions`.
- **Does the secretary need this?**: no — reactions are outside the secretary's capability surface (a UI interaction feature, not part of the secretary API list §4.1).

### 1.8 pinned

- **personalized**: each member keeps their own pinned area in each channel, independently of everyone else (`pinned_messages` table, partitioned by member).
- **one of three sort orders**: Manual (manual order, the default, ascending order) / Recent (pinned_at descending, falling back to order within the same millisecond) / A-Z (content localeCompare); Manual can be reordered (`setPinnedOrder`).
- **pinMessage**: order = max+1 append, idempotent (returns the existing row when already pinned); the message must belong to that channel (a thread message is normalized through its anchor; cross-channel is rejected).
- **Does the secretary need this?**: no — a personalized UI feature, not part of the secretary API list (§4.1).

## 2. System API Usage

### 2.1 Where the address comes from

- **default base URL = `http://127.0.0.1:30141`**, hard-coded consistently in four places (the four `-p 30141` package.json scripts, the `bin/worksplice-options.js` default, the README documentation).
- **loopback is always allowed**: the request security gate only validates Host (loopback passes, **the port is not checked**); curl sends no browser headers → the Origin check is not enabled. In other words: a local curl always passes the security gate.
- **no runtime discovery**: there is no "the port is known" environment variable such as `WORKSPLICE_PORT`; in dev mode `PORT` has no effect (the scripts hard-code `-p 30141` into the CLI flag), and only the production binary (`bin/worksplice.js`) honors `PORT`.
- **custom port**: write the actual base URL into MEMORY.md quick reference §3; when `WORKSPLICE_PASSWORD` is set, always add `-u pi:<password>` to curl (Basic Auth, the username is always `pi`).
- **tool set**: a secretary session activates read/bash/edit/write by default (PRESET_DEFAULT), and bash + curl work out of the box; **never** pass `toolNames: []` through any entry point (it disables every tool and clears the system prompt).

### 2.2 General conventions

- Every interface returns JSON; **an error is `{error: string}` plus 4xx/5xx**; a successful creation is `201`, a successful read is `200`.
- Typical status codes: **400** missing parameter or illegal value; **404** resource does not exist; **403** not allowed (no permission); **409** conflict (freshness-hold held / task already exists).
- **write interfaces carry baseSeq** (freshness semantics): sending a message / claim / updateStatus carry the room version as of writing (= that target's max(seq)); the server compares it inside the transaction and returns 409 held when it differs.
- All examples below use the default port; with a custom port or a password, adjust per 2.1. Placeholders such as `<channelId>` / `<messageId>` / `<agentId>` / `<memberId>` / `<anchorMessageId>` / `<taskMessageId>` / `<provider>` / `<modelId>` / `<channelOrMessageId>` stand for real ids; `<baseSeq>` = the target's latest seq read while writing (see the `maxSeq` response in §2.3.3). `#all` can be used directly as a channel id in a JSON body; **in a URL path or query parameter it must be percent-encoded as `%23all`** (a bare `#` is truncated as a URL fragment).

### 2.3 Read-only interfaces

#### 2.3.1 Channel list — `GET /api/channels`

```bash
curl -s http://127.0.0.1:30141/api/channels
```

- **response highlights**: `{"channels":[{"id","name","type","description","archived","created_at","joined","memberCount"}]}` — `joined` = whether the current user (the Owner) has joined, `memberCount` = the number of members; `#all` is in the list.
- **typical errors**: normally no 4xx (the read side is permissive); a service failure falls back to 500.

```json
{"channels":[{"id":"#all","name":"#all","type":"public","description":"","archived":0,"created_at":"...","joined":true,"memberCount":3}]}
```

#### 2.3.2 Member list — `GET /api/members`

```bash
curl -s http://127.0.0.1:30141/api/members
```

- **response highlights**: `{"agents":[{"id","type","name","description","role","workspace_path","pi_session_file","status","deleted","model_provider","model_id","thinking_level","created_at","home_path"}],"owner":{...}}` — `home_path` = the deterministic home directory (ADR-0001, distinct from a bound project directory); `owner` = the human member (the data source for mention rendering).
- **note**: soft-deleted members (`deleted=1`) do not appear; an agent's `workspace_path` may point at a shared project directory rather than its home (several agents may share a project directory; the home directory is unique).
- **typical errors**: normally no 4xx; a service failure falls back to 500.

```json
{"agents":[{"id":"<uuid>","type":"agent","name":"new-member","description":"","role":"member","workspace_path":"<homeDir>","pi_session_file":null,"status":"offline","deleted":0,"model_provider":"<provider>","model_id":"<modelId>","thinking_level":"max","created_at":"...","home_path":"<homeDir>"}],"owner":{"id":"owner","name":"..."}}
```

#### 2.3.3 Channel/thread message flow — `GET /api/channels/[id]/messages`

```bash
# latest page of a channel (omit before to get the newest)
curl -s http://127.0.0.1:30141/api/channels/<channelId>/messages
# page back to older messages (before = the earliest seq returned last time, exclusive)
curl -s "http://127.0.0.1:30141/api/channels/<channelId>/messages?before=3&limit=50"
# read the thread of an anchor message
curl -s "http://127.0.0.1:30141/api/channels/<channelId>/messages?targetId=<anchorMessageId>"
```

- **response highlights**: `{"targetId","targetKind":"channel"|"thread","messages":[{"id","target_id","seq","author_id","content","created_at","author","reactions","attachments","threadReplyCount"}],"hasMore","maxSeq"}` — each message embeds its author, the reaction aggregation, the attachment rows and the thread reply count.
- **seq cursor pagination**: `before` is exclusive, `limit` defaults to 50 (maximum 200); `maxSeq` = the target's latest seq (the source of baseSeq when sending).
- **typical errors**: 404 the channel does not exist; 400 the anchor message does not belong to this channel ("Message does not belong to this channel").

```json
{"targetId":"#all","targetKind":"channel","messages":[{"id":"<uuid>","target_id":"#all","seq":1,"author_id":"owner","content":"hello","created_at":"...","author":{...},"reactions":[],"attachments":[],"threadReplyCount":0}],"hasMore":false,"maxSeq":1}
```

```bash
# error example: the channel does not exist → 404
curl -s -i http://127.0.0.1:30141/api/channels/no-such-channel/messages
# → HTTP/1.1 404  {"error":"Channel not found"}
```

#### 2.3.4 Task board — `GET /api/channels/[id]/tasks`

```bash
curl -s http://127.0.0.1:30141/api/channels/<channelId>/tasks
```

- **response highlights**: `{"tasks":[{"id","message_id","number","status","owner_id","reopened","updated_at","channelId","anchor","owner"}]}` — sorted by number ascending; `reopened` = 1 means the reopen lockdown is active (agents cannot claim automatically); status grouping happens on the UI side (todo→in_progress→in_review→done→closed).
- **typical errors**: 404 (the route layer falls back to 404 for every error).

```json
{"tasks":[{"id":"<uuid>","message_id":"<messageId>","number":1,"status":"todo","owner_id":null,"reopened":0,"updated_at":"...","channelId":"#all","anchor":{...},"owner":null}]}
```

#### 2.3.5 Reminder list — `GET /api/reminders`

```bash
# every reminder
curl -s http://127.0.0.1:30141/api/reminders
# filter by author / anchored target (optional)
curl -s "http://127.0.0.1:30141/api/reminders?authorId=<memberId>&targetId=<channelOrMessageId>"
```

- **response highlights**: `{"reminders":[{"id","title","fire_at","recurrence","target_id","author_id","status","created_at"}]}` — `status` = scheduled/fired/canceled.
- **typical errors**: 400 (a bad parameter falls back).

```json
{"reminders":[{"id":"<uuid>","title":"reminder title","fire_at":"2026-08-08T20:00:00.000Z","recurrence":"every:2m","target_id":"#all","author_id":"owner","status":"scheduled","created_at":"..."}]}
```

#### 2.3.6 Full-text search — `GET /api/search?q=`

```bash
# pass keywords containing Chinese characters or other special characters through --data-urlencode (a raw keyword pasted into the URL is rejected by the server with 400)
curl -s -G --data-urlencode "q=<keyword>" http://127.0.0.1:30141/api/search
```

- **response highlights**: `{"query":"<keyword>","results":[{"id","target_id","seq","author_id","created_at","snippet","channel","author","inThread"}]}` — `snippet` carries `<mark>` highlighting; `channel` = the owning channel, `inThread` = whether it is a thread message.
- **typical errors**: 400 empty query (`q` missing or all whitespace: `{"error":"Search query is required"}`).

```json
{"query":"<keyword>","results":[{"id":"<uuid>","target_id":"#all","seq":2,"author_id":"owner","created_at":"...","snippet":"...<mark>keyword</mark>...","channel":{...},"author":{...},"inThread":false}]}
```

#### 2.3.7 inbox self-check — `GET /api/members/[id]/inbox`

```bash
# drain every target that has unconsumed messages for this agent
curl -s http://127.0.0.1:30141/api/members/<agentId>/inbox
# drain only the given target (a channel or a thread anchor; #all must likewise be encoded as %23all in the query)
curl -s "http://127.0.0.1:30141/api/members/<agentId>/inbox?targetId=%23all"
```

- **response highlights**: `{"agentId","drains":[{"targetId","messages":[...],"hasMore","consumedSeq","maxSeq"}]}` — `consumedSeq` = the consumption cursor before the ack, `maxSeq` = the room version (the source of baseSeq for a reply's freshness; always drain until `hasMore:false`).
- **note (this advances the cursor)**: this interface is **drain + ack in one step** — it advances the cursor to `maxSeq` before returning. The normal flow calls it once per agent-loop round; a secretary self-check should be careful (drained messages never re-enter the inbox, which breaks its own consumption semantics).
- **typical errors**: 404 the agent does not exist; 400 other anomalies.

```json
{"agentId":"<agentId>","drains":[{"targetId":"#all","messages":[{...}],"hasMore":false,"consumedSeq":0,"maxSeq":1}]}
```

#### 2.3.8 Model list (must be checked before creating an agent) — `GET /api/models`

```bash
curl -s http://127.0.0.1:30141/api/models
```

- **response highlights**: `{"models":{...},"modelList":[{"id","name","provider"}],"defaultModel":{"provider","modelId"}|null,"thinkingLevels":{...},"thinkingLevelMaps":{...},"thinkingLevelPins":{...},"modelError"?}`.
- **note**: `defaultModel` being `null` means no model is configured (an agent cannot reference the default then; pick from `modelList` and report what is actually available); a runtime model error carries the `modelError` field; `modelList` is already filtered by the enabledModels scope.
- **typical errors**: 400 the `cwd` parameter does not exist / is not a directory; 403 unauthorized directory (`?cwd=` points at a root that is not allowed).

### 2.4 Creation interfaces

#### 2.4.1 Post a message — `POST /api/messages`

```bash
# JSON form
curl -s -X POST http://127.0.0.1:30141/api/messages \
  -H 'Content-Type: application/json' \
  -d '{"targetId":"#all","content":"hello"}'
# with baseSeq (the maxSeq at writing time, freshness protection) and a quote
curl -s -X POST http://127.0.0.1:30141/api/messages \
  -H 'Content-Type: application/json' \
  -d '{"targetId":"#all","content":"reply","baseSeq":<baseSeq>,"quoteId":"<messageId>"}'
```

- **body (JSON)**: `{"targetId","content","baseSeq"?,"quoteId"?}`; **multipart form**: fields + `files[]` (attachments commit atomically with the message, §1.6).
- **response highlights**: 201 `{"message":{...}}` — the full message shape (including author/reactions/attachments).
- **baseSeq semantics (important)**: `baseSeq` = the `maxSeq` at writing time; the server compares it inside the transaction and, when the version differs, returns **409 `{"held":true,"roomSeq","whatHappened"}`** (a "what happened meanwhile" summary). The response: re-read (`roomSeq` is the new version) and then choose one of four — revise (rewrite) / resend (retry as is with the new baseSeq) / silent (give up) / anyway (send explicitly without baseSeq; the escape hatch for repeated holds).
- **typical errors**: 400 missing `targetId` / empty content / target does not exist ("Channel or message not found") / not a channel member / the channel is archived ("This channel is archived and is read-only") / "Threads cannot be nested"; **409 held** (baseSeq is stale).

```bash
# error example: a stale baseSeq → 409 held (the supplied baseSeq predates the room's current maxSeq)
curl -s -i -X POST http://127.0.0.1:30141/api/messages \
  -H 'Content-Type: application/json' \
  -d '{"targetId":"#all","content":"reply","baseSeq":0}'
# → HTTP/1.1 409  {"held":true,"roomSeq":3,"whatHappened":"1 new message(s) arrived in this target (seq 1)"}
```

#### 2.4.2 Create a channel — `POST /api/channels`

```bash
# public channel (the secretary joins automatically)
curl -s -X POST http://127.0.0.1:30141/api/channels \
  -H 'Content-Type: application/json' \
  -d '{"name":"new-channel","type":"public","description":"description"}'
# private channel + initial members
curl -s -X POST http://127.0.0.1:30141/api/channels \
  -H 'Content-Type: application/json' \
  -d '{"name":"private-room","type":"private","description":"description","memberIds":["<memberId>"]}'
```

- **body**: `{"name" (required, ≤32 characters) ,"type"?: "public"|"private" (default public),"description"?,"memberIds"?[]}` — the initial members of a private channel are named by the creator (the Owner); the secretary joins a public channel automatically (§7 channel coverage rules).
- **response highlights**: 201 `{"channel":{"id","name","type","description","archived","created_at"}}`.
- **note**: the secretary has no archive/delete permission, so **a wrong creation can only be cleaned up manually by the Owner** — ask before acting when a key parameter (public/private, description, initial members) is missing.
- **typical errors**: 400 missing `name` / a name longer than 32 characters ("Channel name must be 32 characters or fewer") / an initial member id that does not exist ("Member not found").

```bash
# error example: missing name → 400
curl -s -i -X POST http://127.0.0.1:30141/api/channels \
  -H 'Content-Type: application/json' -d '{"type":"public"}'
# → HTTP/1.1 400  {"error":"Channel name is required"}
```

#### 2.4.3 Create an agent — `POST /api/members`

```bash
curl -s -X POST http://127.0.0.1:30141/api/members \
  -H 'Content-Type: application/json' \
  -d '{"name":"new-member","provider":"<provider>","modelId":"<modelId>","thinkingLevel":"max"}'
```

- **body**: `{"name" (≤32 characters),"description"?,"provider" (required),"modelId" (required),"thinkingLevel" (required; off|minimal|low|medium|high|xhigh|max)}` — **creation contract: all three of provider/modelId/thinkingLevel** (ADR-0001).
- **check before use**: before creating an agent, call `GET /api/models` (§2.3.8) for the available provider/modelId/thinkingLevel and report what is actually available (spec §3.1).
- **response highlights**: 201 `{"agent":{"id","name","description","workspace_path","status":"offline","model_provider","model_id","thinking_level",...}}` — the home directory is generated automatically (with the fixed MEMORY.md outline) and `#all` is joined automatically.
- **typical errors**: 400 one of the three parameters missing ("Model provider, model id and thinking level are required when creating an agent") / a missing name or one longer than 32 characters ("Agent name must be 32 characters or fewer").

```bash
# error example: missing provider/modelId/thinkingLevel → 400
curl -s -i -X POST http://127.0.0.1:30141/api/members \
  -H 'Content-Type: application/json' -d '{"name":"new-member"}'
# → HTTP/1.1 400  {"error":"Model provider, model id and thinking level are required when creating an agent"}
```

#### 2.4.4 Convert to task — `POST /api/tasks`

```bash
# form 1: turn an existing top-level message into a task (Convert to Task)
curl -s -X POST http://127.0.0.1:30141/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"messageId":"<messageId>"}'
# form 2: post a message and create the task (Tasks tab Create Task)
curl -s -X POST http://127.0.0.1:30141/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"channelId":"#all","content":"create a task"}'
```

- **body**: `{"messageId"}` or `{"channelId","content"}`, pick one (messageId takes precedence when both are given).
- **response highlights**: 201 `{"task":{...}}` — the full task view (including the anchor message `anchor`, `owner` and the `reopened` flag).
- **note**: a task = message + metadata, and **a thread message cannot be converted** ("Only top-level messages can become tasks"); a message cannot be converted twice.
- **typical errors**: 400 no valid form ("Provide { messageId } or { channelId, content }") / a thread message / the message does not exist; 404 the channel does not exist; **409** the message is already a task (TaskAlreadyExistsError).

```bash
# error example: converting the same message twice → 409
curl -s -i -X POST http://127.0.0.1:30141/api/tasks \
  -H 'Content-Type: application/json' -d '{"messageId":"<taskMessageId>"}'
# → HTTP/1.1 409  {"error":"This message is already a task"}
```

#### 2.4.5 Schedule a reminder — `POST /api/reminders`

```bash
# one-shot reminder (author defaults to the Owner)
curl -s -X POST http://127.0.0.1:30141/api/reminders \
  -H 'Content-Type: application/json' \
  -d '{"title":"reminder title","fireAt":"2026-08-08T20:00:00.000Z","targetId":"#all"}'
# recurring reminder (every:2m delay semantics)
curl -s -X POST http://127.0.0.1:30141/api/reminders \
  -H 'Content-Type: application/json' \
  -d '{"title":"reminder title","fireAt":"2026-08-08T20:00:00.000Z","recurrence":"every:2m","targetId":"#all"}'
```

- **body**: `{"title" (required),"fireAt" (required, an ISO date string),"recurrence"? (DSL, §1.3),"targetId"? (a channel or message id),"authorId"?}` — the default author is the Owner; the Owner can set one on an agent's behalf (`authorId` must be an agent member) — only that author is woken when it fires (demo path: set every:1m on an agent → a system message + the agent is woken).
- **response highlights**: 201 `{"reminder":{"id","title","fire_at","recurrence","target_id","author_id","status":"scheduled","created_at"}}`.
- **typical errors**: 400 missing `title` ("Reminder title is required") / `fireAt` not a valid date string ("fireAt must be a valid date string (ISO)") / `authorId` is not an agent member.

```bash
# error example: missing title → 400
curl -s -i -X POST http://127.0.0.1:30141/api/reminders \
  -H 'Content-Type: application/json' -d '{"fireAt":"2026-08-08T20:00:00.000Z"}'
# → HTTP/1.1 400  {"error":"Reminder title is required"}
```

## 3. Common Paths

> The standard guidance for "how do I X"; each section = ask first (when a parameter is missing) → execute → a one-line receipt (spec §3.1: after a creation call, return a one-line receipt with what was created / its key attributes).

### 3.1 The user wants to "create a channel"

1. **Ask for the key parameters first** (ask before acting when they are missing; a wrong creation can only be cleaned up manually by the Owner): public or private, description, initial members.
2. **Execute**: `POST /api/channels` (§2.4.2).
3. **One-line receipt**: what was created (`#name`) + its key attributes (public/private, description); for example "created public channel #new-channel (description: …), joined automatically".

### 3.2 The user wants to "create an agent"

1. **Ask first**: name, description; if `GET /api/models` reports `defaultModel` as null, explain first that "a model must be configured" (point to the Owner UI for configuration).
2. **Get a model**: `GET /api/models` (§2.3.8) → pick provider/modelId/thinkingLevel from `modelList` and report what is actually available.
3. **Execute**: `POST /api/members` (§2.4.3).
4. **One-line receipt**: `@name` created (provider/modelId/thinkingLevel), home directory generated automatically, `#all` joined.

### 3.3 The user asks "what has been happening lately"

1. **Poll the sources**: `GET /api/channels` (§2.3.1) for the channel list → for each channel `GET /api/channels/[id]/messages` (omit before to get the latest page, §2.3.3).
2. **Summarize**: group the newest messages per channel (author + seq + first line) into a short summary for the user; task progress can be added from the task board (§2.3.4).

### 3.4 The user asks "what was said about a topic"

1. **Search**: `GET /api/search` (§2.3.6, `-G --data-urlencode "q=<keyword>"`) — results carry the owning channel/thread and the author.
2. **Locate**: hand the deep link to the user — `#c/<channelId>?m=<messageId>` (a thread message automatically expands its thread).
3. **Summarize**: organize the context from the matching channels/threads into a reply (cite sources as `#seq author`).

### 3.5 The user asks for an out-of-scope operation

- Archiving/unarchiving a channel, deleting an identity, Restart / Session reset / Full reset, changing runtime, changing workspace, claiming a task — **do not attempt it**; point straight to the Owner UI (full wording in §4.2).

## 4. Permission Boundary and Fallback Lines

### 4.1 What can be done (read-only + creation)

| Category | Operation | API surface |
|---|---|---|
| Read-only | look up channels / members / channel messages / task board / reminders / search | `GET /api/channels`, `/api/members`, `/api/channels/[id]/messages`, `/api/channels/[id]/tasks`, `/api/reminders`, `/api/search` (§2.3) |
| Creation | post a message / create a channel / create an agent / schedule a reminder | `POST /api/messages`, `/api/channels`, `/api/members`, `/api/reminders` (§2.4) |

- Before creating an agent, call `GET /api/models` for the available provider/modelId/thinkingLevel and report what is actually available (§2.3.8).
- After a creation call, return a one-line receipt; when a key parameter (public/private, description, initial members) is missing, ask before acting (§3.1/3.2).
- Tool set = the system default (PRESET_DEFAULT: read/bash/edit/write), with bash + curl working out of the box (01 research).

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
2. **curl/API failure** (400/404/409/5xx or a network error):
   - Standard response: **retry once**, and if it still fails report the error honestly — the request, the error message and what was already attempted; **never pretend success, never retry forever**.
   - A 409 held is a recoverable conflict: handle it with the four options in §2.4.1 (revise/resend after a re-read is the normal flow, not a "failure").
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
