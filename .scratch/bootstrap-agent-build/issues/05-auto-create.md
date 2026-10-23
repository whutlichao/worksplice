# 05 — 首次启动自动创建

**What to build:** 启动路径（instrumentation，agent-loop 启动之后）自动"确保 Susan 存在"（spec §6.1、交付清单 §8.1-1）：幂等判定 = 名字 "Susan" 全等且含软删标记（存活或已删除均算"已存在"→ 不创建）；仅完全不存在时自动创建（走 04 完整初始化流程）。defaultModel 为 null（模型未配置）→ 跳过自动创建、记服务端日志、不阻塞启动；失败不致命（与 startAgentLoop 同款纪律）。删除后不自动重建（判定含软删行）。

**Blocked by:** 04 — 秘书初始化流程

**Status:** resolved（2026-10-23）

- [x] 首次启动自动创建 Susan，走 04 完整初始化流程（身份 + 手册 + 频道覆盖 + 办公室频道 + 欢迎语）
- [x] 重复启动不重建（名字全等判定）
- [x] 删除（soft-delete）后不自动重建
- [x] defaultModel 为 null → 跳过 + 服务端日志，启动不报错、不阻塞
- [x] 自动创建失败不致命（记日志，用户侧可见信号 = 成员列表无 Susan + 06 的启动助手入口）

## Answer

**结论**：完成（2026-10-23 复核；本票为只读审计，未改源码）。

**证据**：
- 启动顺序：`instrumentation.ts:34-51` 先 `createAgentLoop().start()`，再 `.then(() => autoCreateSecretary())`，两段各自 `catch` 记日志、不阻塞。
- 幂等与软删：`lib/domain/collab/secretary-auto-create.ts:60` `autoCreateSecretary`、`:65-66` `getMemberByName`（含 `deleted=1` 行）命中即 `{ created:false, reason:"exists" }`；测试 `secretary-auto-create.test.mjs:112`、`:151`、`:165`。
- 完整初始化：`:77` `initSecretaryFlow`；`lib/domain/collab/secretary-init.ts:75` 身份 + 手册 + 频道覆盖 + `secretary-office` 幂等创建（`:111-125`）+ 欢迎事件；测试 `secretary-auto-create.test.mjs:112`、E2E `secretary-e2e.test.mjs:154`。
- defaultModel 为 null：`secretary-auto-create.ts:68-75` 跳过 + 服务端日志；测试 `secretary-auto-create.test.mjs:80`、E2E `secretary-e2e.test.mjs:132`。
- 失败不致命：`instrumentation.ts:47-51` catch 后只记日志；契约测试 `secretary-auto-create.test.mjs:97`。

**偏差**：无。

**验证方式**：只读审计（未改源码），核对上述实现与测试文件。本票零源码改动，故未跑 npm test / tsc / lint。
