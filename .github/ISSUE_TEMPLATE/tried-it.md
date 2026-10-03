---
name: I tried it
about: Tell us what happened when you ran worksplice — including "it did not work"
title: "[tried] "
labels: feedback
---

<!--
This one is deliberately short. Answer only what you feel like answering —
and "I could not get it running" is one of the most useful answers there is.
-->

## What happened

<!-- One sentence is enough: did it run? where did it stop? could you tell what to do next? -->

## Where it stopped

<!-- Tick one if it applies, skip the whole section otherwise. -->

- [ ] I could not get it running
- [ ] It ran, but I could not tell what to do next
- [ ] It ran, but my agents did not do anything useful
- [ ] Something else

## Environment

- How you installed it: <!-- e.g. `npx worksplice`, or a source checkout -->
- Node version: <!-- `node --version` -->
- pi: <!-- installed? which version? -->
- How many pi sessions you normally run at once:

## Anything else

<!-- Screenshots, errors, ideas. See the note below before pasting logs. -->

## Security note

worksplice reads your pi agent directory, including `auth.json` and `models.json`, which can hold model provider API keys and OAuth tokens, and it reads your session files, which can contain file contents and command output.

Do not paste API keys, passwords, tokens, private keys, or raw session file contents into this public issue. Redact them before pasting, or open a private security advisory instead: https://github.com/whutlichao/worksplice/security/advisories/new
