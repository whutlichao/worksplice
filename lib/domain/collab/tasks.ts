import { getDb } from "../../data/db-singleton.ts";
import {
  getChannel,
  isChannelMember,
  resolveChannelForTarget,
  CURRENT_MEMBER_ID,
} from "./channels.ts";
import { getMember } from "./members.ts";
import { isTaskStatusAuthority } from "./secretary-identity.ts";
import { notifyTaskCreated } from "./event-messages.ts";
import {
  messageWithAuthor,
  summarizeChanges,
  type MessageWithAuthor,
} from "./messages.ts";
import type {
  ChannelRow,
  MemberRow,
  MessageRow,
  TaskRow,
  TaskStatus,
} from "../../data/types.ts";
import { DomainError } from "../errors.ts";

/**
 * 任务服务层（§3.7）：task = 消息 + 元数据。
 * - 创建：顶层消息可转（thread 内不可）；number 按 channel 内递增；
 * - 状态机：todo → in_progress(claim) → in_review(complete) → done(approve) / closed，
 *   unclaim/reject 回退，done/closed 可 reopen 回池；
 * - 重开封锁：reopen 置 reopened 标记——非权威 agent 在权限复核处被拒（403），
 *   人类 Owner / 当前全局首席认领即接管并清除标记；
 * - 写权：只有人类 Owner 与当前全局首席可变更状态；互审作为讨论约定，不再另开写权限；
 * - 并发保护：claim / updateStatus 均携带房间版本（channel max(seq)），
 *   事务内比对，不等返回 held（§6.3 与消息同语义）。
 */

export interface TaskView extends TaskRow {
  channelId: string;
  anchor: MessageWithAuthor;
  owner: MemberRow | null;
  /** §3.7 看板拖拽（ADR-0002）：以 actorId（默认人类 owner）从当前状态可发起的合法转移集合；todo 含 claim 边。 */
  reachable: TaskStatus[];
  /** Task thread 中高于 Owner 已读游标的非 Owner 回复数。 */
  unreadReplyCount: number;
  /** Task thread 内全部回复数（所有作者，含 Owner；不含锚点；不受已读游标影响）。 */
  totalReplyCount: number;
  /** 最新一条未读回复的创建时间；没有未读回复时为 null。 */
  latestUnreadReplyAt: string | null;
  /**
   * 该 Task thread 的 Owner 已读游标（`task_thread_reads.read_seq`；无行时为 0）。
   * 读取面，不推进：线程面板的初始落点判定要用**打开那一刻**的游标。
   */
  taskThreadReadSeq: number;
}

export type TaskClaimResult =
  | { status: "claimed"; task: TaskView }
  | { status: "held"; roomSeq: number; whatHappened: string }
  | { status: "conflict"; reason: string }
  | { status: "blocked"; reason: string };

export type TaskUpdateResult =
  | { status: "updated"; task: TaskView }
  | { status: "held"; roomSeq: number; whatHappened: string };

export class TaskAlreadyExistsError extends DomainError {
  constructor() {
    super(409, "task_already_exists", "This message is already a task");
    this.name = "TaskAlreadyExistsError";
  }
}

export class InvalidTaskTransitionError extends DomainError {
  constructor(from: TaskStatus, to: TaskStatus) {
    super(400, "invalid_task_transition", `Invalid task transition: ${from} → ${to}`);
    this.name = "InvalidTaskTransitionError";
  }
}

export class TaskNotAuthorizedError extends DomainError {
  constructor(message: string) {
    super(403, "task_not_authorized", message);
    this.name = "TaskNotAuthorizedError";
  }
}

/** claim 边冲突（§3.7/ADR-0002）：错误自带 409（conflict/blocked，与 /claim 路由同语义同状态码），
 * 并把 `{ conflict } / { blocked } + reason` 作为兼容字段随响应出线（票 #277）。 */
export class TaskClaimConflictError extends DomainError {
  readonly kind: "conflict" | "blocked";
  constructor(kind: "conflict" | "blocked", message: string) {
    super(
      409,
      kind === "blocked" ? "task_claim_blocked" : "task_claim_conflict",
      message,
      kind === "blocked"
        ? { blocked: true, reason: message }
        : { conflict: true, reason: message },
    );
    this.name = "TaskClaimConflictError";
    this.kind = kind;
  }
}

