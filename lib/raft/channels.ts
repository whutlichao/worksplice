import { getDb } from "./db-singleton.ts";
import type { ChannelRow, MemberRow } from "../data/db.ts";
import { BUILTIN_CHANNEL_ID, OWNER_MEMBER_ID } from "../data/schema.ts";

/** 当前人类用户恒为 Owner（§3.6：本地单机形态下 Owner 级操作由 human 在 UI 直接执行）。 */
export const CURRENT_MEMBER_ID = OWNER_MEMBER_ID;

export function listChannels(): ChannelRow[] {
  return getDb().listChannels();
}

export function getChannel(id: string): ChannelRow | undefined {
  return getDb().getChannel(id);
}

function assertChannel(channelId: string): ChannelRow {
  const channel = getDb().getChannel(channelId);
  if (!channel) throw new Error("Channel not found");
  return channel;
}

function assertMember(memberId: string): MemberRow {
  const member = getDb().getMember(memberId);
  if (!member) throw new Error("Member not found");
  return member;
}

/**
 * 创建 channel 并自动加入创建者（Owner）+ 初始成员（§3.2 创建 channel 规则）。
 * 私有 channel 的初始成员也由创建者（Owner）直接指定，属合法路径。
 */
export function createChannel(input: {
  name: string;
  type?: ChannelRow["type"];
  description?: string;
  memberIds?: string[];
}): ChannelRow {
  const name = input.name.trim();
  if (!name) throw new Error("Channel name is required");
  if (name.length > 32) throw new Error("Channel name must be 32 characters or fewer");
  const channel = getDb().insertChannel({
    name,
    type: input.type ?? "public",
    description: (input.description ?? "").trim(),
  });
  getDb().addChannelMember(channel.id, OWNER_MEMBER_ID);
  for (const memberId of input.memberIds ?? []) {
    assertMember(memberId);
    getDb().addChannelMember(channel.id, memberId);
  }
  return channel;
}

/**
 * 加入 channel（§3.2）：公开 channel 成员可自行加入；私有 channel 只能由 Owner 加入成员。
 * 替他人加入（memberId ≠ actorId）仅 Owner 可做；重复加入幂等。
 */
export function joinChannel(
  channelId: string,
  memberId: string,
  actorId: string = memberId,
): void {
  const channel = assertChannel(channelId);
  assertMember(memberId);
  if (memberId !== actorId && actorId !== OWNER_MEMBER_ID) {
    throw new Error("Only the owner can add other members");
  }
  if (channel.type === "private" && actorId !== OWNER_MEMBER_ID) {
    throw new Error("Only the owner can add members to a private channel");
  }
  getDb().addChannelMember(channelId, memberId);
}

/**
 * 离开 channel（§3.2）：成员可自行离开；Owner 可移除任意成员；`#all` 不可离开。
 */
export function leaveChannel(
  channelId: string,
  memberId: string,
  actorId: string = memberId,
): void {
  assertChannel(channelId);
  assertMember(memberId);
  if (channelId === BUILTIN_CHANNEL_ID) {
    throw new Error("Cannot leave the #all channel");
  }
  if (!getDb().isChannelMember(channelId, memberId)) {
    throw new Error("Not a member of this channel");
  }
  if (memberId !== actorId && actorId !== OWNER_MEMBER_ID) {
    throw new Error("Only the owner can remove other members");
  }
  getDb().removeChannelMember(channelId, memberId);
}

/** 归档/解归档（§3.2）：Owner only；归档冻结写入、保留可读；`#all` 不可归档。 */
export function setChannelArchived(
  channelId: string,
  archived: boolean,
  actorId: string = OWNER_MEMBER_ID,
): ChannelRow {
  assertChannel(channelId);
  if (channelId === BUILTIN_CHANNEL_ID) {
    throw new Error("Cannot archive the #all channel");
  }
  if (actorId !== OWNER_MEMBER_ID) {
    throw new Error("Only the owner can archive a channel");
  }
  getDb().setChannelArchived(channelId, archived ? 1 : 0);
  return assertChannel(channelId);
}

export function isChannelMember(channelId: string, memberId: string): boolean {
  return getDb().isChannelMember(channelId, memberId);
}

/**
 * §6.1 target 归一化（读侧宽松）：target_id 命中 channels 即 channel，
 * 否则按 thread 锚点消息解析其归属 channel；未知 target 返回 undefined。
 * 写侧（messages.resolveTarget）在此之上加严格校验（不可嵌套）。
 */
export function resolveChannelForTarget(targetId: string): ChannelRow | undefined {
  const channel = getDb().getChannel(targetId);
  if (channel) return channel;
  const anchor = getDb().getMessage(targetId);
  if (!anchor) return undefined;
  return getDb().getChannel(anchor.target_id);
}

/** channel 成员列表（含成员详情）。 */
export function listChannelMembers(channelId: string): MemberRow[] {
  const rows = getDb().listChannelMembers(channelId);
  return rows
    .map((row) => getDb().getMember(row.member_id))
    .filter((m): m is MemberRow => Boolean(m));
}

/** 侧栏/列表用：每个 channel 附 加入状态 + 成员数（针对某成员）。 */
export function listChannelsWithMeta(memberId: string): Array<ChannelRow & { joined: boolean; memberCount: number }> {
  return listChannels().map((channel) => ({
    ...channel,
    joined: getDb().isChannelMember(channel.id, memberId),
    memberCount: getDb().listChannelMembers(channel.id).length,
  }));
}
