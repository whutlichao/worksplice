## What changed

<!-- One or two sentences. Link the issue this closes, if there is one. -->

## Why

<!-- What was wrong or missing, and why this is the right shape of fix. -->

## How it was verified

<!-- What you ran and what you saw. `node_modules/.bin/tsc --noEmit`, `npm run lint`, and `npm test` are the repository checks. -->

## Checklist

- [ ] No agent-internal working state is included. `.scratch/`, `.codex/`, `.commandcode/`, and `.agent-teams/` are untracked on purpose and must not appear in a PR.
- [ ] If `README.md` or `README.zh-CN.md` changed, both changed and their section order, heading levels, and bullet counts still match.
- [ ] No credentials, API keys, session file contents, or other private data is included, including in test fixtures and pasted logs.