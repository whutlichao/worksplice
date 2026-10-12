/**
 * 面板转移规则（ticket 13）：中央（频道）与面板（agent | human | thread）状态解耦后的纯状态模块。
 *
 * 面板是"非长驻单槽 dock"：任何内容互斥（单槽替换），关闭即 null，
 * 切换频道即清空（面板与中央频道无耦合——线程打开时中央保持当前频道）。
 *
 * 除转移外，本模块还持有一条跨面板/中央的规则：
 * - `memberPanel`：mention/成员入口 → 面板内容的映射（agent 与人类走同一容器）。
 *
 * 线程面板的初始滚动落点（`.scratch/thread-open-scroll/`）也落在这里，拆成两块：
 * - `threadPanel`：线程打开**唯一装配点**——Task 上下文（taskId + 打开时刻的已读游标快照）
 *   从这一处进面板内容，消费点只是转手；
 * - `threadInitialScroll` / `applyThreadInitialScroll`：**判定**与**应用**分家的 seam。
 *   判定是纯的（replies + taskId + readSeq → 结论），应用才碰滚动容器，
 *   所以落点规则可以脱离 DOM 断言。
 *
 * `panel-state.ts` 有两类消费者，两类都是纯的（无事件总线、无 I/O）：
 * - `AppShell` 消费面板转移规则（`openPanel` / `closePanel` / `onChannelSwitched`）与
 *   `memberPanel` / `threadPanel` 两个装配点；
 * - `ThreadPanel` 消费 `threadInitialScroll`（判定，纯函数）与 `applyThreadInitialScroll`
 *   （应用，只写注入的 `ThreadScrollPort`——本模块唯一触容器的一侧，容器由调用方提供）。
 */

// 相对路径（不用 `@/` 别名）：本文件被 `lib/panel-state.test.mjs` 直接经 node:test 加载，
// 裸 Node 不认 tsconfig paths（jiti 会认）。schema.ts 对 better-sqlite3 只有 `import type`，
// 运行时不拉任何依赖，client 安全。
import { OWNER_MEMBER_ID } from "./data/schema.ts";

export type PanelContent =
  | { kind: "agent"; id: string }
  | { kind: "human"; id: string }
  | {
      kind: "thread";
      id: string;
      taskId?: string;
      /**
       * 打开这一刻的 Task thread 已读游标（`task_thread_reads.read_seq`）快照。
       * 刻意读在**打开之前**并以快照进入面板：面板打开后前台自动标读会把游标推过去，
       * 那时再查就永远「无未读」，未读落点再也算不出来。缺失 = 拿不到快照（缓存里没有该 Task）
       * ⇒ 判定退到底部，不猜。
       */
      taskReadSeq?: number;
    }
  | null;

/** 成员入口 → 面板内容：人类与 agent 同走右栏（§3.2 mention / 成员面板共用）。 */
export function memberPanel(memberId: string, isHuman: boolean): NonNullable<PanelContent> {
  return isHuman ? { kind: "human", id: memberId } : { kind: "agent", id: memberId };
}

/** 线程打开唯一装配点：普通 thread 交回面板外壳，Task thread 连同已读游标快照一并交回。 */
export function threadPanel(
  anchorId: string,
  task?: { id: string; readSeq?: number } | null,
): NonNullable<PanelContent> {
  if (!task) return { kind: "thread", id: anchorId };
  return {
    kind: "thread",
    id: anchorId,
    taskId: task.id,
    ...(typeof task.readSeq === "number" ? { taskReadSeq: task.readSeq } : {}),
  };
}

/**
 * 线程面板的初始滚动落点（判定，纯函数）。
 *
 * 未读口径与 `countUnreadTaskThreadReplies` 同一份：**作者非 Owner 且 seq 大于已读游标**
 * （所以 Owner 自己的回复既不成为落点，也不让结论变成 unread）。落点是**最早**一条未读回复，
 * 不是最新一条——更早的已读历史要留在窗口上方可上翻。
 *
 * 无 taskId（普通 thread）、无游标快照、无未读回复，三种情况一律 bottom。
 */
export type ThreadScrollTarget = { kind: "unread"; seq: number } | { kind: "bottom" };

export function threadInitialScroll(input: {
  replies: Array<{ seq: number; author_id: string }>;
  taskId?: string;
  /** Task thread 的已读游标；`undefined` = 没有快照（不猜，退到 top-safe 的 bottom）。 */
  readSeq?: number;
  /** Owner 身份（未读口径的排除对象），默认 `OWNER_MEMBER_ID`（本地单机形态，同 CURRENT_MEMBER_ID）。 */
  ownerId?: string;
}): ThreadScrollTarget {
  const ownerId = input.ownerId ?? OWNER_MEMBER_ID;
  const readSeq = input.readSeq;
  if (!input.taskId || typeof readSeq !== "number") return { kind: "bottom" };
  const earliestUnread = input.replies
    .filter((reply) => reply.author_id !== ownerId && reply.seq > readSeq)
    .reduce<number | null>(
      (earliest, reply) => (earliest === null || reply.seq < earliest ? reply.seq : earliest),
      null,
    );
  return earliestUnread === null ? { kind: "bottom" } : { kind: "unread", seq: earliestUnread };
}

/** 落点应用所需的最小结构子集（真容器与测试假容器都满足；不读真实布局）。 */
export interface ThreadScrollPort {
  scrollTop: number;
  scrollHeight: number;
  /**
   * 把某条回复行贴到滚动区顶部所需的 scrollTop（= 行相对滚动区**内容**顶部的偏移）；
   * 该行不在当前渲染里时返回 null。应用侧只消费这个值，公式由容器实现方负责。
   */
  replyRowOffset(seq: number): number | null;
}

/**
 * 落点应用：unread → 把那条行顶到滚动区顶部；bottom → 贴内容底。
 * 行找不到（不在当前页/还没挂上）或容器不在时一律退到 bottom——
 * 退化成「停在顶部」会让用户误以为这条 thread 没有新回复。
 */
export function applyThreadInitialScroll(
  port: ThreadScrollPort | null | undefined,
  target: ThreadScrollTarget,
): void {
  if (!port) return;
  if (target.kind === "unread") {
    const offset = port.replyRowOffset(target.seq);
    if (offset !== null) {
      port.scrollTop = offset;
      return;
    }
  }
  port.scrollTop = port.scrollHeight;
}

/** 单槽替换：任何内容互斥，id 透传；null 上打开正常。 */
export function openPanel(state: PanelContent, next: NonNullable<PanelContent>): PanelContent {
  void state;
  return next;
}

/** 关闭面板：null → null 幂等。 */
export function closePanel(_state: PanelContent): PanelContent {
  void _state;
  return null;
}

/** 切换频道：清空面板（线程草稿/分页/详情 in-flight 数据一并丢弃）。 */
export function onChannelSwitched(_state: PanelContent): PanelContent {
  void _state;
  return null;
}
