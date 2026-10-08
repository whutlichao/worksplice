import { getDb } from "../../data/db-singleton.ts";
import { notifyAgentJoinedChannel, notifyChannelCreated, findSusanMember } from "./event-messages.ts";
import { assertActorMayPerform } from "./member-capabilities.ts";
import type { ChannelRow, MemberRow } from "../../data/types.ts";
import { BUILTIN_CHANNEL_ID, OWNER_MEMBER_ID, DM_ID_PREFIX } from "../../data/schema.ts";

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

/** DM 频道确定性 id：`dm:owner↔<agent名>`（spec R7，天然幂等）。 */
function directChannelId(agentName: string): string {
  return `${DM_ID_PREFIX}${agentName}`;
}

/** 频道是否为 DM（私信，一对一 owner↔agent）。 */
export function isDM(channelId: string): boolean {
  return getDb().getChannel(channelId)?.type === "dm";
}

/** 某 agent 的 DM 频道（无则返回 undefined；非 agent/不存在同样 undefined）。 */
export function getDMFor(agentId: string): ChannelRow | undefined {
  const member = getDb().getMember(agentId);
  if (!member || member.type !== "agent") return undefined;
  return getDb().getChannel(directChannelId(member.name));
}

/**
 * 创建（或取回）某 agent 的一对一 DM（§R1/R2）：确定性 id 天然幂等，重复调用返回既有 DM；
 * 成员恒为 owner + 1 agent，创建时定死。agent 不存在/非 agent 抛错。
 */
export function createDirectChannel(agentId: string): ChannelRow {
  const member = getDb().getMember(agentId);
  if (!member || member.type !== "agent") throw new Error("Agent not found");
  const id = directChannelId(member.name);
  const existing = getDb().getChannel(id);
  if (existing) return existing;
  const channel = getDb().insertChannel({ id, name: id, type: "dm", description: "" });
  getDb().addChannelMember(id, OWNER_MEMBER_ID);
  getDb().addChannelMember(id, agentId);
  return channel;
}

/** DM 禁改守卫（§R2/R5：不可加人/退订/归档/静音，对标 #all 先例）。 */
function assertNotDM(channel: ChannelRow): void {
  if (channel.type === "dm") throw new Error("Cannot modify a DM channel");
}

/**
 * 接续同名 DM（§R7 重建路径）：删除身份会归档其 DM 并移出成员（deleteAgent），而 DM id 由
 * 名字确定性派生——同名 agent 重建（新 member id）命中的是同一条 DM，必须就地接续：
 * 解档、成员补回 owner + 本 agent、本 agent 对 DM 的消费游标推到修复时刻的 max(seq)
 * （新身份不被旧对话唤醒，§R4 人类新消息才是确定信号；历史消息一条不动）。
 * 幂等：已在预期态（非归档 + 两名成员）时一行不写；DM 尚未懒创建时返回 undefined，不建行。
 * 三条写入同事务，不留「解档了但成员没加回」「成员加了但游标没推」这类半修复状态。
 */
export function resumeDirectChannel(agentId: string): ChannelRow | undefined {
  const agent = assertMember(agentId);
  if (agent.type !== "agent" || agent.deleted === 1) {
    throw new Error("Agent not found");
  }
  const dm = getDb().getChannel(directChannelId(agent.name));
  if (!dm || dm.type !== "dm") return undefined;
  // 预期态判定：开库期步骤用同一谓词选行（非归档 + 两名成员）
  const ownerJoined = getDb().isChannelMember(dm.id, OWNER_MEMBER_ID);
  const agentJoined = getDb().isChannelMember(dm.id, agent.id);
  if (dm.archived === 0 && ownerJoined && agentJoined) return dm;
  getDb().withTransaction(() => {
    // 成员缺失 ⇔ 重建出来的新身份（旧身份的成员行随 deleteAgent 一并清空）：游标推到当前房间版本，
    // 旧对话不重放；仍在成员里的身份保留自己的未读游标。
    if (!agentJoined) {
      getDb().setConsumedSeq(agent.id, dm.id, getDb().maxSeq(dm.id));
    }
    getDb().addChannelMember(dm.id, OWNER_MEMBER_ID);
    getDb().addChannelMember(dm.id, agent.id);
    getDb().setChannelArchived(dm.id, 0);
  });
  return assertChannel(dm.id);
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
  if (input.type === "dm") {
    throw new Error("DM channels are created via createDirectChannel");
  }
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
  // §7 新建公开频道必加：秘书静默加入（不触发欢迎事件；私有频道由创建者预勾选决定）。
  if (channel.type === "public") {
    const susan = findSusanMember();
    if (susan) getDb().addChannelMember(channel.id, susan.id);
  }
  notifyChannelCreated(channel);
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
  assertNotDM(channel);
  assertMember(memberId);
  if (memberId !== actorId && actorId !== OWNER_MEMBER_ID) {
    throw new Error("Only the owner can add other members");
  }
  if (channel.type === "private" && actorId !== OWNER_MEMBER_ID) {
    throw new Error("Only the owner can add members to a private channel");
  }
  const isNewMember = !getDb().isChannelMember(channelId, memberId);
  getDb().addChannelMember(channelId, memberId);
  if (isNewMember) notifyAgentJoinedChannel(channelId, memberId);
}

/**
 * 离开 channel（§3.2）：成员可自行离开；Owner 可移除任意成员；`#all` 不可离开。
 */
