import { getDb } from "../../data/db-singleton.ts";
import type { MemberRow } from "../../data/types.ts";

/**
 * 秘书身份的唯一判定源（票 #240 从 event-messages 抽出）：
 * 名字全等 + agent 类型 + 未软删。放在独立模块，是为了让 wake / handoff / 事件消息
 * 三个方向都能引用它，同时避免 `wake ↔ event-messages` 的循环导入。
 */
export const SUSAN_MEMBER_NAME = "Susan";

/** 存活秘书（未软删的 agent、名字全等）；不存在时返回 undefined。 */
export function findSusanMember(): MemberRow | undefined {
  return getDb()
    .listMembers()
    .find((member) => member.type === "agent" && member.name === SUSAN_MEMBER_NAME);
}

/** 严格判定：传入成员是否就是当前存活的秘书。 */
export function isSecretaryMember(
  member: MemberRow | null | undefined,
): boolean {
  return Boolean(
    member &&
      member.type === "agent" &&
      member.deleted !== 1 &&
      member.name === SUSAN_MEMBER_NAME,
  );
}
