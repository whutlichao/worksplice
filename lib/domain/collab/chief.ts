import { getDb } from "../../data/db-singleton.ts";
import type { MemberRow } from "../../data/types.ts";

/**
 * 首席（Chief）身份的**唯一解析口**（票 #248）：不缓存、每次现算——换人 / 改名 / 软删后
 * 立刻生效，读者不会拿到旧值。
 *
 * 生效顺序固定两档：频道首席 → 全局首席 → 无（第三档的「随便找一个 agent」明确不做）。
 * 本票只落地全局回落；频道档由 #250 在同一解析口内追加，消费者接口不变。
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
 * 「这个频道此刻生效的首席是谁」。
 * 本票：全局首席存活 → `{ chief, source: "global" }`，否则 `{ chief: null, source: "none" }`。
 */
export function resolveEffectiveChief(channelId: string): EffectiveChief {
  void channelId; // 频道指定档（#250）在这里插入；本票只有全局回落。
  const chief = getGlobalChief();
  return chief ? { chief, source: "global" } : { chief: null, source: "none" };
}
