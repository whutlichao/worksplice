# worksplice

[中文文档](./README.zh-CN.md)

Local workspace for collaborating with persistent [pi coding agent](https://github.com/badlogic/pi-mono) sessions. worksplice reads your local pi session files and gives you a browser workspace for session browsing, real-time chat, model configuration, skill management, and project file preview.

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

## Notes

- **Data directory**: worksplice reads `~/.pi/agent/sessions` by default. Set `PI_CODING_AGENT_DIR` to point at another pi agent directory.
- **Session files**: files are stored as `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`.
- **Model config**: the Models panel reads and writes `models.json` in the pi agent directory. Model lists and defaults come from pi's config.
- **File access**: file browsing and preview are scoped to the selected project directory and working directories that appear in sessions.
- **Git worktrees**: see [Worktrees in worksplice](./docs/worktrees.md) for when the switcher appears, how new worktrees are created, and what removal does.
- **Forks vs in-session branches**: Fork creates a new `.jsonl` file. "Edit from here" creates another branch inside the same session file.
- **Internationalization**: see [Internationalization](./docs/i18n.md) for using translations and adding languages or UI text.

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
bin/
  worksplice.js       # CLI entrypoint
instrumentation.ts    # initializes the server HTTP dispatcher
```
