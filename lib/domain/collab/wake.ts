import { getDb } from "../../data/db-singleton.ts";
import { getChannelMute, listChannelMembers, resolveChannelForTarget } from "./channels.ts";
import { extractMentionedMemberIds, getMember } from "./members.ts";
import {
  parseTaskCreationEventNumber,
  selectMessageInvitations,
} from "./invitations.ts";
import type { MessageRow } from "../../data/types.ts";

/**
 * wake 事件总线（§5.4/§5.5，Ticket 02 从 agent-loop 下沉到 协作域）：
 * 协作服务层（消息提交 / 提醒触发）发布唤醒事件，agent-loop 驱动订阅消费。
 * hint 只含 seq/目标信息，不预组 prompt、不含正文（§3.8 拉取式——正文由 agent 自己 drain）。
 * 监听器挂 globalThis 扛热重载；服务层只负责发，订阅/取消由调用方（agent-loop driver）管理。
 */

export interface WakeHint {
  agentId: string;
  targetId: string;
  seq: number;
  reason: "message" | "reminder";
}

export type WakeReason = WakeHint["reason"];

export type WakeListener = (hint: WakeHint) => void;

declare global {
  var __workspliceWakeListeners: Set<WakeListener> | undefined;
}

function getListeners(): Set<WakeListener> {
  if (!globalThis.__workspliceWakeListeners) {
    globalThis.__workspliceWakeListeners = new Set();
  }
  return globalThis.__workspliceWakeListeners;
}

export function subscribeWake(listener: WakeListener): () => void {
  const listeners = getListeners();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitWake(hint: WakeHint): void {
  for (const listener of getListeners()) {
    try {
      listener(hint);
    } catch {
      // 忽略单个订阅者错误
    }
  }
}

/**
 * 消息落库后的 wake 分发（§3.2 通知规则）：
 * - 目标 channel 的 agent 成员（不含作者）全部唤醒——加入 channel = 订阅全部消息；
 *   §3.2 mute：静音了该 channel 的成员不因普通消息被唤醒（个人 @mention 仍由下方穿透）；
 * - 未加入 channel 的 agent 被个人 @mention 时仍穿透送达；唯一例外是 agent-authored DM（Owner-authored DM 仍穿透）。
 * - §3.7 任务延续自醒：任务 owner 的回复落任务线程且任务仍在进行中 → 自醒续工
 *   （agent 干完活才有下一步，进度更新后继续或 complete，见 loop.ts 的 continuation）。
 * thread 消息以锚点消息 id 为目标（drain 用同一 target 归一化）。
 */
export function notifyMessageWakes(message: MessageRow): void {
  const channel = resolveChannelForTarget(message.target_id);
  if (!channel) return;

  // 任务延续自醒（owner 本人；与 channel 级唤醒互不冲突）
  const task = getDb().getTaskByMessageId(message.target_id);
  if (task && task.status === "in_progress" && task.owner_id === message.author_id) {
    emitWake({ agentId: message.author_id, targetId: message.target_id, seq: message.seq, reason: "message" });
  }

  const author = getMember(message.author_id);
  // DM 语义不变：owner 的私信永远送达对方；agent 的私信不穿透其他 agent。
  if (channel.type === "dm") {
    for (const member of listChannelMembers(channel.id)) {
      if (member.type !== "agent" || member.id === message.author_id) continue;
      if (getChannelMute(channel.id, member.id)) continue;
      emitWake({
        agentId: member.id,
        targetId: message.target_id,
        seq: message.seq,
        reason: "message",
      });
    }
    // DM 语义不变：人类正文里的个人 @ 仍穿透给未加入的 agent；agent 的 @ 不穿透。
    if (author?.type === "human") {
      for (const mentionedId of extractMentionedMemberIds(message.content)) {
        const member = getMember(mentionedId);
        if (!member || member.type !== "agent" || member.id === message.author_id) continue;
        emitWake({
          agentId: mentionedId,
          targetId: message.target_id,
          seq: message.seq,
          reason: "message",
        });
      }
    }
    return;
  }

  const notify = (agentId: string): void => {
    const member = getMember(agentId);
    if (!member || member.type !== "agent" || member.id === message.author_id) return;
    emitWake({
      agentId,
      targetId: message.target_id,
      seq: message.seq,
      reason: "message",
    });
  };

  if (author?.type === "human") {
    // Owner 署名的任务创建事件是系统消息，不是人类敲出来的正文邀请：
    // 预览里即使带 @ 也不按点名收窄。开放任务沿用既有全员扇出（T2/#240 再收窄），
    // done/closed 事件不叫任何人。
    const taskNumber = parseTaskCreationEventNumber(message.content);
    if (taskNumber !== null) {
      const task = getDb().getTaskByChannelNumber(channel.id, taskNumber);
      if (
        !task ||
        task.status === "done" ||
        task.status === "closed" ||
        task.reopened === 1
      ) {
        return;
      }
      for (const member of listChannelMembers(channel.id)) {
        if (member.type !== "agent" || member.id === message.author_id) continue;
        if (getChannelMute(channel.id, member.id)) continue;
        notify(member.id);
      }
      return;
    }
    // Ticket #237：人类正文点名 / @all 才产生新邀请；候选与 beginTurn 同源。
    const invitations = selectMessageInvitations({
      targetId: message.target_id,
      authorId: message.author_id,
      content: message.content,
    });
    if (invitations.candidates.length > 0) {
      for (const agentId of invitations.candidates) notify(agentId);
      return;
    }
    return;
  }

  // 普通 agent 正文 @ 不穿透：只投给频道现有的 agent 成员（任务 owner 靠订阅收到）。
  for (const member of listChannelMembers(channel.id)) {
    if (member.type !== "agent" || member.id === message.author_id) continue;
    if (getChannelMute(channel.id, member.id)) continue;
    notify(member.id);
  }
}

// §3.2 @mention 解析（内容里的 @名字 token → 成员 id）实现于本域（members.ts，
// inbox 的 mute 穿透判定与 wake 同源）；此处再导出保持既有导入路径兼容。
export { extractMentionedMemberIds } from "./members.ts";