/**
 * claim 前置判定（§3.7 认领封锁）：owner 唯一 + 重开封锁。
 * claimTask 与 updateTaskStatus 的 claim 边共用同一判定——单点维护，封锁条件增改不漂移
 * （终检整改：此前两处手工复刻，claimTask 加条件时 claim 边不会跟随）。
 */
function claimBlockReason(current: TaskRow): string | null {
  if (current.owner_id !== null) return "Task is already claimed";
  return null;
}

/**
 * 状态机转移表（§3.7）：key = 当前状态，value = 合法落点。
 * clearOwner：转移后释放回池（unclaim/reopen）。
 * reopen：置 reopened 标记（重开封锁，§3.7）——仅任务状态权威可认领接管并清标。
 *
 * 写权不在这张表里：`claimTask` / `updateTaskStatus` 已先复核 `isTaskStatusAuthority`。
 * 合法边仍是唯一裁决者；权威不能发明 done → in_progress 之类的非法转移。
 */
const TRANSITIONS: Record<
  TaskStatus,
  Partial<
    Record<
      TaskStatus,
      {
        clearOwner?: boolean;
        reopen?: boolean;
      }
    >
  >
> = {
  todo: {},
  in_progress: {
    in_review: {},
    todo: {
      clearOwner: true,
    },
    closed: {},
  },
  in_review: {
    done: {},
    in_progress: {},
    closed: {},
  },
  done: {
    todo: { clearOwner: true, reopen: true },
  },
  closed: {
    todo: { clearOwner: true, reopen: true },
  },
};

/** 状态机转移表的边集（#275 一致性测试 seam）：只暴露 from→to，不暴露授权谓词。 */
export function transitionEdges(): Array<{ from: TaskStatus; to: TaskStatus }> {
  return (Object.keys(TRANSITIONS) as TaskStatus[]).flatMap((from) =>
    (Object.keys(TRANSITIONS[from]) as TaskStatus[]).map((to) => ({
      from,
      to,
    })),
  );
}

/**
 * 看板拖拽的可达落点（§3.7/ADR-0002）：从当前状态、以 actorId 的身份可发起的合法转移。
 * 状态机转移表是唯一裁决者；todo 的 claim 是独立操作（claimTask），此处合成该边——
 * 重开封锁（reopened）下仅任务状态权威可认领，与 claimTask 的封锁一致。
 */
export function reachableStatuses(
  task: TaskRow,
  actorId: string,
): TaskStatus[] {
  // 状态写权先于边：非权威 actor 即使碰巧是 owner 也没有任何可达落点。
  if (!isTaskStatusAuthority(actorId)) return [];
  const transitions = TRANSITIONS[task.status];
  // 权威可管理任意 owner 的任务：合法边由转移表本身决定，owner / 互审谓词不再
  // 缩窄权威的可达集合（非法边仍由表缺失而无落点）。
  const viaTable = Object.keys(transitions) as TaskStatus[];
  if (task.status !== "todo") return viaTable;
  return [...viaTable, "in_progress"];
}

function toTaskView(
  task: TaskRow,
  anchor: MessageRow,
  actorId: string = CURRENT_MEMBER_ID,
  totalReplyCount?: number,
): TaskView {
  return {
    ...task,
    channelId: anchor.target_id,
    anchor: messageWithAuthor(anchor),
    owner: task.owner_id ? (getMember(task.owner_id) ?? null) : null,
    reachable: reachableStatuses(task, actorId),
    totalReplyCount:
      totalReplyCount ?? getDb().threadReplyCount(task.message_id),
    unreadReplyCount: getDb().countUnreadTaskThreadReplies(
      task.id,
      CURRENT_MEMBER_ID,
    ),
    latestUnreadReplyAt: getDb().latestUnreadTaskThreadReplyAt(
      task.id,
      CURRENT_MEMBER_ID,
    ),
    taskThreadReadSeq: getDb().getTaskThreadRead(task.id)?.read_seq ?? 0,
  };
}

