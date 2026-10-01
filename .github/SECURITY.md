# Security Policy

worksplice is a local developer tool. It runs on your own machine, listens on `127.0.0.1` by default, and drives a local [pi coding agent](https://github.com/badlogic/pi-mono) that can read and write files and run commands. Anything that can reach the worksplice web interface inherits that authority, so treat access to the interface the way you treat shell access on your own account.

## What counts as a vulnerability

Useful reports let someone who should not have access reach that authority:

- an authentication or request-host check bypass,
- a cross-site request that reaches a state-changing API endpoint,
- path traversal out of the browsable project directories,
- a credential or file content leaked through a response, export, or log.

Not vulnerabilities:

- Reaching the interface while `WORKSPLICE_PASSWORD` is unset. Authentication is opt-in.
- The agent doing what instructions from someone who already has interface access tell it to do.
- Model or provider behaviour that belongs to pi rather than to worksplice.

## Exposure and hardening

These behaviours are verified in `bin/worksplice-options.js`, `lib/web-auth.ts`, `lib/request-security.ts`, and `proxy.ts`.

- **Default bind.** worksplice listens on `127.0.0.1`, so other machines cannot reach it. `npm run dev:lan`, `npm run start:lan`, `--hostname 0.0.0.0`, or `WORKSPLICE_HOSTNAME` widen the bind to `0.0.0.0`.
- **Authentication.** Setting `WORKSPLICE_PASSWORD` enables HTTP Basic Auth on the web interface and every API endpoint. The username is always `pi`. Leaving the variable unset or empty disables authentication.
- **Transport.** Basic Auth does not encrypt the password in transit, so do not expose plain HTTP to the internet. For remote access, use HTTPS through a trusted reverse proxy or a trusted VPN.
- **Accepted request hosts.** A request is served only when its `Host` header resolves to a loopback name (`localhost` or `*.localhost`), an IP literal, the configured bind hostname, or an exact comma-separated name in `WORKSPLICE_ALLOWED_HOSTS`. Set that variable when a trusted reverse proxy uses a different external hostname.
- **Cross-site requests.** API endpoints additionally reject cross-site browser requests. Clients that send neither `Origin` nor `Sec-Fetch-Site` are not browsers and are not origin-checked, so anything able to reach the port can call the API directly.

## Secrets on disk

worksplice reads the pi agent directory, which holds `auth.json` and `models.json`. Those files can contain API keys and OAuth tokens for model providers. It also reads pi session files under `~/.pi/agent/sessions`, and those sessions can contain file contents, prompts, and command output. Point it at a different agent directory with `PI_CODING_AGENT_DIR` if you need to isolate it.

Do not paste any of that into a public issue or pull request. The bug report template repeats this warning because it is easy to forget when copying a log.

## Reporting a vulnerability

Use the repository's private security advisory channel:

https://github.com/whutlichao/worksplice/security/advisories/new

Include the affected commit, the steps to reproduce, and what an attacker actually gains. Please do not open a public issue for an unfixed vulnerability.

## Supported versions

There is no tagged release yet, so there is no version list to support. Fixes land on the current development version of the default branch, and a report is only actionable against a commit on that branch. If you are on an older checkout, update to the current default branch first and confirm the problem still reproduces there.