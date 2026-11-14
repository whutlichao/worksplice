import { OWNER_MEMBER_ID } from "../../data/schema.ts";
import { getDb } from "../../data/db-singleton.ts";
import type { ChannelRow, MemberRow } from "../../data/types.ts";

/**
 * 首席（Chief）身份的**唯一解析口**（票 #248 / #250）：不缓存、每次现算——换人 / 改名 /
 * 软删 / 离场后立刻生效，读者不会拿到旧值。
 *
 * 生效顺序固定三档：频道首席 → 全局首席 → 无（第三档的「随便找一个 agent」明确不做）。
 * 频道首席失效（离开频道 / 软删 / 不是 agent）按「未设置」处理，**不改写**库里的绑定：
 * 回落到全局首席，也不换成别人。静音不在解析里过滤——它是「这一轮唤不唤醒」的事，
 * 落在 `selectChiefRecipient`（静音 ⇒ 没有可用首席，不回落、不换人）。
 *
 * 「秘书」不是独立角色：它就是全局首席在下沉 handoff 职责时的称呼
 * （见 `secretary-identity.ts`）。名字不参与任何判定。
 */

/** 全局首席（存活 agent；无则 undefined）。软删身份不算——它不是任何频道的可用首席。 */
export function getGlobalChief(): MemberRow | undefined {
  return getDb()
    .listMembers()
    .find((member) => member.global_chief === 1 && member.type === "agent");
}

/**
 * 设 / 换 / 清空全局首席：同一时刻至多一位（数据层先清空再置位，单事务）。
 * 目标必须是存活 agent——人类成员、软删身份、不存在的 id 一律拒绝，避免写进一条
 * 永远不生效的标记。`null` = 清空（频道回到「没有默认收件人」）。
 */
export function setGlobalChief(agentId: string | null): void {
  if (agentId === null) {
    getDb().setGlobalChief(null);
    return;
  }
  const member = getDb().getMember(agentId);
  if (!member || member.type !== "agent" || member.deleted === 1) {
    throw new Error("Global chief must be a live agent");
  }
  getDb().setGlobalChief(agentId);
}

/** 生效首席的来源：频道指定 / 全局回落 / 没有。 */
export type ChiefSource = "channel" | "global" | "none";

export interface EffectiveChief {
  chief: MemberRow | null;
  source: ChiefSource;
}

/**
 * 频道首席绑定是否**此刻可用**：绑定存在，且指向一个未软删的 agent 成员、且仍是该频道成员。
 * 任一不成立 ⇒ undefined（= 未设置；不改写绑定）。
 */
function liveChannelChief(channelId: string): MemberRow | undefined {
  const bound = getDb().getChannel(channelId)?.chief_member_id;
  if (!bound) return undefined;
  const member = getDb().getMember(bound);
  if (!member || member.type !== "agent" || member.deleted === 1) return undefined;
  if (!getDb().isChannelMember(channelId, bound)) return undefined;
  return member;
}

/**
 * 「这个频道此刻生效的首席是谁」：频道首席（存活且是本频道成员）→ 全局首席（存活）→ 无。
 * 唯一答案来源——UI 与选人判定都读这里，不在客户端或调用点重新推导。
 */
export function resolveEffectiveChief(channelId: string): EffectiveChief {
  const channelChief = liveChannelChief(channelId);
  if (channelChief) return { chief: channelChief, source: "channel" };
  const globalChief = getGlobalChief();
  return globalChief ? { chief: globalChief, source: "global" } : { chief: null, source: "none" };
}

/** 频道首席绑定的拒绝语义：路由按 `status` 映射稳定 4xx，`code` 给调用方与测试做稳定判据。 */
export type ChannelChiefErrorCode =
  | "channel_not_found"
  | "owner_only"
  | "member_not_found"
  | "human_member"
  | "member_deleted"
  | "not_channel_member";

export class ChannelChiefError extends Error {
  readonly status: 400 | 403 | 404 | 409;
  readonly code: ChannelChiefErrorCode;

  constructor(status: 400 | 403 | 404 | 409, code: ChannelChiefErrorCode, message: string) {
    super(message);
    this.name = "ChannelChiefError";
    this.status = status;
    this.code = code;
  }
}

/**
 * 设 / 换 / 清空频道首席（唯一写面，票 #250）：只有 Owner 能写；目标必须是该频道的
 * **未软删 agent 成员**——人类成员、频道外成员、已软删身份、不存在的 id 一律拒绝并说明原因，
 * 而不是写进一条永远不生效的绑定。`null` = 清空（该频道回落到全局首席）。
 *
 * 校验全部先于写入：拒绝时不执行任何 UPDATE，因此不留半条绑定。
 */
export function setChannelChief(
  channelId: string,
  memberId: string | null,
  actorId: string = OWNER_MEMBER_ID,
): ChannelRow {
  const db = getDb();
  const channel = db.getChannel(channelId);
  if (!channel) {
    throw new ChannelChiefError(404, "channel_not_found", "Channel not found");
  }
  if (actorId !== OWNER_MEMBER_ID) {
    throw new ChannelChiefError(
      403,
      "owner_only",
      "Only the owner can set or clear a channel chief",
    );
  }
  if (memberId !== null) {
    const member = db.getMember(memberId);
    if (!member) {
      throw new ChannelChiefError(404, "member_not_found", `Member not found: ${memberId}`);
    }
    if (member.deleted === 1) {
      throw new ChannelChiefError(
        409,
        "member_deleted",
        "Cannot set a deleted member as the channel chief",
      );
    }
    if (member.type !== "agent") {
      throw new ChannelChiefError(
        400,
        "human_member",
        "Channel chief must be an agent member",
      );
    }
    if (!db.isChannelMember(channelId, memberId)) {
      throw new ChannelChiefError(
        409,
        "not_channel_member",
        "Channel chief must be a member of this channel",
      );
    }
  }
  db.setChannelChief(channelId, memberId);
  return db.getChannel(channelId) as ChannelRow;
}