/** 任务所在 channel + 锚点消息；任务必须锚定在顶层消息（thread 内不可转，§3.7）。 */
function resolveTaskChannel(
  taskNumber: number,
  channelId: string,
): { channelId: string; task: TaskRow } {
  const channel = getChannel(channelId);
  if (!channel) throw new Error("Channel not found");
  const task = getDb().getTaskByChannelNumber(channelId, taskNumber);
  if (!task) throw new Error("Task not found in this channel");
  return { channelId, task };
}

function assertChannelMember(channelId: string, memberId: string): MemberRow {
  const member = getMember(memberId);
  if (!member || member.deleted === 1) throw new Error("Member not found");
  if (!isChannelMember(channelId, memberId)) {
    throw new Error("You are not a member of this channel");
  }
  return member;
}

/** 任务落库所在 channel（锚点消息的 target 必为 channel id，§6.1）。 */
function channelOfTask(task: TaskRow): {
  channel: ChannelRow;
  anchor: MessageRow;
} {
  const anchor = getDb().getMessage(task.message_id);
  if (!anchor) throw new Error("Task anchor message not found");
  const channel = getChannel(anchor.target_id);
  if (!channel) throw new Error("Task channel not found");
  return { channel, anchor };
}

/**
 * 创建任务（§3.7 三途径共用）：消息必须存在、是顶层消息（target 为 channel）、
 * 尚未是任务；number = channel 内递增。消息本身由发送流程创建，任务只加元数据。
 */
export function createTask(input: { messageId: string }): TaskView {
  const message = getDb().getMessage(input.messageId);
  if (!message) throw new Error("Message not found");
  if (!getChannel(message.target_id)) {
    throw new Error("Only top-level messages can become tasks");
  }
  if (getDb().getTaskByMessageId(message.id)) {
    throw new TaskAlreadyExistsError();
  }
  // 事务内取号 + 落库：并发创建各自拿到不同的 number（§3.7 channel 内递增）
  const task = getDb().withTransaction(() => {
    if (getDb().getTaskByMessageId(message.id)) {
      throw new TaskAlreadyExistsError();
    }
    return getDb().insertTask({
      messageId: message.id,
      number: getDb().nextTaskNumber(message.target_id),
      status: "todo",
      ownerId: null,
    });
  });
  // §3.7 可认领信号：createTask 是三途径（右键 Convert to Task / 发送勾 As Task /
  // 板上 Create Task）的唯一收敛点，事件消息就落在这里 ⇒ 两条路径行为一致。
  // 板上途径因此会多出一条「任务已创建」事件消息（用户消息承载内容，事件消息承载
  // 「可认领了」这个信号）。两条 wake hint 同 (agent,target) 合并成**一轮**：driver 在
  // 出队前让出一个微任务（合并窗口，见 lib/agent-loop/loop.ts 的 processAgent 与
  // AGENTS.md「driver 编排」），于是第一轮 drain 一次取尽用户消息与事件消息、房间
  // 版本停在两条消息的 seq，claim 不被自己顶出的那条消息 hold。用例见 loop-tasks 的
  // 「board 途径……只跑一轮：第一轮 drain 两条消息并 claim 成功」。
  // 尽力而为：投递失败不影响已落库的任务。
  notifyTaskCreated(message.target_id, task.number, message.content);
  return toTaskView(task, message);
}

/**
 * 认领（§3.7）：同一任务同时只有一个 owner；claim 即"我负责"。
 * 已认领（conflict）或房间变化（held）都不写入；claim 失败方让路。
 * 重开封锁：reopened 标记下仅任务状态权威可认领（= 接管并清标），
 * 普通 agent 一律在权限复核处被拒绝（§3.7）。
 */
