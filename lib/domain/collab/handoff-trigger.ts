import { getDb } from "../../data/db-singleton.ts";
import { bodyMentionText } from "../../mention.ts";
import { isChannelMember } from "./channels.ts";
import { parseTaskCreationEventNumber } from "./invitations.ts";
import { isSecretaryMember } from "./secretary-identity.ts";
import type { ChannelRow, MemberRow, MessageRow, TaskRow } from "../../data/types.ts";

/**
 * 秘书自动 handoff 的触发判定（票 #240，纯读判定层）：
 * 只认两种明确关联——
 * ① 任务创建事件（`Task #N created`）；
 * ② 与既有未认领任务明确关联的人类消息：任务锚点 / 任务线程 / 唯一 `Task #N` 引用。
 *
 * 多任务命中、无关联、任意闲聊一律不选。判定只回答「该不该叫秘书处理哪个任务」，
 * 不写库、不发 wake、不起会话；候选筛选与事务执行在 handoff.ts。
 */

export type HandoffTriggerReason =
  | "not-secretary"
  | "secretary-not-member"
  | "no-human-association"
  | "multiple-tasks"
  | "already-handled"
  | "task-not-open";

export type SecretaryHandoffSelection =
  | { kind: "handoff"; task: TaskRow; anchor: MessageRow }
  | { kind: "none"; reason: HandoffTriggerReason };

/** 触发判定需要的最小消息形状（wake 侧可避免 import messages.ts 造成循环）。 */
export interface HandoffTriggerMessage {
  id: string;
  target_id: string;
  author_id: string;
  content: string;
  author?: MemberRow | null;
}

/** 自动 handoff 只处理「从未自动分流、未认领、未重开、仍在 todo」的任务。 */
export function isHandoffEligibleTask(task: TaskRow | undefined): boolean {
  return Boolean(
    task &&
      task.status === "todo" &&
      task.owner_id === null &&
      task.reopened === 0 &&
      task.handoff_state === null,
  );
}

const TASK_REFERENCE_RE = /\bTask\s+#(\d+)\b/gi;

/**
 * 正文里的 `Task #N` 引用（去重、升序）。引用块 / 代码围栏 / 行内代码不算——
 * 与 @mention 共用 `bodyMentionText` 的正文口径。
 */
export function parseTaskReferenceNumbers(content: string): number[] {
  const body = bodyMentionText(content);
  const numbers = new Set<number>();
  for (const match of body.matchAll(TASK_REFERENCE_RE)) {
    const number = Number(match[1]);
    if (Number.isSafeInteger(number) && number > 0) numbers.add(number);
  }
  return [...numbers].sort((a, b) => a - b);
}

function isHumanMessage(message: HandoffTriggerMessage): boolean {
  return (
    message.author?.type === "human" ||
    getDb().getMember(message.author_id)?.type === "human"
  );
}

/**
 * 从本轮新消息里选出唯一的秘书 handoff 目标。
 * `messages` 必须是本轮 drain 的增量（不含 secretary 自己的消息）；旧消息不得伪装成新触发。
 */
export function selectSecretaryHandoffTask(input: {
  secretary: MemberRow;
  channel: ChannelRow;
  targetId: string;
  messages: HandoffTriggerMessage[];
}): SecretaryHandoffSelection {
  const { secretary, channel, targetId } = input;
  if (!isSecretaryMember(secretary)) {
    return { kind: "none", reason: "not-secretary" };
  }
  if (!isChannelMember(channel.id, secretary.id)) {
    return { kind: "none", reason: "secretary-not-member" };
  }

  const humanMessages = input.messages.filter(isHumanMessage);
  if (humanMessages.length === 0) {
    return { kind: "none", reason: "no-human-association" };
  }

  const associated = new Map<string, TaskRow>();
  const eligible = new Map<string, TaskRow>();
  const consider = (task: TaskRow | undefined): void => {
    if (!task) return;
    associated.set(task.id, task);
    if (isHandoffEligibleTask(task)) eligible.set(task.id, task);
  };
  let multipleReferences = false;

  const threadTask =
    targetId !== channel.id ? getDb().getTaskByMessageId(targetId) : undefined;
  consider(threadTask);

  for (const message of humanMessages) {
    if (message.target_id !== channel.id) {
      // 任务线程：target 本身就是任务锚点；消息里的其他 Task #N 不改变归属。
      consider(getDb().getTaskByMessageId(message.target_id));
      continue;
    }

    // 任务锚点本身（人类消息就是任务锚点时）。
    consider(getDb().getTaskByMessageId(message.id));

    // 任务创建事件：事件号是唯一裁决依据；预览里出现的其他 Task #N 不算引用。
    const eventNumber = parseTaskCreationEventNumber(message.content);
    if (eventNumber !== null) {
      consider(getDb().getTaskByChannelNumber(channel.id, eventNumber));
      continue;
    }

    const references = parseTaskReferenceNumbers(message.content);
    if (references.length > 1) multipleReferences = true;
    for (const number of references) {
      consider(getDb().getTaskByChannelNumber(channel.id, number));
    }
  }

  if (multipleReferences || eligible.size > 1) {
    return { kind: "none", reason: "multiple-tasks" };
  }
  const task = eligible.values().next().value as TaskRow | undefined;
  if (!task) {
    if (associated.size === 1) {
      const only = associated.values().next().value as TaskRow;
      return {
        kind: "none",
        reason: only.handoff_state !== null ? "already-handled" : "task-not-open",
      };
    }
    return {
      kind: "none",
      reason: associated.size > 1 ? "multiple-tasks" : "no-human-association",
    };
  }
  const anchor = getDb().getMessage(task.message_id);
  if (!anchor) return { kind: "none", reason: "no-human-association" };
  return { kind: "handoff", task, anchor };
}
