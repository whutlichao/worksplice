# 02: Improve channel and thread message readability

Type: task
Status: claimed

**What to build:** Make ordinary channel messages and thread replies easier to read through the approved message-local typography, line length, and vertical rhythm. Preserve message identity, code formatting, existing interactions, global layout widths, and all excluded reading surfaces.

**Blocked by:** None (can start immediately).

- [ ] Channel and thread ordinary prose uses 14px text with a 68ch maximum body line length; the stream and composer retain their existing 880px overall column.
- [ ] Channel message rows use 12px block padding, 1.65 line height, and 8px paragraph spacing; thread replies use 16px block padding, 1.7 line height, and 12px paragraph spacing. No cards or separators are added.
- [ ] Author remains clearly visible at 14px in bold. Timestamp and sequence remain visible in 10.5px monospace at the secondary `--faint` level; their order and message identity do not change.
- [ ] Inline code remains 12px with no independent line-height declaration. Fenced code remains on the current renderer and at 12px / 1.62; its existing horizontal scrolling is unchanged.
- [ ] Existing reply, quote, action toolbar, reaction, attachment, pin, and anchor behavior remains unchanged. Task activity summaries and agent-session transcripts retain their current compact treatment.
- [ ] Wide and narrow channel layouts and the narrow thread dock wrap naturally without horizontal page overflow. The accepted reading comfort takes precedence over preserving messages per viewport.
- [ ] Permanent regressions use the existing channel/thread rendered-markup seams and stylesheet-mirror contract. Assert rendered message content and visible metadata, not class names alone; cover short and long messages, Latin and CJK text, and inline/fenced code. Demonstrate TDD red → green in the Answer; add no browser-test infrastructure.
- [ ] Test tier: **wide**. The shared `MessageRow` styling affects both channel and thread render paths and the existing stylesheet-mirror contract; run the full test suite.
- [ ] The Answer includes **双轴 `code-review`（Standards + Spec）**, two separate reports, and disposition for each finding; no review waiver applies.
- [ ] Coordinator verifies real channel/thread geometry with Ego-browser using disposable data before merge; record computed styles, overflow checks, and screenshots. Never use or modify live user data.
- [ ] Compare lint and typecheck against the ticket's base commit; zero new findings in changed files. Record the red/green tests, review reports, and geometry evidence in the Answer.
- [ ] Push the branch and create a PR with `gh pr create`; record the PR number in the Answer.

## Answer

### Implementation
- Updated the message-local rules in `app/globals.css` and mirrored shared declarations in `worksplice-design-system/ui_kits/app/app.css`: 14px prose capped at 68ch; channel rows 12px block padding, 1.65 line-height, 8px paragraph spacing; thread rows 16px block padding, 1.7 line-height, 12px paragraph spacing. Existing horizontal insets remain 8px for channel rows and 16px for thread rows.
- Removed the sequence number's inline `--muted` override so it inherits the shared 10.5px monospace `--faint` metadata style. Kept global Markdown rules, tokens, stream/composer width, fenced-code renderer, ThreadPanel, activity summaries, transcript, and unrelated message behavior unchanged.

### TDD and verification
- Initial targeted red after adding semantic regressions: `node --test components/message-stream.test.mjs components/ChannelView.test.mjs components/DetailPanel.test.mjs` — 74 passed, 3 failed. Failures exposed the sequence's inline color override and missing message-local Markdown/mirror rules.
- First green: same targeted command — 77 passed, 0 failed. A later horizontal-inset regression produced 76 passed, 1 failed; after correcting both CSS mirrors, targeted tests returned 77 passed, 0 failed.
- `npm run test` — 1,347 passed, 1 skipped, 0 failed (1,348 total). The skipped case is the environment/network-dependent `正例一b：出网照常——成员要能装依赖、拉依赖、访问外部服务`.
- Base `1d1b9fc782d3bcf762cf56a98683476c208fdd84` temporary worktree and ticket worktree: `npm run lint` and `npm run typecheck` both passed. Lint had 0 errors and the same single warning in both trees: `hooks/useI18n.tsx:61`, `react-hooks/exhaustive-deps` (`locale` missing); no new findings in changed files.

### Q→A（人定）：依赖安装授权
- Q: Initial baseline checks could not run because `node_modules` was absent; the offline npm install also failed because the cached `@babel/runtime` tarball was unavailable.
- A: Coordinator authorized installing only dependencies declared by the repository lockfile in this isolated worktree, with no manifest/lockfile edits and no unrelated third-party access. `bun install --frozen-lockfile --registry=http://127.0.0.1:9 --no-progress` installed 1,032 packages from local cache and ran the repository install guard; the loopback registry prevented external network access. No package manifest or lockfile was changed.

### Standards — raw report
Reviewed the corrected diff from fixed point `1d1b9fc782d3bcf762cf56a98683476c208fdd84` through HEAD `bedf278727cfa3c2a52a3b731f638521e3b43ad1`.

Hard documented-standard violations: none. The newly added or changed JavaScript strings now follow `docs/engineering-standards.md` §1 (“字符串统一单引号”); no other applicable rule in `docs/engineering-standards.md`, `CONTEXT.md`, or `.claude/CLAUDE.md` is violated.

Judgment-call smells — **Duplicated Code / Shotgun Surgery**: the mirrored declarations are edited in both `app/globals.css` and `worksplice-design-system/ui_kits/app/app.css`, including `.msg { ... padding: var(--sp-5) var(--sp-4); ... }` and `.msg-text > .markdown-body { max-width: 68ch; font-size: 14px; line-height: 1.65; }`. This makes the same style change span two CSS files. The parity assertion in `components/message-stream.test.mjs` explicitly preserves this mirroring convention, so this is a judgment-call smell rather than a hard standards breach.

No other baseline smells found.

Disposition: no hard findings. The mirrored declarations are required by the existing stylesheet parity contract, so the reported duplication is retained; no hard finding was waived.

### Spec — raw report
Spec report — no findings.

(a) Missing or partial requirements: None identified in the pinned implementation diff. Channel rows use 12px block / 8px inline padding; thread rows use 16px block / 16px inline padding. The message-local prose rules set 14px and 68ch, with the specified channel/thread line heights and paragraph spacing; rendered-markup and stylesheet-mirror regressions were added.

(b) Changed behavior outside ticket scope: None identified. The global tokens and generic Markdown rules, transcript, activity digest, composer, thread data/call contract, and unrelated interactions are unchanged. The sequence color change is expressly authorized.

(c) Requirements implemented incorrectly: None identified. The 880px stream/composer width remains untouched; the horizontal insets remain 8px in channels and 16px in threads. Runtime geometry/overflow and the ticket’s validation-process evidence are not verifiable from this diff-only review.

Disposition: no implementation finding. Runtime geometry/overflow and validation-process evidence remain coordinator-owned; no runtime result is inferred from this source review.

### Coordinator-owned acceptance still pending
- Following coordinator direction, ticket status remains `claimed`/in progress; do not mark it resolved before coordinator-owned Ego-browser geometry/overflow evidence and G-impl are complete.
- Coordinator owns branch push and PR creation under the explicit no-third-party-action worker rule; PR number is pending. No live user data was used or modified, and no browser acceptance is claimed here.
