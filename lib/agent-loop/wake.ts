import { getDb } from "../raft/db-singleton.ts";
import { listChannelMembers, resolveChannelForTarget } from "../raft/channels.ts";
import { getMember } from "../raft/members.ts";
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

/** @mention 解析：内容里的 @名字 token → 成员 id（大小写不敏感、全等 token 匹配）。 */
export function extractMentionedMemberIds(content: string): string[] {
  const tokens = (content.match(/@([^\s@,;:!?。，；：！？]+)/g) ?? []).map((token) =>
    token.slice(1).toLowerCase(),
  );
  if (tokens.length === 0) return [];
  return getDb()
    .listMembers()
    .filter((member) => tokens.includes(member.name.toLowerCase()))
    .map((member) => member.id);
}

/**
 * 消息落库后的 wake 分发（§3.2 通知规则）：
 * - 目标 channel 的 agent 成员（不含作者）全部唤醒——加入 channel = 订阅全部消息；
 * - 未加入 channel 的 agent 被个人 @mention 时仍穿透送达（注意力信号）。
 * thread 消息以锚点消息 id 为目标（drain 用同一 target 归一化）。
 */
export function notifyMessageWakes(message: MessageRow): void {
  const channel = resolveChannelForTarget(message.target_id);
  if (!channel) return;

  const woken = new Set<string>();
  for (const member of listChannelMembers(channel.id)) {
    if (member.type !== "agent" || member.id === message.author_id) continue;
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
