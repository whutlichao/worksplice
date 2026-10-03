/**
 * 协作域单索引模块（Ticket 04 Extract Raft Domain）。
 *
 * 对外唯一导入面：消费方只 `import { ... } from "@/lib/domain/collab"`（或相对路径
 * `../domain/collab/index.ts`），不再逐个导入子域文件——app/api 路由、agent-loop、
 * agent-status/lifecycle/runtime、instrumentation 全部收敛到这里。
 *
 * 子域实现（channels/members/messages/tasks/…）是内部模块，互相之间仍用相对路径
 * 直接引用（避免经索引回环）；本索引只负责把全部公共 API 汇成一个 seam，测试可在
 * 一处 mock 整个 协作域。
 *
 * 说明：
 * - `MessageWithAuthor`（messages.ts）与 `extractMentionedMemberIds`（members.ts）
 *   同时被子模块 inbox.ts / wake.ts 原样 re-export——同名同绑定，`export *` 汇合不歧义。
 * - `getDb(): Store` 不在此面：db-singleton 属数据层（`lib/data/db-singleton.ts`），
 *   业务代码需要 DB 时从那里取。
 */
export * from "./attachments.ts";
export * from "./channels.ts";
export * from "./event-messages.ts";
export * from "./inbox.ts";
export * from "./members.ts";
export * from "./messages.ts";
export * from "./observability.ts";
export * from "./pinned.ts";
export * from "./reactions.ts";
export * from "./reads.ts";
export * from "./recurrence.ts";
export * from "./reminders.ts";
export * from "./rounds.ts";
export * from "./search.ts";
export * from "./secretary-auto-create.ts";
export * from "./secretary-init.ts";
export * from "./tasks.ts";
export * from "./wake.ts";
