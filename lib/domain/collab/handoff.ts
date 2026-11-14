import { getDb } from "../../data/db-singleton.ts";
import { OWNER_MEMBER_ID } from "../../data/schema.ts";
import {
  getChannel,
  isChannelMember,
  listChannelMembers,
} from "./channels.ts";
import { isHandoffEligibleTask } from "./handoff-trigger.ts";
import { sendMessage } from "./messages.ts";
import { getMember } from "./members.ts";
import { isSecretaryMember } from "./secretary-identity.ts";
import { claimTask, getTaskView, type TaskView } from "./tasks.ts";
import { emitWake, type WakeHint } from "./wake.ts";
import type {
  MemberRow,
  MessageRow,
  TaskRow,
} from "../../data/types.ts";

/**
 * 秘书自动 handoff 的写路径（票 #240）：
 * - 成功：同一事务里由 `claimTask` 写 owner + 任务线程通知 + `handoff_state='handed_off'`
 *   + `handoff_seq=通知 seq` + `handoff_owner_id=chosen`；提交后只定向唤醒 chosen。
 * - blocked：无唯一合适人时不 claim、不广播；任务线程写短通知（候选 / 边界 / 必须回答的问题）
 *   与 `handoff_state='blocked'` 同事务提交，任务保持 todo、owner 空。
 * - 重复触发看到 handoff_state 即 no-op；并发 claim 由 claimTask 的 owner 唯一性裁决。
 *
 * 自动路径绝不把秘书自己写成 owner：候选列表排除秘书，显式指定秘书也走 blocked。
 * 用户明确点名秘书为 owner 时，走普通 `claimTask`（不经过本模块）。
 */

export type HandoffResult =
  | {
      status: "handed_off";
      task: TaskView;
      chosen: MemberRow;
      notice: MessageRow;
      candidates: MemberRow[];
    }
  | {
      status: "blocked";
      task: TaskView;
      notice: MessageRow;
      candidates: MemberRow[];
      question: string;
      reason: string;
    }
  | { status: "noop"; reason: "already_handled" | "task_not_open" | "not_found" }
  | { status: "held"; roomSeq: number; whatHappened: string }
  | { status: "denied"; reason: string };

/** 定向唤醒接缝：正常提交后与恢复扫描共用；测试注入以模拟「提交后、唤醒前崩溃」。 */
export type HandoffWakeEmitter = (hint: WakeHint) => void;

export interface HandoffNoticeInput {
  task: TaskRow;
  anchor: MessageRow;
  secretary: MemberRow;
  chosen: MemberRow | null;
  content: string;
}

/** 通知投递接缝（测试注入失败，验证同事务回滚）。 */
export type HandoffNoticeDelivery = (input: HandoffNoticeInput) => MessageRow;

function defaultDeliverNotice(input: HandoffNoticeInput): MessageRow {
  const result = sendMessage({
    targetId: input.anchor.id,
    authorId: input.secretary.id,
    content: input.content,
    wake: false,
    roomNotice: true,
  });
  if (result.held) throw new Error("Handoff notice was held");
  return result.message;
}

/**
 * 自动 handoff 的候选：channel 内的 agent 成员，排除秘书自己、Owner / 人类、
 * 软删、非成员，以及已认领 / 重开 / 已分流的任务（后三项是任务级资格）。
 */