export function leaveChannel(
  channelId: string,
  memberId: string,
  actorId: string = memberId,
): void {
  const channel = assertChannel(channelId);
  assertNotDM(channel);
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

/** 归档/解归档（§3.2）：Owner only；归档冻结写入、保留可读；`#all` 不可归档。
 *  权限裁决走成员能力表（`assertActorMayPerform`）——人类专属操作对成员一律不开，
 *  与成员面 op 同一处裁决、同一套理由（ADR-0013 决策一）。 */
export function setChannelArchived(
  channelId: string,
  archived: boolean,
  actorId: string = OWNER_MEMBER_ID,
): ChannelRow {
  const channel = assertChannel(channelId);
  assertNotDM(channel);
  if (channelId === BUILTIN_CHANNEL_ID) {
    throw new Error("Cannot archive the #all channel");
  }
  assertActorMayPerform(archived ? "archiveChannel" : "unarchiveChannel", actorId);
  getDb().setChannelArchived(channelId, archived ? 1 : 0);
  return assertChannel(channelId);
}

export function isChannelMember(channelId: string, memberId: string): boolean {
  return getDb().isChannelMember(channelId, memberId);
}

export interface ChannelMute {
  channelId: string;
  memberId: string;
  /** 静音时刻的 channel max(seq)：channel 消息的"静音前"判定（§3.2）。 */
  muteFromSeq: number;
  /** 静音时刻的全局插入点（max messages.rowid）：thread 消息无 channel seq，按此判定"静音后"。 */
  muteRowid: number;
}

/**
 * 静音 channel（§3.2/§3.8）：静音后普通消息不进该成员的 inbox，个人 @mention 仍穿透。
 * 记录静音时刻的 channel 版本（muteFromSeq）；已静音时幂等（保留首次静音版本）。
 * 仅成员本人可静音自己；Owner 可替任意成员静音（演示/托管路径）。
 */
export function muteChannel(
  channelId: string,
  memberId: string,
  actorId: string = memberId,
): ChannelMute {
  const channel = assertChannel(channelId);
  assertNotDM(channel);
  assertMember(memberId);
  if (memberId !== actorId && actorId !== OWNER_MEMBER_ID) {
    throw new Error("Only the owner can mute for other members");
  }
  if (!getDb().isChannelMember(channelId, memberId)) {
    throw new Error("Not a member of this channel");
  }
  const muteFromSeq = getDb().maxSeq(channelId);
  const muteRowid = getDb().maxMessageRowid();
  getDb().setChannelMute(channelId, memberId, muteFromSeq, muteRowid);
  return { channelId, memberId, muteFromSeq, muteRowid };
}

/** 取消 mute（幂等）：inbox 恢复——静音期间被压制的消息不补投，只收新消息（游标语义）。 */
export function unmuteChannel(
  channelId: string,
  memberId: string,
  actorId: string = memberId,
): void {
  const channel = assertChannel(channelId);
  assertNotDM(channel);
  assertMember(memberId);
  if (memberId !== actorId && actorId !== OWNER_MEMBER_ID) {
    throw new Error("Only the owner can unmute for other members");
  }
  getDb().clearChannelMute(channelId, memberId);
}

/** 该成员对某 channel 的静音状态（undefined = 未静音）。 */
export function getChannelMute(channelId: string, memberId: string): ChannelMute | undefined {
  const row = getDb().getChannelMute(channelId, memberId);
  return row
    ? {
        channelId: row.channel_id,
        memberId: row.member_id,
        muteFromSeq: row.mute_from_seq,
        muteRowid: row.mute_rowid,
      }
    : undefined;
}

/** 某 channel 内全部 agent 成员的静音状态（UI 的 mute 面板/列表用）。 */
export function listChannelMutes(channelId: string): Array<ChannelMute & { name: string }> {
  return getDb()
    .listChannelMutes(channelId)
    .map((row) => {
      const member = getDb().getMember(row.member_id);
      return member
        ? {
            channelId: row.channel_id,
            memberId: row.member_id,
            muteFromSeq: row.mute_from_seq,
            muteRowid: row.mute_rowid,
            name: member.name,
          }
        : null;
    })
    .filter((x): x is ChannelMute & { name: string } => Boolean(x));
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

/** channel 成员列表（含成员详情；软删成员不出现在任何 channel——§3.6 删除即移出）。 */
export function listChannelMembers(channelId: string): MemberRow[] {
  const rows = getDb().listChannelMembers(channelId);
  return rows
    .map((row) => getDb().getMember(row.member_id))
    .filter((m): m is MemberRow => m !== undefined && m !== null && m.deleted !== 1);
}

/** 侧栏/列表用：每个 channel 附 加入状态 + 成员数 + Owner 未读数（BAI-6 未读角标）+ 有消息信号。 */
export function listChannelsWithMeta(
  memberId: string,
): Array<
  ChannelRow & {
    joined: boolean;
    memberCount: number;
    unread: number;
    /** DM 懒创建「有消息」信号：顶层消息数（= maxSeq，消息 seq 单调自 1、不可变无删除）。 */
    messageCount: number;
  }
> {
  return listChannels().map((channel) => ({
    ...channel,
    joined: getDb().isChannelMember(channel.id, memberId),
    memberCount: getDb().listChannelMembers(channel.id).length,
    unread: getDb().countUnreadChannelMessages(memberId, channel.id),
    messageCount: getDb().maxSeq(channel.id),
  }));
}
