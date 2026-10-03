# worksplice

[中文文档](./README.zh-CN.md)

pi gives you one session at a time. worksplice puts several of them in one local room — and adds the three things that keep a room from going wrong: **who has read what, who may write, who verifies**.

It is a local workspace for collaborating with persistent [pi coding agent](https://github.com/earendil-works/pi) sessions: channels, a task board with review, reminders, and an inbox-cursor wake model — plus a browser workspace for session browsing, real-time chat, model configuration, skill management, and project file preview.

## What This Is

One agent, one conversation, one working directory is a good default — and a hard ceiling the moment a second agent shows up. Two agents pointed at the same checkout do not fail loudly. Each one believes it is the only actor, each plan is valid against the version of the repo it read, and the human ends up merging two diffs that each look correct alone.

worksplice does not replace pi. It puts several pi sessions into shared channels, and adds the handful of semantics that multi-agent work needs but that message passing alone cannot give you:

- **Wake, not push**: a hint tells an agent that something moved without carrying the body, so a wake that turns out to be irrelevant stays cheap.
- **A cursor, not a list**: each agent records how far it has read, so "what have I already seen" survives a restart instead of being re-derived from the log.
- **Freshness on concurrent writes**: every write states which version of the room it was based on. If the room moved first, the write is held and the author chooses what to do instead of silently overwriting.
- **Review before done**: a task is not finished because its author says so. It moves through a state machine, and approving it requires someone other than the author.

worksplice is deeply dependent on pi. It reads pi's session files, drives pi's agent sessions, and takes pi's config, model, and skill model as given. It is not a general-purpose agent framework, it does not bring its own runtime for running agents, and pointing it at a different coding agent means replacing the substrate rather than swapping a plugin.

### When to use it

- You run more than one pi session against the same repository and they overwrite each other.
- You want one agent to hand work to another without you relaying it by hand.
- You want a review trail: who claimed a task, who approved it, what was decided and when.
- You want a UI for a directory of existing pi sessions instead of reading `~/.pi/agent/sessions` by hand.

### When not to use it

- You work with a single agent in a single directory. The pi TUI is enough, and worksplice only adds a server to keep running.
- You are not running pi. There is no adapter for another coding agent.
- You need several people to reach it over the internet. It binds to loopback by default and is built for a machine you trust.
- You want hosting, accounts, or a shared database. This is a local workspace over one SQLite file.

## How It Relates to Other Tools

worksplice sits at a different layer from tools you may already use. [`agent-chat`](https://github.com/Hysilens-Helektra/agent-chat) deliberately stays a peer-to-peer messaging layer — discovery and transport, no orchestrator. Parallel terminal managers (vibe-kanban, claude-squad) answer a different question: how to run many agents at once. worksplice answers a third one: what has to be true for several agents to share one repo without overwriting each other — or rubber-stamping each other's work.

| Question | The usual answer | worksplice |
| --- | --- | --- |
| What does a wake carry? | The message body, pushed at the agent | A hint — `{agentId, targetId, seq}` — and the agent reads the room itself |
| How does an agent know what it missed? | "The last message", or re-reading everything | A durable cursor: reading does not advance it, an ack does |
| Two writers, one stale version | Last write wins, or an automatic merge | The write is **held**, with a description of what changed; the author chooses revise, resend, stay silent, or bypass |
| Who may declare work done? | Whoever did the work | A state machine, and only someone other than the author can approve |
| Where does it run? | Cloud, accounts | One local SQLite file, loopback by default |

One honest note on overlap: pi's own roadmap includes a **pi server** that will cover part of what worksplice does. This is the version that exists today — local, one SQLite file, readable end to end — and if the official one makes it redundant, that is a good outcome.

## Quick Start

Requirements: Node.js 22.19.0 or newer, check with `node --version`.

```bash
npx worksplice
```

Then open [http://127.0.0.1:30142](http://127.0.0.1:30142). worksplice listens on `127.0.0.1` by default, so other machines cannot reach it. To see the whole thing before wiring up your own agents, jump to [Try It with Demo Data](#try-it-with-demo-data).

Every release also attaches the same package as a tarball, for machines that cannot reach the npm registry:

```bash
npx --yes https://github.com/whutlichao/worksplice/releases/download/v0.1.0/worksplice-0.1.0.tgz
```

### From a source checkout

Requirements: Node.js 22.19.0 or newer, Bun 1.3.14 or newer (check with `bun --version`), and git. This repository tracks `bun.lock`, so `bun install` is the reproducible path; `npm install` also works, but it ignores `bun.lock` and does not guarantee a reproducible dependency tree.

```bash
git clone https://github.com/whutlichao/worksplice.git
cd worksplice
bun install
```

Development mode, always on port 30142:

```bash
npm run dev
```

Production or preview mode:

```bash
npm run build
npm start
```

Then open [http://127.0.0.1:30142](http://127.0.0.1:30142). worksplice listens on `127.0.0.1` by default, so other machines cannot reach it. Use `npm run dev:lan` or `npm run start:lan` to listen on `0.0.0.0` on a trusted network.

`node bin/worksplice.js` is a separate entry point for a built checkout. It starts the same server and tries to open the browser automatically after the server is ready.

**Options:**

These options belong to `node bin/worksplice.js` and are only available after `npm run build`; without build artifacts it prints `Build artifacts not found.` and exits. The `dev`, `dev:lan`, `start`, and `start:lan` scripts take no options.

```bash
node bin/worksplice.js --port 8080          # custom port
node bin/worksplice.js --hostname 0.0.0.0   # expose on a trusted network
node bin/worksplice.js -p 8080 -H 0.0.0.0   # combine options
node bin/worksplice.js --no-open            # do not open the browser automatically

PORT=8080 node bin/worksplice.js            # environment variable is also supported
WORKSPLICE_HOSTNAME=0.0.0.0 node bin/worksplice.js  # explicit network exposure
WORKSPLICE_ALLOWED_HOSTS=worksplice.internal node bin/worksplice.js  # allow an exact proxy/custom hostname
WORKSPLICE_PASSWORD='a-long-random-password' node bin/worksplice.js  # require Basic Auth (username: pi)
WORKSPLICE_NO_OPEN=1 node bin/worksplice.js # useful when running as a background service
```

Set `WORKSPLICE_PASSWORD` to protect the web interface and every API endpoint with HTTP Basic Auth. The username is always `pi`. Leaving the variable unset or empty disables authentication.

worksplice can invoke a high-privilege agent. Basic Auth does not encrypt the password in transit, so do not expose plain HTTP to the internet. Use HTTPS through a trusted reverse proxy or a trusted VPN for remote access.
API requests accept loopback names, IP literals, the selected bind hostname, and exact comma-separated names in `WORKSPLICE_ALLOWED_HOSTS`. Configure that variable when a trusted reverse proxy uses a different external hostname.

## Try It with Demo Data

One command starts a self-contained demo workspace, so you can see the whole thing before wiring up your own agents:

```bash
npx worksplice --demo
```

It builds 5 agents, 4 channels, 40 messages, and 14 tasks covering all five task states. The seeded messages, tasks, and agent descriptions are written in English; the interface itself switches to Chinese from the top bar without touching the data.

Demo mode runs no agents and never touches your real `~/.worksplice`: the data lives in `~/.worksplice-demo` (override with `WORKSPLICE_DEMO_DIR`), and deleting that directory resets the demo. Re-running the command reuses whatever is already there, so anything you posted in the demo survives.

From a source checkout, `npm run seed:demo` builds the same dataset explicitly; see `scripts/seed-demo.mjs` for the two commands.

Tried it? [Tell us what happened](https://github.com/whutlichao/worksplice/issues/new?template=tried-it.md) — "it did not work" is a useful answer.

## HTTP Proxy

worksplice reads the standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` environment variables for server-side model and API requests. Both examples below start the built server, so run `npm run build` first.

On macOS or Linux:

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
node bin/worksplice.js
```

On Windows PowerShell:

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
node bin/worksplice.js
```

## Features

- **Pick work back up**: browse previous pi conversations by project without digging through terminal history or session paths.
- **Try different directions safely**: continue from an earlier message or fork a session into a separate route.
- **Work across branches**: switch Git worktrees from the sidebar so new sessions and the Explorer follow the checkout you choose.
- **Chat beside the project**: browse files on the left and preview source, docs, images, audio, and PDFs on the right while the agent works.
- **See session state clearly**: context usage, cost, compaction state, and system prompt details are visible from the top bar.
- **Configure less from the terminal**: manage models, login/API keys, model tests, and skill switches from the web UI.
- **Use the interface in your language**: switch between the supported UI languages from the top bar.

## Screenshots

![Several pi agents and the human owner inside one channel: quoted blocks carry the message being answered, @mentions point at the agent being addressed, reaction aggregates sit under the messages they belong to, and a hover bar exposes the per-message actions](./docs/screenshots/channel.png)

![The task board of one channel, five columns that mirror the task state machine, each card showing its owner and only the transitions legal from its current state](./docs/screenshots/task-board.png)

![The detail panel of a single agent: its status, its workspace, the model and thinking level it runs on by itself, and the observability sections for token and cost, task history, and a timeline](./docs/screenshots/agent-panel.png)

![Full-text search over channels and task threads: one query returning 14 hits with the term highlighted, every hit labeled with its author, channel, and message number, and a button that opens the message where it lives](./docs/screenshots/search.png)

All four shots are the seeded demo workspace (`npm run seed:demo`) with the English interface. The same four views with the Chinese interface are in [the Chinese README](./README.zh-CN.md#界面截图).

## Notes

- **Data directory**: worksplice reads `~/.pi/agent/sessions` by default. Set `PI_CODING_AGENT_DIR` to point at another pi agent directory.
- **Session files**: files are stored as `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`.
- **Model config**: the Models panel reads and writes `models.json` in the pi agent directory. Model lists and defaults come from pi's config.
- **File access**: file browsing and preview are scoped to the selected project directory and working directories that appear in sessions.
- **Git worktrees**: see [Worktrees in worksplice](./docs/worktrees.md) for when the switcher appears, how new worktrees are created, and what removal does.
- **Forks vs in-session branches**: Fork creates a new `.jsonl` file. "Edit from here" creates another branch inside the same session file.
- **Internationalization**: see [Internationalization](./docs/i18n.md) for using translations and adding languages or UI text.

## Design Notes

- **Orchestrating coding agents**: [What "Just Let Them Message Each Other" Misses](./docs/design-notes/orchestrating-coding-agents.md) argues that the hard part of multi-agent work is not the transport but having a shared notion of what is true right now, then walks through how worksplice's wake hints, read cursors, freshness holds, and task review answer it, pointing at the code.
- **When one of those rules only worked in the happy path**: [A Held Write That Never Got Revised](./docs/design-notes/when-a-held-write-could-not-be-revised.md) is the failure report — the held-write path that failed in every real run while its tests stayed green, the SDK-level seam that injected fakes cannot see, and the fix. Three runnable reproduction scripts live in `scripts/evidence/`.

## License

MIT. The full text is in [LICENSE](./LICENSE).

## Acknowledgements

worksplice was bootstrapped from [agegr/pi-web](https://github.com/agegr/pi-web)'s source code. pi-web is MIT licensed, worksplice is MIT licensed as well, and pi-web's original copyright notice is preserved in [LICENSE](./LICENSE) at the repository root.

The two have diverged since. pi-web is a browser for pi sessions, which is where worksplice began; worksplice is now a multi-agent collaboration layer with shared channels, wake hints, read cursors, freshness holds, and task review. It is not an official continuation of pi-web.

Separately, worksplice runs on [pi](https://github.com/earendil-works/pi) as its substrate. The two credits are not the same kind: pi-web is where the source came from, and pi is the runtime worksplice still reads and drives.

## Contributing

- **Report a bug**: open an issue at https://github.com/whutlichao/worksplice/issues
- **Send a change**: open a pull request on this repository
- **Tell us you tried it**: [open a "tried it" issue](https://github.com/whutlichao/worksplice/issues/new?template=tried-it.md) — including "it did not work"
- **Set up and check your work**: see the Development section below

## Development

```bash
bun install
npm run dev
```

The local dev server runs at [http://127.0.0.1:30142](http://127.0.0.1:30142).

Common checks:

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```

Avoid running `next build` / `npm run build` while the dev server is running. It writes to `.next/` and can interfere with the dev server; leave builds for the production mode above or for release work.

## Project Structure

```text
app/
  api/
    agent/          # creates/drives AgentSession and exposes SSE events
    auth/           # OAuth and API key management
    cwd/browse/     # browsable server directory listing
    cwd/validate/   # custom working directory validation
    default-cwd/    # pi default working directory lookup
    files/          # file listing, reading, preview, and watching
    home/           # current user home directory
    models/         # available models, default model, thinking levels
    models-config/  # read/write models.json and test models
    sessions/       # session reads, rename, delete, context, HTML export
    skills/         # skill listing, search, install, enable/disable
components/
  AppShell.tsx         # main layout, URL state, top panels, file tabs
  WorkspaceSidebar.tsx # channel list, agent list, status dots, Explorer
  DirectoryPicker.tsx  # browsable and editable working-directory picker
  ChannelView.tsx      # channel message flow, polling, task views, composer
  ChatInput.tsx        # input bar, model/tools/thinking/compact/slash controls
  MessageView.tsx      # message, thinking, tool call/result rendering
  ModelsConfig.tsx     # model and auth configuration panel
  SkillsConfig.tsx     # skill management panel
  FileExplorer.tsx     # file tree
  FileViewer.tsx       # source, diff, image, audio, PDF, DOCX preview
lib/
  directory-browser.ts # directory normalization and safe listing helpers
  http-dispatcher.ts  # HTTP(S) proxy setup for server-side fetch
  rpc/                # AgentSessionWrapper lifecycle and global registry（session/registry/caller/subscriber/broadcaster + index）
  session-reader.ts   # parses .jsonl session files and branch contexts
  normalize.ts        # normalizes toolCall field names
  file-access.ts      # file read safety boundary
  file-paths.ts       # path encoding and relative path helpers
  markdown.ts         # Markdown/Mermaid/KaTeX plugin configuration
  pi-types.ts         # pi-related types
hooks/
  useAgentSession.ts  # session loading, command sending, SSE state machine
  useAudio.ts         # completion sound
  useDragDrop.ts      # image drag/drop
  useTheme.ts         # theme switching
docs/
  screenshots/        # README screenshots: channel, task board, agent panel, search
                      # (*.png = English interface, *.zh-CN.png = Chinese interface)
bin/
  worksplice.js       # CLI entrypoint
instrumentation.ts    # initializes the server HTTP dispatcher
```
