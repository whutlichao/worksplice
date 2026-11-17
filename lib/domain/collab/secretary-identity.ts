import { SECRETARY_DEFAULT_NAME } from "../../secretary-name.ts";
import { getGlobalChief } from "./chief.ts";
import { OWNER_MEMBER_ID } from "../../data/schema.ts";
import type { MemberRow } from "../../data/types.ts";

/**
 * 秘书身份的判定源（票 #248 起是**角色判定**，不再是名字判定）：
 * 秘书 = 全局首席，是它在下沉 handoff 职责时的称呼——没有第二条身份路径。
 * 放在独立模块，是为了让 wake / handoff / 事件消息三个方向都能引用它，同时避免
 * `wake ↔ event-messages` 的循环导入。
 */

/** 引导 / 迁移期的默认名字（创建「启动助手」身份时用）：**不参与任何身份判定**。
 *  字面值来自 `lib/secretary-name.ts`（与数据层迁移常量、UI 侧启动助手判定同源）。 */
export const SUSAN_MEMBER_NAME = SECRETARY_DEFAULT_NAME;

/** 严格判定：传入成员是否就是当前全局首席（= 秘书）。 */
export function isSecretaryMember(
  member: MemberRow | null | undefined,
): boolean {
  if (!member || member.type !== "agent" || member.deleted === 1) return false;
  return getGlobalChief()?.id === member.id;
}

/**
 * 任务状态权威（#295）的唯一判定：人类 Owner 或**当前**全局首席（秘书）。
 *
 * 这是任务写权限的唯一入口，不在 handler / prompt / UI 里另写一份。判定只看身份，
 * 不看任务 owner、频道首席绑定或名字；全局首席换人 / 软删后立刻失效。
 * 「任务 owner」只是归属，不等于状态写权——普通 owner 的完成动作走完成请求。
 */
export function isTaskStatusAuthority(memberId: string): boolean {
  if (memberId === OWNER_MEMBER_ID) return true;
  return getGlobalChief()?.id === memberId;
}
