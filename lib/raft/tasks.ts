import { getDb } from "./db-singleton.ts";
import { getChannel, isChannelMember, resolveChannelForTarget, CURRENT_MEMBER_ID } from "./channels.ts";
import { getMember } from "./members.ts";
import { messageWithAuthor, summarizeChanges, type MessageWithAuthor } from "./messages.ts";
import type { ChannelRow, MemberRow, MessageRow, TaskRow, TaskStatus } from "../data/db.ts";

/**
 * 任务服务层（§3.7）：task = 消息 + 元数据。
 * - 创建：顶层消息可转（thread 内不可）；number 按 channel 内递增；
 * - 状态机：todo → in_progress(claim) → in_review(complete) → done(approve) / closed，
 *   unclaim/reject 回退，done/closed 可 reopen 回池；
 * - 重开封锁：reopen 置 reopened 标记——agent-loop 不可自动认领（blocked），
 *   人类（CURRENT_MEMBER_ID）认领即接管并清除标记；
 * - 互审："构建者不验证"——approve/reject 必须由非 owner 的 channel 成员执行；
 * - 并发保护：claim / updateStatus 均携带房间版本（channel max(seq)），
 *   事务内比对，不等返回 held（§6.3 与消息同语义）。
 */

export interface TaskView extends TaskRow {
  channelId: string;
  anchor: MessageWithAuthor;
  owner: MemberRow | null;
  /** §3.7 看板拖拽（ADR-0002）：以 actorId（默认人类 owner）从当前状态可发起的合法转移集合；todo 含 claim 边。 */
  reachable: TaskStatus[];
}

export type TaskClaimResult =
  | { status: "claimed"; task: TaskView }
  | { status: "held"; roomSeq: number; whatHappened: string }
  | { status: "conflict"; reason: string }
  | { status: "blocked"; reason: string };

export type TaskUpdateResult =
  | { status: "updated"; task: TaskView }
  | { status: "held"; roomSeq: number; whatHappened: string };

export class TaskAlreadyExistsError extends Error {
  constructor() {
    super("This message is already a task");
    this.name = "TaskAlreadyExistsError";
  }
}

export class InvalidTaskTransitionError extends Error {
  constructor(from: TaskStatus, to: TaskStatus) {
    super(`Invalid task transition: ${from} → ${to}`);
    this.name = "InvalidTaskTransitionError";
  }
}

export class TaskNotAuthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskNotAuthorizedError";
  }
}

/**
 * 状态机转移表（§3.7）：key = 当前状态，value = 可达状态 → 授权谓词。
 * clearOwner：转移后释放回池（unclaim/reopen）。
 * reopen：置 reopened 标记（重开封锁，§3.7）——agent-loop 不可自动认领，人类认领即清标。
 */
const TRANSITIONS: Record<
  TaskStatus,
  Partial<
    Record<
      TaskStatus,
      { authorized: (task: TaskRow, actorId: string) => boolean; clearOwner?: boolean; reopen?: boolean }
    >
  >
> = {
  todo: {},
  in_progress: {
    in_review: { authorized: (task, actorId) => task.owner_id === actorId },
    todo: { authorized: (task, actorId) => task.owner_id === actorId, clearOwner: true },
    closed: { authorized: () => true },
  },
  in_review: {
    done: { authorized: (task, actorId) => task.owner_id !== null && task.owner_id !== actorId },
    in_progress: { authorized: (task, actorId) => task.owner_id !== null && task.owner_id !== actorId },
    closed: { authorized: () => true },
  },
  done: {
    todo: { authorized: () => true, clearOwner: true, reopen: true },
  },
  closed: {
    todo: { authorized: () => true, clearOwner: true, reopen: true },
  },
};

/**
 * 看板拖拽的可达落点（§3.7/ADR-0002）：从当前状态、以 actorId 的身份可发起的合法转移。
 * 状态机转移表是唯一裁决者；todo 的 claim 是独立操作（claimTask），此处合成该边——
 * 重开封锁（reopened）下仅人类（CURRENT_MEMBER_ID）可认领，与 claimTask 的封锁一致。
 */
export function reachableStatuses(task: TaskRow, actorId: string): TaskStatus[] {
  const transitions = TRANSITIONS[task.status];
  const viaTable = (Object.keys(transitions) as TaskStatus[]).filter((to) =>
    transitions[to]!.authorized(task, actorId),
  );
  if (task.status !== "todo") return viaTable;
  const claimable = task.reopened === 1 ? actorId === CURRENT_MEMBER_ID : true;
  return claimable ? [...viaTable, "in_progress"] : viaTable;
}

function toTaskView(task: TaskRow, anchor: MessageRow, actorId: string = CURRENT_MEMBER_ID): TaskView {
  return {
    ...task,
    channelId: anchor.target_id,
    anchor: messageWithAuthor(anchor),
    owner: task.owner_id ? (getMember(task.owner_id) ?? null) : null,
    reachable: reachableStatuses(task, actorId),
  };
}

