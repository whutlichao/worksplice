import { getGlobalChief } from "./chief.ts";
import type { MemberRow } from "../../data/types.ts";

/**
 * 秘书身份的判定源（票 #248 起是**角色判定**，不再是名字判定）：
 * 秘书 = 全局首席，是它在下沉 handoff 职责时的称呼——没有第二条身份路径。
 * 放在独立模块，是为了让 wake / handoff / 事件消息三个方向都能引用它，同时避免
 * `wake ↔ event-messages` 的循环导入。
 */

/** 引导 / 迁移期的默认名字（创建「启动助手」身份时用）：**不参与任何身份判定**。 */
export const SUSAN_MEMBER_NAME = "Susan";

/** 严格判定：传入成员是否就是当前全局首席（= 秘书）。 */
export function isSecretaryMember(
  member: MemberRow | null | undefined,
): boolean {
  if (!member || member.type !== "agent" || member.deleted === 1) return false;
  return getGlobalChief()?.id === member.id;
}
