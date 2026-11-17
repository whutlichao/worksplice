import { getDb } from "../../data/db-singleton.ts";
import { isChannelMember } from "./channels.ts";
import { parseTaskCreationEventNumber } from "./invitations.ts";
import { isSecretaryMember } from "./secretary-identity.ts";
import { parseTaskReferenceNumbers } from "./task-reference.ts";
import { isTaskActionableForActor } from "./admission.ts";
import type { ChannelRow, MemberRow, MessageRow, TaskRow } from "../../data/types.ts";

/**
 * 生效首席自动 handoff 的触发判定（票 #240 / #270，纯读判定层）：
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

/**
 * 自动 handoff 只处理「对本频道 agent 可行动、从未自动分流、未认领、仍在 todo」的任务。
 * 「未重开」不在调用点手写：它由 actor-relative 的 `isTaskActionableForActor` 统一回答
 * （reopened 的 todo 对人类可接管，对 agent 不开放）。
 */
export function isHandoffEligibleTask(task: TaskRow | undefined): boolean {
  return Boolean(
    task &&
      task.status === "todo" &&
      task.owner_id === null &&
      task.handoff_state === null &&
      isTaskActionableForActor(task, "agent"),
  );
}

/**
 * 正文里的 `Task #N` 引用（去重、升序）——实现与选人判定共用同一个纯模块
 * （`task-reference.ts`）；此处再导出保持既有导入路径兼容。
 */
export { parseTaskReferenceNumbers };

function isHumanMessage(message: HandoffTriggerMessage): boolean {
  return (
    message.author?.type === "human" ||
    getDb().getMember(message.author_id)?.type === "human"
  );
}

/**
 * 从本轮新消息里选出唯一的 handoff 目标（`secretary` 只指**当前全局首席**）。
 * 频道首席保留默认收件人职责，但不再获得任务 handoff 身份。
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
  const consider = (task: TaskRow | undefined): boolean => {
    if (!task) return false;
    associated.set(task.id, task);
    if (isHandoffEligibleTask(task)) eligible.set(task.id, task);
    return true;
  };
  let multipleReferences = false;
  let latestHumanMessageAssociated = false;

  const threadTask =
    targetId !== channel.id ? getDb().getTaskByMessageId(targetId) : undefined;
  consider(threadTask);

  for (const message of humanMessages) {
    if (message.target_id !== channel.id) {
      // 任务线程：target 本身就是任务锚点；消息里的其他 Task #N 不改变归属。
      latestHumanMessageAssociated = consider(
        getDb().getTaskByMessageId(message.target_id),
      );
      continue;
    }

    // 任务锚点本身（人类消息就是任务锚点时）。
    let associatedMessage = consider(getDb().getTaskByMessageId(message.id));

    // 任务创建事件：事件号是唯一裁决依据；预览里出现的其他 Task #N 不算引用。
    const eventNumber = parseTaskCreationEventNumber(message.content);
    if (eventNumber !== null) {
      latestHumanMessageAssociated = consider(
        getDb().getTaskByChannelNumber(channel.id, eventNumber),
      );
      continue;
    }

    const references = parseTaskReferenceNumbers(message.content);
    if (references.length > 1) multipleReferences = true;
    for (const number of references) {
      associatedMessage =
        consider(getDb().getTaskByChannelNumber(channel.id, number)) ||
        associatedMessage;
    }
    latestHumanMessageAssociated = associatedMessage;
  }

  if (multipleReferences || eligible.size > 1) {
    return { kind: "none", reason: "multiple-tasks" };
  }
  const task = eligible.values().next().value as TaskRow | undefined;
  if (!task) {
    if (associated.size === 1 && latestHumanMessageAssociated) {
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
