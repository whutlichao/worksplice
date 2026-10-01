---
name: Bug report
about: Something in worksplice behaves incorrectly
title: ""
labels: bug
---

## Environment

- worksplice version or commit: <!-- `git rev-parse --short HEAD` -->
- Node version: <!-- `node --version` -->
- Operating system:
- Installation: <!-- source checkout, or how you started the server -->

## What happened

<!-- What you did, what you expected, and what you got instead. -->

Steps to reproduce:

1.
2.
3.

Expected:

Actual:

## Logs

<!-- Relevant terminal output or browser console output. Trim it to the part that shows the problem. -->

## Security note

worksplice reads your pi agent directory, including `auth.json` and `models.json`, which can hold model provider API keys and OAuth tokens, and it reads your session files, which can contain file contents and command output.

Do not paste API keys, passwords, tokens, private keys, or raw session file contents into this public issue. Redact them before pasting, or open a private security advisory instead: https://github.com/whutlichao/worksplice/security/advisories/new