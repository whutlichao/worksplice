# Issue 追踪：GitHub

本仓库的 issues 与 spec（即 PRD）是 `whutlichao/worksplice` 的 GitHub issues。所有操作走 `gh` CLI。

## 约定

- **创建 issue**：`gh issue create --title "..." --body "..."`。多行 body 用 heredoc。
- **读取 issue**：`gh issue view <number> --json number,title,body,labels,comments`。
- **列出 issue**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，按需加 `--label` / `--state`。
- **子 issue**：`gh issue create --parent <parent> ...`，或之后 `gh issue edit <parent> --add-sub-issue <child>`（gh ≥ 2.94）。
- **阻塞**：GitHub 原生 issue 依赖——`gh issue create --blocked-by <n>,<n>` / `gh issue edit <child> --add-blocked-by <blocker>`。不可用时退回 body 顶部 `Blocked by: #<n>, #<n>`；所有 blocker 关闭即解除阻塞。
- **统计未关闭的 blocker**：`gh api repos/whutlichao/worksplice/issues/<n> --jq .issue_dependencies_summary.blocked_by`（只看 open，0 表示可开工）。`gh issue view <n> --json blockedBy` 含已关闭项，要过滤。
- **评论**：`gh issue comment <number> --body "..."`。
- **打 / 去标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`。
- **关闭**：先 `gh issue comment` 写说明，再 `gh issue close <number>`。已关闭的 issue 上 `gh issue close --comment` 会吞掉评论但仍返回 0。

`gh` 在 clone 内自动推断仓库；本仓库唯一目标 `whutlichao/worksplice`。发起 create 前先 `gh repo view --json nameWithOwner` 复核，不一致就问。

## PR 是否作为 triage 入口

**否。**（`/triage` 读这个开关。若将来要把外部 PR 当需求收，改成"是"并补 `gh pr` 用法。）

## 当 skill 要求"发布到 issue 追踪器"

创建一个 GitHub issue。

## 当 skill 要求"获取相关 ticket"

按上面「读取 issue」读。

## 本仓库落地约定

- **effort = 一个 spec issue**：标题 `spec: <effort>`，label `spec`，body 用 repo effort 模板（Problem Statement / Solution / User Stories / Implementation Decisions / Testing Decisions / Out of Scope / Further Notes）。
- **ticket = spec issue 的 sub-issue**：triage 状态用 label（见 `triage-labels.md`），不再用 `Status:` 行。
- **认领**：`gh issue edit <n> --add-assignee @me`（worker 的第一次写）。
- **解决**：`gh issue comment <n> --body "<Answer>"` → `gh issue close <n>`。
- **`.scratch/` 存量**：59 个 effort / 180 个票据文件冻结为历史存档（含设计记录，仍可被引用为历史依据），不再新增、不迁移到 issues。
