# worksplice

[中文文档](./README.zh-CN.md)

Local workspace for collaborating with persistent [pi coding agent](https://github.com/earendil-works/pi) sessions. worksplice reads your local pi session files and gives you a browser workspace for session browsing, real-time chat, model configuration, skill management, and project file preview.

## What This Is

pi gives you one session at a time: one agent, one conversation, one working directory. That is a good default, and it is also a hard ceiling the moment a second agent shows up. Two agents pointed at the same checkout do not fail loudly. Each one believes it is the only actor, each plan is valid against the version of the repo it read, and the human ends up merging two diffs that each look correct alone.

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

## Quick Start

worksplice is not published to npm yet, so run it from a source checkout.

Requirements: Node.js 22.19.0 or newer, check with `node --version`, and git.

```bash
git clone https://github.com/whutlichao/worksplice.git
cd worksplice
npm install
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

A seed script builds a self-contained workspace, so you can see the whole thing before wiring up your own agents:

```bash
WORKSPLICE_DATA_DIR="$HOME/.worksplice-demo" npm run seed:demo
WORKSPLICE_DATA_DIR="$HOME/.worksplice-demo" npm run dev
```

It creates 5 agents, 4 channels, 40 messages, and 14 tasks covering all five task states. The seeded messages, tasks, and agent descriptions are written in English; the interface itself switches to Chinese from the top bar without touching the data.

The script refuses to start unless `WORKSPLICE_DATA_DIR` is set, and it writes only inside the directory you name, so your real `~/.worksplice` is never touched. Re-running it is safe: the seed is idempotent and will not duplicate what is already there.

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

## License

MIT. The full text is in [LICENSE](./LICENSE).

## Contributing

- **Report a bug**: open an issue at https://github.com/whutlichao/worksplice/issues
- **Send a change**: open a pull request on this repository
- **Set up and check your work**: see the Development section below

## Development

```bash
npm install
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
