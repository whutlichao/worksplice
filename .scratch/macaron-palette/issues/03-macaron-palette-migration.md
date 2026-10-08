# 03: 马卡龙迁移——调用点读到对的那一档（migrate）

**What to build:** 界面里凡是**用颜色说话**的地方都读到对的那一档——正文与链接走文字档、焦点环与状态点走图形档、填充走填充档。改完之后肉眼能分辨「行动 / 选中 / 未读 / 警示」四种状态各有自己的色相，且每一处都清晰可读（对比度达标）。

**Blocked by:** 02（**同一 PR 内满足**：两票必须同批合入，见票 02 的最后一条）

**Status:** ready-for-agent

- [ ] 约 100 处 accent 族文字 / 图形调用点改指 `-deep` / `-graphic`（清单与判据见 spec 的「消费点账」）
- [ ] 7 处 `--accent-line` → `-graphic`；约 20 处 on-accent 字面量 → `var(--on-accent)`；约 14 处 error 填充 → `--error-fill`
- [ ] 四态状态点 → 各族的图形档；`.meter.warn` / `.lv.warn` → `--warn*`；`--online-text` / `--working-text` 改实值
- [ ] 既有断言按**意图**改写（spec 的 Testing Decisions 表里标「按意图改写」的逐条登记，每条写明「为什么这条断言该改」）
- [ ] 红→绿证据：改动前能指认到的失明/不达标项 → 改动后达标（用实测对比度，不用推断）
- [ ] 交付前把 spec「消费点账」的口径重跑一遍（逐文件计数），若与 216 = 78 + 138 有出入，在 Answer 里如实记录差异
- [ ] 双轴 code-review（Standards + Spec 两份报告，不合并）+ Answer 小节
- [ ] 推分支后**并入票 02 的同一 PR**（同批交付），PR 号回填 Answer
