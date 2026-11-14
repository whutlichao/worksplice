import type { TaskStatus } from "../../data/types.ts";

/**
 * 模型调用前的轮次准入（Ticket #237）：纯判定层。
 *
 * 调用方在 drain 之后、startSession / prompt 之前把现场快照交进来；本模块只回答
 * 「这一轮该不该起会话 / 起谁」，不读写数据库、不发 wake、不动游标。
 * 未准入的 reason 是稳定契约（测试与可观测直接断言字符串）。
 */
export const ROUND_SKIP_REASONS = {
  noInvitation: "no human mention and no attributable task",
  notMember: "not a member of the channel",
  taskOwnerOnly: "task in progress — only its owner may continue",
  taskReviewerNotInvited: "task in review — reviewers require a human mention",
  taskUnclaimed: "task is unclaimed — no automatic round",
  taskDoneOrClosed: "task is done or closed — no automatic round",
  taskReopened: "task was reopened — awaiting the human owner",
  taskEventHandoffOnly:
    "task event — only the secretary handles unclaimed tasks",
  handoffNotTriggered:
    "no unique unclaimed task is associated with this round",
} as const;

export type RoundSkipReason =
  (typeof ROUND_SKIP_REASONS)[keyof typeof ROUND_SKIP_REASONS];

export type AdmissionRole =
  | "dm"
  | "reminder"
  | "human-mention"
  | "all-mention"
  | "task-owner"
  | "task-reviewer"
  | "task-event"
  | "secretary-handoff";

export type RoundAdmission =
  | { admit: true; role: AdmissionRole; useRoomGate: boolean }
  | { admit: false; reason: RoundSkipReason };

export interface AdmissionTaskSnapshot {
  status: TaskStatus;
  ownerId: string | null;
  reopened: number;
}

export interface RoundAdmissionInput {
  agentId: string;
  isDM: boolean;
  isMember: boolean;
  isTaskThread: boolean;
  task: AdmissionTaskSnapshot | null;
  reason: "message" | "reminder";
  continuing: boolean;
  /** 当轮 incoming 里是否有任何人类正文个人点名了本 agent。 */
  humanMentioned: boolean;
  /** 当轮 incoming 里是否有任何人类正文出现 @all / @everyone。 */
  humanAllMentioned: boolean;
  /** 当轮 incoming 里是否有仍开放的 Owner `Task #N created` 事件。 */
  hasOpenTaskEvent: boolean;
  /** 本成员是否就是当前存活的秘书。 */
  isSecretary: boolean;
  /** 秘书本轮是否被一个唯一的未认领任务明确关联（创建事件 / 任务线程 / 唯一引用）。 */
  secretaryHandoff: boolean;
  /**
   * 任务创建事件旁边的人类任务锚点是否明确点名了本 agent / @all。
   * 这是「人类已经直接叫人」的信号，不是事件预览里的 @；用于保留显式邀请。
   */
  taskEventAnchorInvited: boolean;
}

export function decideRoundAdmission(input: RoundAdmissionInput): RoundAdmission {
  if (input.reason === "reminder") {
    return { admit: true, role: "reminder", useRoomGate: false };
  }
  if (input.isDM) {
    return { admit: true, role: "dm", useRoomGate: false };
  }

  if (input.isTaskThread && input.task) {
    const task = input.task;
    if (task.reopened === 1) {
      return { admit: false, reason: ROUND_SKIP_REASONS.taskReopened };
    }
    const owner = task.ownerId === input.agentId;
    switch (task.status) {
      case "in_progress":
        return owner
          ? { admit: true, role: "task-owner", useRoomGate: false }
          : { admit: false, reason: ROUND_SKIP_REASONS.taskOwnerOnly };
      case "in_review":
        if (owner) return { admit: true, role: "task-owner", useRoomGate: false };
        return input.humanMentioned || input.humanAllMentioned
          ? { admit: true, role: "task-reviewer", useRoomGate: false }
          : { admit: false, reason: ROUND_SKIP_REASONS.taskReviewerNotInvited };
      case "done":
      case "closed":
        return input.humanMentioned || input.humanAllMentioned
          ? { admit: true, role: "human-mention", useRoomGate: false }
          : { admit: false, reason: ROUND_SKIP_REASONS.taskDoneOrClosed };
      case "todo":
        if (input.isSecretary && input.secretaryHandoff) {
          return { admit: true, role: "secretary-handoff", useRoomGate: false };
        }
        return input.humanMentioned || input.humanAllMentioned
          ? { admit: true, role: "human-mention", useRoomGate: false }
          : { admit: false, reason: ROUND_SKIP_REASONS.taskUnclaimed };
    }
  }
  if (input.continuing) {
    return { admit: true, role: "task-owner", useRoomGate: false };
  }

  if (!input.isMember) {
    return input.humanMentioned
      ? { admit: true, role: "human-mention", useRoomGate: true }
      : { admit: false, reason: ROUND_SKIP_REASONS.notMember };
  }
  if (input.humanAllMentioned) {
    return { admit: true, role: "all-mention", useRoomGate: true };
  }
  if (input.humanMentioned) {
    return { admit: true, role: "human-mention", useRoomGate: true };
  }
  if (input.isSecretary && input.secretaryHandoff) {
    return { admit: true, role: "secretary-handoff", useRoomGate: false };
  }
  if (input.hasOpenTaskEvent) {
    if (input.taskEventAnchorInvited) {
      return { admit: true, role: "task-event", useRoomGate: false };
    }
    return {
      admit: false,
      reason: input.isSecretary
        ? ROUND_SKIP_REASONS.handoffNotTriggered
        : ROUND_SKIP_REASONS.taskEventHandoffOnly,
    };
  }
  return { admit: false, reason: ROUND_SKIP_REASONS.noInvitation };
}
