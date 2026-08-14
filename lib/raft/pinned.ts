import { getDb } from "./db-singleton.ts";
import { getChannel, isChannelMember, resolveChannelForTarget } from "./channels.ts";
import { getMember } from "./members.ts";
import { messageWithAuthor, type MessageWithAuthor } from "./messages.ts";
import type { MessageRow, PinnedMessageRow } from "../data/types.ts";

export type PinSortMode = "manual" | "recent" | "az";

export interface PinnedItem {
  message: MessageWithAuthor;
  order: number;
  pinnedAt: string;
}

/** §3.5 消息必须属于该 channel（channel 消息直判；thread 消息经锚点归一化）。 */
function assertMessageInChannel(channelId: string, messageId: string): MessageRow {
  const message = getDb().getMessage(messageId);
  if (!message) throw new Error("Message not found");
  const channel = resolveChannelForTarget(message.target_id);
  if (!channel || channel.id !== channelId) {
    throw new Error("Message does not belong to this channel");
  }
  return message;
}

function assertChannelForPin(channelId: string, memberId: string) {
  const channel = getChannel(channelId);
  if (!channel) throw new Error("Channel not found");
  if (!getMember(memberId)) throw new Error("Member not found");
  if (!isChannelMember(channelId, memberId)) {
    throw new Error("You are not a member of this channel");
  }
}

/**
 * pin 一条消息（§3.5 个性化 pinned）：成员各自维护自己的 pinned 区。
 * 已 pin 则幂等返回既有行；order = 当前最大 + 1（Manual 排序默认）。
 */
export function pinMessage(input: {
  channelId: string;
  messageId: string;
  memberId: string;
}): PinnedMessageRow {
  assertChannelForPin(input.channelId, input.memberId);
  assertMessageInChannel(input.channelId, input.messageId);
  const existing = getDb().getPinnedMessage(input.channelId, input.messageId, input.memberId);
  if (existing) return existing;
  return getDb().withTransaction(() => {
    const maxOrder = getDb()
      .listPinnedMessages(input.channelId, input.memberId)
      .reduce((max, row) => Math.max(max, row.order), -1);
    return getDb().insertPinnedMessage({
      channelId: input.channelId,
      messageId: input.messageId,
      memberId: input.memberId,
      order: maxOrder + 1,
    });
  });
}

/** 解除 pin；未 pin 返回 false（幂等）。 */
export function unpinMessage(input: {
  channelId: string;
  messageId: string;
  memberId: string;
}): boolean {
  assertChannelForPin(input.channelId, input.memberId);
  return getDb().deletePinnedMessage(input.channelId, input.messageId, input.memberId);
}

/**
 * 列表（§3.5 排序三选一）：manual = order 升序（默认）/ recent = pinned_at 降序 / az = 内容字典序。
 * 消息不可删除 → 不会出现悬空 pin；缺行防御性跳过。
 */
export function listPinned(input: {
  channelId: string;
  memberId: string;
  sort?: PinSortMode;
}): PinnedItem[] {
  const rows = getDb().listPinnedMessages(input.channelId, input.memberId);
  const items = rows
    .map((row) => {
      const message = getDb().getMessage(row.message_id);
      return message ? { row, message } : null;
    })
    .filter((x): x is { row: PinnedMessageRow; message: MessageRow } => x !== null);
  const sort = input.sort ?? "manual";
  items.sort((a, b) => {
    if (sort === "recent") {
      return b.row.pinned_at.localeCompare(a.row.pinned_at) || b.row.order - a.row.order;
    }
    if (sort === "az") return a.message.content.localeCompare(b.message.content);
    return a.row.order - b.row.order;
  });
  return items.map(({ row, message }) => ({
    message: messageWithAuthor(message),
    order: row.order,
    pinnedAt: row.pinned_at,
  }));
}

/** Manual 排序：按传入的 messageId 顺序重排（只重排已 pin 的行，缺省保持原位）。 */
export function setPinnedOrder(input: {
  channelId: string;
  memberId: string;
  order: string[];
}): void {
  assertChannelForPin(input.channelId, input.memberId);
  getDb().setPinnedOrder(input.channelId, input.memberId, input.order);
}
