import { getDb } from "../raft/db-singleton.ts";
import { getChannelMute, listChannelMembers, resolveChannelForTarget } from "../raft/channels.ts";
import { extractMentionedMemberIds, getMember } from "../raft/members.ts";
import type { MessageRow } from "../data/db.ts";

/**
 * wake 事件分发（§5.4/§5.5）：inbox 服务收到新消息 → 向目标 agent 的 loop 发唤醒事件。
 * hint 只含 seq/目标信息，不预组 prompt、不含正文（§3.8 拉取式——正文由 agent 自己 drain）。
 * 监听器挂 globalThis 扛热重载；loop 驱动（driver）订阅，服务层只负责发。
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
 * - 未加入 channel 的 agent 被个人 @mention 时仍穿透送达（注意力信号）。
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

  const woken = new Set<string>();
  for (const member of listChannelMembers(channel.id)) {
    if (member.type !== "agent" || member.id === message.author_id) continue;
    if (getChannelMute(channel.id, member.id)) continue;
    woken.add(member.id);
    emitWake({ agentId: member.id, targetId: message.target_id, seq: message.seq, reason: "message" });
  }
  for (const mentionedId of extractMentionedMemberIds(message.content)) {
    const member = getMember(mentionedId);
    if (!member || member.type !== "agent" || member.id === message.author_id) continue;
    if (woken.has(mentionedId)) continue;
    emitWake({ agentId: mentionedId, targetId: message.target_id, seq: message.seq, reason: "message" });
  }
}

// §3.2 @mention 解析（内容里的 @名字 token → 成员 id）实现于 raft 服务层（lib/raft/members.ts，
// inbox 的 mute 穿透判定与 wake 同源）；此处再导出保持既有导入路径兼容。
export { extractMentionedMemberIds } from "../raft/members.ts";
