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

/** 首席的读面形态（id + 名字）：频道行与两条 chief 写面共用一份，不四处手抄同一个字面对象。 */
export interface ChiefRef {
  id: string;
  name: string;
}

/** 成员行 → 读面首席引用；没有成员就是 `null`（「没有默认收件人」的线上形态）。 */
export function chiefRefOf(member: MemberRow | null | undefined): ChiefRef | null {
  return member ? { id: member.id, name: member.name } : null;
}

/** 全局首席（存活 agent；无则 undefined）。软删身份不算——它不是任何频道的可用首席。 */
export function getGlobalChief(): MemberRow | undefined {
  return getDb()
    .listMembers()
    .find((member) => member.global_chief === 1 && member.type === "agent");
}

/**
 * 首席目标的成员面拒绝码：两条写面（全局 / 频道）共用同一组——同一类非法目标在两条路由上
 * 同 code、同状态码（§1「同语义错误跨路由必须同状态码」）。
 */
export type ChiefMemberRejectionCode =
  | "member_not_found"
  | "human_member"
  | "member_deleted";

/**
 * 首席目标的成员面判据（两条写面共用一份，判据顺序固定：不存在 → 已软删 → 人类成员）。
 * 不成立时给出拒绝描述；调用方按自己的错误类型抛出（`null` = 目标可为首席）。
 */
function chiefMemberRejection(memberId: string): {
  status: 400 | 404 | 409;
  code: ChiefMemberRejectionCode;
  message: string;
} | null {
  const member = getDb().getMember(memberId);
  if (!member) {
    return { status: 404, code: "member_not_found", message: `Member not found: ${memberId}` };
  }
  if (member.deleted === 1) {
    return {
      status: 409,
      code: "member_deleted",
      message: "Cannot set a deleted member as the chief",
    };
  }
  if (member.type !== "agent") {
    return { status: 400, code: "human_member", message: "The chief must be an agent member" };
  }
  return null;
}

/** 全局首席的拒绝语义：`status` + `code` 给路由映射稳定 4xx，路由不自己判原因。 */
export class GlobalChiefError extends Error {
  readonly status: 400 | 404 | 409;
  readonly code: ChiefMemberRejectionCode;

  constructor(status: 400 | 404 | 409, code: ChiefMemberRejectionCode, message: string) {
    super(message);
    this.name = "GlobalChiefError";
    this.status = status;
    this.code = code;
  }
}

/**
 * 设 / 换 / 清空全局首席：同一时刻至多一位（数据层先清空再置位，单事务）。
 * 目标必须是存活 agent——人类成员、软删身份、不存在的 id 一律拒绝并说明原因
 * （`GlobalChiefError`，路由按 `status` + `code` 映射），避免写进一条永远不生效的标记。
 * `null` = 清空（频道回到「没有默认收件人」）。
 */
export function setGlobalChief(agentId: string | null): void {
  if (agentId === null) {
    getDb().setGlobalChief(null);
    return;
  }
  const rejection = chiefMemberRejection(agentId);
  if (rejection) {
    throw new GlobalChiefError(rejection.status, rejection.code, rejection.message);
  }
  getDb().setGlobalChief(agentId);
}

/**
 * 首席对本频道是否**此刻可达**（票 #251 的唯一结论）：生效首席必须是本频道未软删的 agent
 * 成员，且没有静音该频道。
 *
 * 「可达」是**投递判定**，不是解析判定：`resolveEffectiveChief` 只回答「谁是首席」（绑定是否
 * 有效），静音 / 非成员在这里才被过滤——所以「静音的首席」不回落全局、不换人（见模块头注释）。
 * 三处共用这一份：`selectChiefRecipient`（谁接这条消息）、wake 的定向唤醒、频道列表行
 * （`chiefAvailable`，composer 提示只读它，不在客户端重新推导）。
 */
export function canRouteToChief(channelId: string, memberId: string): boolean {
  const member = getDb().getMember(memberId);
  if (!member || member.type !== "agent" || member.deleted === 1) return false;
  if (!getDb().isChannelMember(channelId, memberId)) return false;
  if (getDb().getChannelMute(channelId, memberId)) return false;
  return true;
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

/**
 * 这个成员是不是该频道**此刻**的生效首席。
 *
 * 唯一解析仍归 `resolveEffectiveChief`：调用点不得自己重走「频道 → 全局 → 无」。
 * 这里不判静音——静音是可达性（`canRouteToChief`），不是身份。
 */
export function isEffectiveChiefForChannel(
  channelId: string,
  memberId: string,
): boolean {
  return resolveEffectiveChief(channelId).chief?.id === memberId;
}

/** 频道首席绑定的拒绝语义：路由按 `status` 映射稳定 4xx，`code` 给调用方与测试做稳定判据。 */
export type ChannelChiefErrorCode =
  | "channel_not_found"
  | "owner_only"
  | "not_channel_member"
  | ChiefMemberRejectionCode;

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
    const rejection = chiefMemberRejection(memberId);
    if (rejection) {
      throw new ChannelChiefError(rejection.status, rejection.code, rejection.message);
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
