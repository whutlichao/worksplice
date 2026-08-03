# Issue 追踪：本地 Markdown

本仓库的 issues 与 spec（即 PRD）以 Markdown 文件形式存放在 `.scratch/` 下。

## 约定

- 每个功能一个目录：`.scratch/<feature-slug>/`
- spec 位于 `.scratch/<feature-slug>/spec.md`
- 实现 issues 以每个 ticket 一个文件的形式存放在 `.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 开始编号——绝不使用单个合并的 tickets 文件
- Triage 状态以 `Status:` 行记录在每个 issue 文件顶部附近（角色字符串见 `triage-labels.md`）
- 评论与对话历史追加到文件底部的 `## Comments` 标题下

## 当 skill 要求"发布到 issue 追踪器"

在 `.scratch/<feature-slug>/` 下创建新文件（必要时先创建目录）。

## 当 skill 要求"获取相关 ticket"

读取指定路径下的文件。用户通常会直接传入路径或 issue 编号。

## 路径导航操作

由 `/wayfinder` 使用。**map** 是一个文件，每个 ticket 对应一个**子文件**。

- **Map**：`.scratch/<effort>/map.md` — Notes / Decisions-so-far / Fog 正文
- **子 ticket**：`.scratch/<effort>/issues/NN-<slug>.md`，从 `01` 开始编号，问题写在正文中。用 `Type:` 行记录 ticket 类型（`research`/`prototype`/`grilling`/`task`）；用 `Status:` 行记录 `claimed`/`resolved`
- **阻塞**：靠近文件顶部的 `Blocked by: NN, NN` 行。当它列出的每个文件都是 `resolved` 时，ticket 解除阻塞
- **前沿（frontier）**：扫描 `.scratch/<effort>/issues/` 查找开放、未阻塞且未认领的文件；编号小的优先
- **认领**：开始工作前将 `Status` 设为 `claimed` 并保存
- **解决**：在 `## Answer` 标题下追加答案，将 `Status` 设为 `resolved`，然后在 `map.md` 的 Decisions-so-far 中追加上下文指针（gist + 链接）
