# 01: 判定 pi 配置根的两档故障（未初始化 / 无凭证），按档修复并送进 provider 配置

**Spec:** [spec.md](../spec.md)

**Type:** task

**Status:** ready-for-agent

**Blocked by:** None — can start immediately.

## What to build

让「pi 配置根没起来」这件事**在用户卡住的地方说出来**，并且按档给出不同动作：

- **P1 环境未初始化**（agentDir 缺失 / 不可读 / settings 读取抛错 / **settings 读出为空**）
  → 一键初始化 `~/.pi/agent` 骨架（**已存在文件逐字节不动**、幂等、不装任何 CLI），
  然后把用户送到 provider 登录 / 配 key。
- **P2 无可用凭证**（模型面读不出任何带凭证可用的模型）→ 不动目录，只把用户送到既有 provider 面。

判定层是脱离 HTTP 与渲染层的纯逻辑（输入 = 目标目录 + 可注入的文件系统与模型面探测），
两个薄封装入口只做参数校验与错误映射，提示落在两处：侧栏配置区常驻状态条（与 `Models`/`Skills`
同层）+ `ModelsConfig` 顶部入口。**优先级**：P1 成立只报 P1；否则 P2 成立只报 P2；
都不成立则提示面渲染 `null`（存量用户零感知）。

判据是「读出来的状态，不枚举文件是否存在」：`auth.json` 在、`models.json` 不在、模型可用的环境
**不得**被判成 P1；用环境变量提供 key 的环境**不得**被判成 P2。

## Acceptance

- [ ] 判定层是纯逻辑（不 import React / Next，P1 路径不写盘）：**P1 五条**各一条用例——
      目录缺失 / 不可读 / settings 读抛错 / **空目录（最承重）** / 正常环境。
      空目录那条同时断言「跑完目录仍为空」（检测不改环境）。
- [ ] **P2 三条**用例：模型面空列表 ⇒ P2；模型列表里 provider 全未配置凭证 ⇒ P2；
      **反例：凭证来自环境变量 ⇒ P2 不成立**（对应 spec 决策 1 的反例行）。
- [ ] **优先级三条**：P1∧P2 ⇒ 只出 P1；¬P1∧P2 ⇒ 只出 P2；¬P1∧¬P2 ⇒ 无结论（提示面渲 `null`）。
- [ ] 初始化动作三条：空目录跑一次骨架齐；**预置内容的文件跑完逐字节相同**；
      连跑两次第二次改动清单为空（幂等）。动作只碰目标目录。
- [ ] 初始化**不执行** `npm i -g`、不改 PATH、不下载任何东西；`package.json` 的 `bin` 零 diff。
- [ ] 两个入口只做参数校验 / 错误映射 / JSON 编码；不可写等失败返回可读错误而非空 500。
- [ ] 侧栏配置区状态条在 P1 / P2 两种环境下各给出对应动作；正常环境下渲染 `null`
      （渲染层断言 + 浏览器三态实测截图）。
- [ ] `ModelsConfig` 顶部有同一入口；P1 初始化成功后落到 provider 登录 / 配 key，且状态条文案
      给出下一步（不是无声消失）。
- [ ] 判定结论不落库、不缓存（每次都现算）：环境会在外部被改变（装 CLI、改环境变量）。
- [ ] 测试不指向真实 `~/.pi/agent`（临时目录 + 注入 adapter）；不得用 `ModelRuntime.create`
      去测 P1（它会补建 `auth.json` / `models-store.json` 空壳，污染「空目录」夹具）。
- [ ] `npm test` 全量、`tsc --noEmit`、`npm run lint` 读数与改前基线对照。
- [ ] Standards + Spec 双轴 code-review 结论写入 `## Answer`（改了源码，双轴适用）。

## Out of scope（本票明确不做）

- 不 `npm i -g` 任何 CLI，不改 PATH，不改 `package.json` 的 `bin`。
- 不迁移/修复**已存在但内容损坏**的配置文件；只判定并按档补缺。
- 不解决「本机独立安装的 `pi`（1.5.2）与内置 0.99.2 共享 `~/.pi/agent`」的版本共存问题，
  只在文案里告知。
- 不新造登录 / 凭证流程（复用既有 provider 面），不引入第二份配置源，不改配置根位置。
- 不做首启向导全流程（那是 `docs/spec-bootstrap-agent.md` §6.3 的语义）。
- 不做「骨架文件是否存在」的枚举式判定（决策 1 的取舍）。
- 不做遥测、不做自动更新 SDK、不覆盖用户已有配置（这一条再写一次）。

## 票据协议（worker 必读）

- 开工直接干，不用改本文件；完工后 append `## Answer`，并把 `Status:` 流转到 `resolved`。
- 提问通道一律 `orca orchestration ask`，禁 AskUserQuestion。
- 决策 1 的判据已由 coordinator 裁决为「两档独立判据（C 改良）」，spec 的 Further Notes 有裁决记录。
  实施时若发现 `P1(d)` 会误伤某类真实用户，**先 ask** 再改判据口径，不许默默改。
- 本票**跑**：`npm test` / `tsc --noEmit` / `npm run lint` / 浏览器三态实测 / 双轴 code-review。
