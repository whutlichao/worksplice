# 01 — Pinned 消息定位高亮

Type: task
Status: claimed

## Problem Statement

从 pinned 列表点击当前频道主消息流消息时，滚动定位已有，但目标行缺少明确的短暂视觉反馈。

## Solution

遵循 `.scratch/pinned-message-highlight/spec.md`：保留定位；给主消息流目标行加短暂高亮，并在重复点击时重启高亮；thread pinned 项继续只打开右栏线程。

## Acceptance

- 仅修改本行为所需的 `ChannelView`、对应样式、测试与本票文档。
- 先新增紧贴问题的回归测试并证明红，再实现并证明绿；断言产品渲染出的目标行样式，而非只查 class 字符串。
- 验证重复点击会重新开始/延长高亮且到期后自动消退；thread pinned 项行为不变。
- 跑对应精确测试、`node_modules/.bin/tsc --noEmit`、`npm run lint`；不跑全量测试、不运行 `next build`。
- 用 ego-browser 在隔离的临时数据目录中验证真实页面，不触碰用户数据，并保存可核验截图。
- Answer 记录红绿、验证、浏览器证据、Standards 与 Spec 两份原始 review 及 finding 处置；记录文件清单与 PR 号；完成后 `Status: resolved`。