/** 任务所在 channel + 锚点消息；任务必须锚定在顶层消息（thread 内不可转，§3.7）。 */
function resolveTaskChannel(taskNumber: number, channelId: string): { channelId: string; task: TaskRow } {
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
function channelOfTask(task: TaskRow): { channel: ChannelRow; anchor: MessageRow } {
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
  return toTaskView(task, message);
}

/**
 * 认领（§3.7）：同一任务同时只有一个 owner；claim 即"我负责"。
 * 已认领（conflict）或房间变化（held）都不写入；claim 失败方让路。
 * 重开封锁：reopened 标记下仅人类（CURRENT_MEMBER_ID）可认领（= 接管并清标），
 * agent-loop 等非人类认领返回 blocked（§3.7 重开后不可自动认领）。
 */
export function claimTask(input: {
  channelId: string;
  taskNumber: number;
  memberId: string;
  baseSeq?: number;
}): TaskClaimResult {
  const { channelId, task } = resolveTaskChannel(input.taskNumber, input.channelId);
  assertChannelMember(channelId, input.memberId);

  return getDb().withTransaction(() => {
    const roomSeq = getDb().maxSeq(channelId);
    if (input.baseSeq !== undefined && input.baseSeq !== roomSeq) {
      return { status: "held" as const, roomSeq, whatHappened: summarizeChanges(channelId, input.baseSeq) };
    }
    const current = getDb().getTaskById(task.id);
    if (!current || current.owner_id !== null) {
      return { status: "conflict" as const, reason: "Task is already claimed" };
    }
    if (current.reopened === 1 && input.memberId !== CURRENT_MEMBER_ID) {
      return { status: "blocked" as const, reason: "Task was reopened — awaiting the owner" };
    }
    const updated = getDb().updateTask(current.id, {
      status: "in_progress",
      ownerId: input.memberId,
      reopened: 0,
    });
    if (!updated) return { status: "conflict" as const, reason: "Task is already claimed" };
    return { status: "claimed" as const, task: toTaskView(updated, getDb().getMessage(updated.message_id)!) };
  });
}

/**
 * 状态更新（§3.7）：按状态机表校验转移与授权；受 freshness-hold 保护。
 * unclaim（→todo）与 reopen（done/closed →todo）释放 owner 回池；
 * reopen 额外置 reopened 标记（重开封锁，人类认领时清标）。
 */
export function updateTaskStatus(input: {
  channelId: string;
  taskNumber: number;
  status: TaskStatus;
  memberId: string;
  baseSeq?: number;
}): TaskUpdateResult {
  const { channelId, task } = resolveTaskChannel(input.taskNumber, input.channelId);
  assertChannelMember(channelId, input.memberId);

  return getDb().withTransaction(() => {
    const roomSeq = getDb().maxSeq(channelId);
    if (input.baseSeq !== undefined && input.baseSeq !== roomSeq) {
      return { status: "held" as const, roomSeq, whatHappened: summarizeChanges(channelId, input.baseSeq) };
    }
    const current = getDb().getTaskById(task.id);
    if (!current) throw new Error("Task not found in this channel");

    const transition = TRANSITIONS[current.status]?.[input.status];
    if (!transition) throw new InvalidTaskTransitionError(current.status, input.status);
    if (!transition.authorized(current, input.memberId)) {
      if (current.status === "in_review") {
        throw new TaskNotAuthorizedError("The builder cannot verify their own work");
      }
      throw new TaskNotAuthorizedError("Only the task owner can do this");
    }
    const updated = getDb().updateTask(current.id, {
      status: input.status,
      ownerId: transition.clearOwner ? null : undefined,
      reopened: transition.reopen ? 1 : undefined,
    });
    if (!updated) throw new Error("Task not found");
    return { status: "updated" as const, task: toTaskView(updated, getDb().getMessage(updated.message_id)!) };
  });
}

/** channel 任务板（§3.7 视图）：按 number 升序；任务 thread 承载进展、board 只显示状态。 */
export function listChannelTasks(channelId: string): TaskView[] {
  const channel = getChannel(channelId);
  if (!channel) throw new Error("Channel not found");
  const tasks = getDb().listChannelTasks(channelId);
  const anchors = new Map<string, MessageRow>();
  for (const task of tasks) {
    const anchor = getDb().getMessage(task.message_id);
    if (anchor) anchors.set(task.message_id, anchor);
  }
  return tasks
    .map((task) => {
      const anchor = anchors.get(task.message_id);
      return anchor ? toTaskView(task, anchor) : null;
    })
    .filter((view): view is TaskView => view !== null);
}

export function getTaskView(id: string): TaskView {
  const task = getDb().getTaskById(id);
  if (!task) throw new Error("Task not found");
  const { anchor } = channelOfTask(task);
  return toTaskView(task, anchor);
}

/** 辅助：某 target（channel 或 thread 锚点）内的任务视图（agent-loop decide 语境复用）。 */
export function listTasksForTarget(targetId: string): TaskView[] {
  const channel = resolveChannelForTarget(targetId);
  if (!channel) return [];
  return listChannelTasks(channel.id).filter(
    (task) => task.anchor.id === targetId || task.anchor.target_id === targetId,
  );
}