export function listHandoffCandidates(input: {
  channelId: string;
  taskId: string;
  secretaryId: string;
}): MemberRow[] {
  const task = getDb().getTaskById(input.taskId);
  if (!task || !isHandoffEligibleTask(task)) return [];
  const anchor = getDb().getMessage(task.message_id);
  if (!anchor || anchor.target_id !== input.channelId) return [];
  return listChannelMembers(input.channelId)
    .filter(
      (member) =>
        member.type === "agent" &&
        member.id !== input.secretaryId &&
        member.id !== OWNER_MEMBER_ID &&
        !isSecretaryMember(member) &&
        member.deleted !== 1 &&
        isChannelMember(input.channelId, member.id),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

interface AssigneeResolution {
  chosen: MemberRow | null;
  reason: string;
}

function resolveAssignee(
  candidates: MemberRow[],
  ref: string | null | undefined,
  channelId: string,
): AssigneeResolution {
  const raw = ref?.trim() ?? "";
  if (!raw) {
    return {
      chosen: null,
      reason: "no assignee was selected",
    };
  }
  const name = raw.startsWith("@") ? raw.slice(1) : raw;
  const match = candidates.find(
    (candidate) =>
      candidate.id === raw ||
      candidate.id === name ||
      candidate.name.toLowerCase() === name.toLowerCase(),
  );
  if (match) return { chosen: match, reason: "" };

  // 明确报边界：成员存在但不是候选时，说出它为什么不合适。
  const member =
    getDb().getMember(raw) ??
    getDb().getMember(name) ??
    getDb()
      .listMembersIncludingDeleted()
      .find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
  if (!member) {
    return { chosen: null, reason: `no member matches "${raw}"` };
  }
  if (isSecretaryMember(member)) {
    return {
      chosen: null,
      reason: "the secretary cannot be the owner of an automatic handoff",
    };
  }
  if (member.type === "human" || member.id === OWNER_MEMBER_ID) {
    return { chosen: null, reason: "the Owner is not an assignable candidate" };
  }
  if (member.deleted === 1) {
    return { chosen: null, reason: "the member is deleted" };
  }
  if (!isChannelMember(channelId, member.id)) {
    return {
      chosen: null,
      reason: "the member is not a member of this channel",
    };
  }
  return {
    chosen: null,
    reason: "the selected member is not an eligible handoff candidate",
  };
}

function candidateNames(candidates: MemberRow[]): string {
  if (candidates.length === 0) return "none";
  const shown = candidates.slice(0, 10).map((candidate) => `@${candidate.name}`);
  const hidden = candidates.length - shown.length;
  return hidden > 0 ? `${shown.join(", ")} (+${hidden} more)` : shown.join(", ");
}

/**
 * 执行一次秘书 handoff。所有写入在单个事务内；wake 在提交后发出。
 * `deliverNotice` 是测试接缝：注入抛错时验证 owner / 标记 / 通知一起回滚。
 */
export function handoffTask(input: {
  channelId: string;
  taskNumber: number;
  secretaryId: string;
  assignee?: string | null;
  question?: string | null;
  baseSeq?: number;
  deliverNotice?: HandoffNoticeDelivery;
  emitWake?: HandoffWakeEmitter;
}): HandoffResult {
  const channel = getChannel(input.channelId);
  if (!channel) return { status: "noop", reason: "not_found" };
  const secretary = getMember(input.secretaryId);
  if (!secretary || !isSecretaryMember(secretary)) {
    return {
      status: "denied",
      reason: "handoff is reserved for the secretary",
    };
  }
  if (!isChannelMember(channel.id, secretary.id)) {
    return {
      status: "denied",
      reason: "the secretary is not a member of this channel",
    };
  }

  const deliverNotice = input.deliverNotice ?? defaultDeliverNotice;
  const result = getDb().withTransaction((): HandoffResult => {
    const roomSeq = getDb().maxSeq(channel.id);
    if (input.baseSeq !== undefined && input.baseSeq !== roomSeq) {
      return {
        status: "held",
        roomSeq,
        whatHappened: `the channel is now at seq ${roomSeq}`,
      };
    }

    const task = getDb().getTaskByChannelNumber(
      channel.id,
      input.taskNumber,
    );
    if (!task) return { status: "noop", reason: "not_found" };
    if (task.handoff_state !== null) {
      return { status: "noop", reason: "already_handled" };
    }
    if (!isHandoffEligibleTask(task)) {
      return { status: "noop", reason: "task_not_open" };
    }
    const anchor = getDb().getMessage(task.message_id);
    if (!anchor) return { status: "noop", reason: "not_found" };

    const candidates = listHandoffCandidates({
      channelId: channel.id,
      taskId: task.id,
      secretaryId: secretary.id,
    });
    const resolution = resolveAssignee(
      candidates,
      input.assignee ?? null,
      channel.id,
    );

    if (resolution.chosen) {
      const chosen = resolution.chosen;
      const claim = claimTask({
        channelId: channel.id,
        taskNumber: input.taskNumber,
        memberId: chosen.id,
        baseSeq: roomSeq,
      });
      if (claim.status === "held") {
        return {
          status: "held",
          roomSeq: claim.roomSeq,
          whatHappened: claim.whatHappened,
        };
      }
      if (claim.status !== "claimed") {
        return { status: "noop", reason: "task_not_open" };
      }

      const notice = deliverNotice({
        task,
        anchor,
        secretary,
        chosen,
        content: `Task #${task.number} owner set to @${chosen.name} by secretary handoff.`,
      });
      const updated = getDb().updateTask(task.id, {
        handoffState: "handed_off",
        handoffSeq: notice.seq,
        handoffOwnerId: chosen.id,
      });
      if (!updated) throw new Error("Task disappeared during handoff");
      return {
        status: "handed_off",
        task: getTaskView(task.id),
        chosen,
        notice,
        candidates,
      };
    }

    const question =
      (input.question?.trim() || "Who should own this task?").slice(0, 500);
    const notice = deliverNotice({
      task,
      anchor,
      secretary,
      chosen: null,
      content: `Task #${task.number} handoff blocked: ${resolution.reason}. Candidates: ${candidateNames(candidates)}. Owner answer needed: ${question}`,
    });
    const updated = getDb().updateTask(task.id, {
      handoffState: "blocked",
      handoffSeq: notice.seq,
    });
    if (!updated) throw new Error("Task disappeared during handoff");
    return {
      status: "blocked",
      task: getTaskView(task.id),
      notice,
      candidates,
      question,
      reason: resolution.reason,
    };
  });

  const wake = input.emitWake ?? emitWake;
  // 提交后只定向唤醒 chosen；blocked 不广播。
  if (
    result.status === "handed_off" &&
    getDb().getConsumedSeq(result.chosen.id, result.task.message_id) <
      result.notice.seq
  ) {
    wake({
      agentId: result.chosen.id,
      targetId: result.task.message_id,
      seq: result.notice.seq,
      reason: "message",
    });
  }
  return result;
}

/**
 * 票 #242：补发「claim 事务已提交、定向唤醒尚未发出」的成功 handoff。
 * 只读任务与游标并重发 wake；不重复 claim、不改 owner、不写第二条通知。
 * 只在任务仍为 in_progress、当前 owner 仍是当初选中的 handoff_owner_id、
 * 通知消息仍存在且游标尚未到达 handoff_seq 时补发。
 */
export function recoverHandoffWakes(
  input: { emitWake?: HandoffWakeEmitter } = {},
): number {
  const wake = input.emitWake ?? emitWake;
  let emitted = 0;
  for (const task of getDb().listTasks()) {
    if (
      task.handoff_state !== "handed_off" ||
      task.handoff_seq === null ||
      task.status !== "in_progress" ||
      task.owner_id === null ||
      task.handoff_owner_id !== task.owner_id
    ) {
      continue;
    }
    const owner = getMember(task.owner_id);
    if (!owner || owner.type !== "agent" || owner.deleted === 1) continue;
    if (!getDb().getMessageBySeq(task.message_id, task.handoff_seq)) continue;
    if (
      getDb().getConsumedSeq(owner.id, task.message_id) >= task.handoff_seq
    ) {
      continue;
    }
    wake({
      agentId: owner.id,
      targetId: task.message_id,
      seq: task.handoff_seq,
      reason: "message",
      recovery: true,
    });
    emitted += 1;
  }
  return emitted;
}
