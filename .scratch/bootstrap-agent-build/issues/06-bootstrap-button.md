# 06 — 启动助手入口

**What to build:** CreateAgentModal 内「创建启动助手」按钮（spec §6.3、交付清单 §8.2-1）：显示条件 = 成员列表无存活 Susan（删除后仍显示 = 手动重建入口）；点击行为——模型已配置 → 直接创建并走 04 完整初始化流程；模型未配置 → 引导打开模型配置弹窗，配置完成后再点即可创建。与普通"创建 agent"表单并列互不干扰。注：当前 `GET /api/members` 返回含软删成员（服务层未过滤 deleted），"无存活 Susan"判定需过滤软删（客户端过滤或最小服务层调整，构建 effort 自定，零机制改动）。

**Blocked by:** 04 — 秘书初始化流程

**Status:** resolved

- [x] 无存活 Susan → 按钮显示；有存活 Susan → 不显示
- [x] 删除 Susan 后按钮仍显示（重建入口）
- [x] 模型未配置时点击 → 引导打开模型配置；配置完成后再点 → 创建成功并走 04 初始化
- [x] 模型已配置时点击 → 直接创建（复用 04，不重复实现初始化）
- [x] 普通创建 agent 表单不受按钮影响，可建任意 agent（含与 Susan 同名的手动边角）

## Answer

**服务端**：`app/api/secretary/init/route.ts` 新增 `POST`（启动助手入口，app/api 仅薄封装）：解析可选 provider/modelId/thinkingLevel（缺省 null 继承全局默认）→ 调 04 的 `initSecretaryFlow`（§6.2 完整初始化流程，幂等可重跑），201 返回成员行，错误 400。

**纯判定 seam**（`lib/secretary-bootstrap.ts`，仅 type import 运行时零依赖，node:test 直测）：
- `hasLiveSusan(agents)`：名字全等 + agent 类型 + 未软删。注：`GET /api/members` 的 agents 经 DB `listMembers()` 已过滤软删（04/05 落地时已覆盖），此处按 `deleted` 字段再防御一次使判定自足。
- `resolveBootstrapModel(models)`：创建模型判定与表单 ModelPicker 预选同规则（`defaultKey ?? options[0]`）——`defaultModel` 存在、成对**且在 modelList 中** → 用之；否则 `modelList` 非空 → 取首个可见模型；完全无可用模型 → null → 引导打开 ModelsConfig。兜底场景（settings 显式默认与 API defaultModel 不一致时 API 恒返 null，如 defaultProvider 未解析到可见模型）下仍可建，避免"配置已就绪却引导去配置"的死循环；该兜底与 ticket 05 自动创建"须显式默认"的刻意偏差互补——按钮是显式用户动作，欠创建不安全的理由不适用（code-review 双轴确认，Spec 轴记为例外偏差）。

**UI**：CreateAgentModal 新增 `agents` + `onOpenModelsConfig` props；无存活 Susan 时表单上方渲染启动助手区块（黄色按钮 + 提示），点击——`resolveBootstrapModel` 有模型 → `POST /api/secretary/init` → `onCreated`（关弹窗 + 刷新成员列表）；无模型 → `onOpenModelsConfig`（AppShell 关 agent 弹窗、开模型配置，配置后重开再点即建）。普通表单零改动。i18n：`agent.bootstrap` / `agent.bootstrapHint`（zh + en）。

**配套**：`lib/secretary-bootstrap.test.mjs` 7 条（存活判定 / 软删不算 / default 可见优先 / default 不可见回落首个 / 首个可见兜底 / 全无 → 引导 / 畸形对拒绝）；`lib/raft/secretary-route.test.mjs` 1 条（路由接线，源检视约定，参数解析逐字段断言）。浏览器实测闭环：无 Susan → 按钮显示 → 点击创建（身份 + 手册 + 频道覆盖 + 办公室频道复用 + Owner 署名欢迎事件）→ 按钮消失；删除身份 → 按钮复现 → 再点重建（新身份、办公室不重复建）。code-review 双轴整改：default 对须在 modelList 中才采用（与表单预选完全一致）、route 测试断言收紧至解析表达式、`BootstrapModelEntry` 冗余类型删除改 `Pick<ModelsData,…>`；保留项——`hasLiveSusan` 与 `findSusanMember` 语义等价（服务端 listAgents 已按 agent 类型过滤，客户端 deleted 为防御）、fetch 错误形状沿用仓库既有 idiom。类型检查（tsc --noEmit）0 错误、eslint 0 错误 0 警告；全量测试 531/532 绿（1 失败为既有环境性 `skill-lock.test.mjs`，与本次无关）。