function claimTaskCore(input: {
  channelId: string;
  taskNumber: number;
  actorId: string;
  ownerId: string;
  baseSeq?: number;
}): TaskClaimResult {
  const { channelId, task } = resolveTaskChannel(
    input.taskNumber,
    input.channelId,
  );
  assertChannelMember(channelId, input.actorId);
  assertChannelMember(channelId, input.ownerId);
  if (!isTaskStatusAuthority(input.actorId)) {
    throw new TaskNotAuthorizedError(
      "Only the human Owner or current global chief can claim tasks",
    );
  }

  return getDb().withTransaction(() => {
    const roomSeq = getDb().maxSeq(channelId);
    if (input.baseSeq !== undefined && input.baseSeq !== roomSeq) {
      return {
        status: "held" as const,
        roomSeq,
        whatHappened: summarizeChanges(channelId, input.baseSeq),
      };
    }
    const current = getDb().getTaskById(task.id);
    if (!current)
      return { status: "conflict" as const, reason: "Task is already claimed" };
    const blockReason = claimBlockReason(current);
    if (blockReason) {
      return current.owner_id !== null
        ? { status: "conflict" as const, reason: blockReason }
        : { status: "blocked" as const, reason: blockReason };
    }
    const updated = getDb().updateTask(current.id, {
      status: "in_progress",
      ownerId: input.ownerId,
      reopened: 0,
    });
    if (!updated)
      return { status: "conflict" as const, reason: "Task is already claimed" };
    return {
      status: "claimed" as const,
      task: toTaskView(updated, getDb().getMessage(updated.message_id)!),
    };
  });
}

/**
 * 认领（§3.7）：同一任务同时只有一个 owner；只有任务状态权威能写。
 */
export function claimTask(input: {
  channelId: string;
  taskNumber: number;
  memberId: string;
  baseSeq?: number;
}): TaskClaimResult {
  return claimTaskCore({
    channelId: input.channelId,
    taskNumber: input.taskNumber,
    actorId: input.memberId,
    ownerId: input.memberId,
    baseSeq: input.baseSeq,
  });
}

/**
 * handoff 专用的代认领：actor 必须是任务状态权威，owner 可以是被指派的普通 agent。
 * 与 claimTask 共用唯一的事务 / owner 唯一性 / freshness 规则；不要让 handoff 另写 UPDATE。
 */
export function claimTaskForAssignee(input: {
  channelId: string;
  taskNumber: number;
  actorId: string;
  assigneeId: string;
  baseSeq?: number;
}): TaskClaimResult {
  return claimTaskCore({
    channelId: input.channelId,
    taskNumber: input.taskNumber,
    actorId: input.actorId,
    ownerId: input.assigneeId,
    baseSeq: input.baseSeq,
  });
}

/**
 * 状态更新（§3.7）：按状态机表校验转移与授权；受 freshness-hold 保护。
 * unclaim（→todo）与 reopen（done/closed →todo）释放 owner 回池；
 * reopen 额外置 reopened 标记（重开封锁，任务状态权威认领时清标）。
 */
export function updateTaskStatus(input: {
  channelId: string;
  taskNumber: number;
  status: TaskStatus;
  memberId: string;
  baseSeq?: number;
}): TaskUpdateResult {
  const { channelId, task } = resolveTaskChannel(
    input.taskNumber,
    input.channelId,
  );
  assertChannelMember(channelId, input.memberId);
  if (!isTaskStatusAuthority(input.memberId)) {
    throw new TaskNotAuthorizedError(
      "Only the human Owner or current global chief can change task status",
    );
  }

  return getDb().withTransaction(() => {
    const roomSeq = getDb().maxSeq(channelId);
    if (input.baseSeq !== undefined && input.baseSeq !== roomSeq) {
      return {
        status: "held" as const,
        roomSeq,
        whatHappened: summarizeChanges(channelId, input.baseSeq),
      };
    }
    const current = getDb().getTaskById(task.id);
    if (!current) throw new Error("Task not found in this channel");

    // §3.7/ADR-0002 claim 边：todo → in_progress 由 reachable 合成（看板拖拽落点），
    // 语义 = claimTask（owner 唯一 + 重开封锁，拖拽者成为 owner 并清标）——状态机转移表不重复该边；
    // 封锁判定与 claimTask 共用 claimBlockReason，冲突以 TaskClaimConflictError 抛出
    // （路由映射 409 conflict/blocked，与 /claim 同语义同状态码）。
    if (current.status === "todo" && input.status === "in_progress") {
      const blockReason = claimBlockReason(current);
      if (blockReason) {
        throw new TaskClaimConflictError(
          current.owner_id !== null ? "conflict" : "blocked",
          blockReason,
        );
      }
      const claimed = getDb().updateTask(current.id, {
        status: "in_progress",
        ownerId: input.memberId,
        reopened: 0,
      });
      if (!claimed) throw new Error("Task not found");
      return {
        status: "updated" as const,
        task: toTaskView(claimed, getDb().getMessage(claimed.message_id)!),
      };
    }

    const transition = TRANSITIONS[current.status]?.[input.status];
    if (!transition)
      throw new InvalidTaskTransitionError(current.status, input.status);
    const updated = getDb().updateTask(current.id, {
      status: input.status,
      ownerId: transition.clearOwner ? null : undefined,
      reopened: transition.reopen ? 1 : undefined,
    });
    if (!updated) throw new Error("Task not found");
    return {
      status: "updated" as const,
      task: toTaskView(updated, getDb().getMessage(updated.message_id)!),
    };
  });
}

