# 02: Improve channel and thread message readability

Type: task
Status: ready-for-agent

**What to build:** Make ordinary channel messages and thread replies easier to read through the approved message-local typography, line length, and vertical rhythm. Preserve message identity, code formatting, existing interactions, global layout widths, and all excluded reading surfaces.

**Blocked by:** None (can start immediately).

- [ ] Channel and thread ordinary prose uses 14px text with a 68ch maximum body line length; the stream and composer retain their existing 880px overall column.
- [ ] Channel message rows use 12px block padding, 1.65 line height, and 8px paragraph spacing; thread replies use 16px block padding, 1.7 line height, and 12px paragraph spacing. No cards or separators are added.
- [ ] Author remains clearly visible at 14px. Timestamp and sequence remain visible in 10.5px monospace at the secondary `--faint` level; their order and message identity do not change.
- [ ] Inline code remains 12px with no independent line-height declaration. Fenced code remains on the current renderer and at 12px / 1.62; its existing horizontal scrolling is unchanged.
- [ ] Existing reply, quote, action toolbar, reaction, attachment, pin, and anchor behavior remains unchanged. Task activity summaries and agent-session transcripts retain their current compact treatment.
- [ ] Wide and narrow channel layouts and the narrow thread dock wrap naturally without horizontal page overflow. The accepted reading comfort takes precedence over preserving messages per viewport.
- [ ] Permanent regressions use the existing channel/thread rendered-markup seams and stylesheet-mirror contract. Assert rendered message content and visible metadata, not class names alone; cover short and long messages, Latin and CJK text, and inline/fenced code. Demonstrate TDD red → green in the Answer; add no browser-test infrastructure.
- [ ] Test tier: **wide**. The shared `MessageRow` styling affects both channel and thread render paths and the existing stylesheet-mirror contract; run the full test suite.
- [ ] The Answer includes **双轴 `code-review`（Standards + Spec）**, two separate reports, and disposition for each finding; no review waiver applies.
- [ ] Coordinator verifies real channel/thread geometry with Ego-browser using disposable data before merge; record computed styles, overflow checks, and screenshots. Never use or modify live user data.
- [ ] Compare lint and typecheck against the ticket's base commit; zero new findings in changed files. Record the red/green tests, review reports, and geometry evidence in the Answer.
- [ ] Push the branch and create a PR with `gh pr create`; record the PR number in the Answer.