/**
 * channel 任务板（§3.7 视图）：按 number 升序；任务 thread 承载进展、board 只显示状态。
 * actorId 决定 `reachable`；HTTP 人类面沿用默认 Owner，agent-loop / 测试可传 agent id。
 */
export function listChannelTasks(
  channelId: string,
  actorId: string = CURRENT_MEMBER_ID,
): TaskView[] {
  const channel = getChannel(channelId);
  if (!channel) throw new Error("Channel not found");
  const tasks = getDb().listChannelTasks(channelId);
  const replyCounts = getDb().threadReplyCounts(
    tasks.map((task) => task.message_id),
  );
  const anchors = new Map<string, MessageRow>();
  for (const task of tasks) {
    const anchor = getDb().getMessage(task.message_id);
    if (anchor) anchors.set(task.message_id, anchor);
  }
  return tasks
    .map((task) => {
      const anchor = anchors.get(task.message_id);
      if (!anchor) return null;
      return toTaskView(
        task,
        anchor,
        actorId,
        replyCounts.get(task.message_id) ?? 0,
      );
    })
    .filter((view): view is TaskView => view !== null);
}

export function getTaskView(
  id: string,
  actorId: string = CURRENT_MEMBER_ID,
): TaskView {
  const task = getDb().getTaskById(id);
  if (!task) throw new DomainError(404, "task_not_found", "Task not found");
  const { anchor } = channelOfTask(task);
  return toTaskView(task, anchor, actorId);
}

export interface TaskThreadReadView {
  baselineSeq: number;
  readSeq: number;
  unreadReplyCount: number;
}

/** 把单个 Task 的已读位置推进到已呈现序号之前最近的非 Owner 回复。 */
export function markTaskThreadRead(input: {
  taskId: string;
  throughSeq: number;
}): TaskThreadReadView {
  if (!Number.isSafeInteger(input.throughSeq) || input.throughSeq < 0) {
    throw new Error("throughSeq must be a non-negative integer");
  }
  const task = getDb().getTaskById(input.taskId);
  if (!task) throw new DomainError(404, "task_not_found", "Task not found");
  const position = getDb().advanceTaskThreadRead(
    task.id,
    input.throughSeq,
    CURRENT_MEMBER_ID,
  );
  if (!position) throw new Error("Task thread read position not found");
  return {
    baselineSeq: position.baseline_seq,
    readSeq: position.read_seq,
    unreadReplyCount: getDb().countUnreadTaskThreadReplies(
      task.id,
      CURRENT_MEMBER_ID,
    ),
  };
}

/** 辅助：某 target（channel 或 thread 锚点）内的任务视图（agent-loop decide 语境复用）。 */
export function listTasksForTarget(
  targetId: string,
  actorId: string = CURRENT_MEMBER_ID,
): TaskView[] {
  const channel = resolveChannelForTarget(targetId);
  if (!channel) return [];
  return listChannelTasks(channel.id, actorId).filter(
    (task) => task.anchor.id === targetId || task.anchor.target_id === targetId,
  );
}
