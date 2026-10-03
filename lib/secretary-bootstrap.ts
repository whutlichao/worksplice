/**
 * 启动助手与频道预勾选的纯判定（spec-bootstrap-agent.md §6.3/§7，构建 effort ticket 06/07）：
 * 无 React/服务端依赖的纯函数（仅 type import，运行时零依赖），CreateAgentModal /
 * CreateChannelModal 直接消费——
 * - hasLiveSusan：成员列表里是否有存活秘书（名字全等 + agent 类型 + 非软删）。
 *   `GET /api/members` 的 agents 经 DB `listMembers()` 已过滤软删（§3.6），
 *   这里再按 `deleted` 字段防御一次（判定本身自足，与来源解耦）。
 * - liveSusanMemberId：同上判定的 id 形态（§7 私有频道预勾选用）。
 * - precheckSusanForPrivateChannel：§7「新建私有频道默认加（可取消）」状态机——
 *   类型进入 private 且 Susan 未被用户手动触碰 → 幂等补入预勾选；已触碰 → 尊重用户
 *   选择（不再自动补回）；public 不涉及。memberIds 语义与既有 createChannel 完全一致。
 * - resolveBootstrapModel：点击时的创建模型判定，与表单 ModelPicker 预选同源
 *   （defaultModel 须在 modelList 中 → 用之；否则首个可见）：defaultModel 为 null 或
 *   指向不可见模型时，仍有可用模型（modelList 非空）→ 取首个可见（settings 显式默认
 *   未解析到时仍可建，避免"配置已就绪却引导去配置"的死循环——API defaultModel 与
 *   settings 显式默认不一致时恒为 null）；完全无可用模型 → null → 引导打开模型配置。
 */

import type { ModelsData } from "./models-cache";

/** 秘书默认名字（与 lib/domain/collab/event-messages.ts SUSAN_MEMBER_NAME 同值；UI 侧避免引 协作服务层）。 */
export const SUSAN_NAME = "Susan";

export interface BootstrapAgentLike {
  id?: string;
  name: string;
  type?: string;
  deleted?: number;
}

/** 活存秘书判定（名字全等 + agent 类型 + 未软删）；软删行不算（删除后按钮仍显示 = 重建入口）。 */
function isLiveSusan(a: BootstrapAgentLike): boolean {
  return a.type === "agent" && a.deleted !== 1 && a.name === SUSAN_NAME;
}

/** 成员列表里是否有存活 Susan（不依赖 id 存在性；liveSusanMemberId 的判定同源）。 */
export function hasLiveSusan(agents: BootstrapAgentLike[] | null | undefined): boolean {
  return (agents ?? []).some(isLiveSusan);
}

/** 活存 Susan 的 member id（§7 私有频道预勾选）；无活存 Susan → undefined。 */
export function liveSusanMemberId(
  agents: BootstrapAgentLike[] | null | undefined,
): string | undefined {
  return (agents ?? []).find(isLiveSusan)?.id;
}

/**
 * §7 私有频道预勾选状态机：类型进入 private 且 Susan 未被用户手动触碰 → 幂等补入预勾选；
 * 切回 public（未触碰）→ 撤掉预勾选（公开频道不涉及，预勾选不泄漏进公开提交）；
 * 已触碰（用户勾/取消过 Susan）→ 尊重用户选择；无活存 Susan → 原样返回。
 */
export function precheckSusanForPrivateChannel(
  memberIds: string[],
  type: "public" | "private",
  susanId: string | undefined,
  susanTouched: boolean,
): string[] {
  if (susanTouched || !susanId) return memberIds;
  if (type === "private") {
    return memberIds.includes(susanId) ? memberIds : [...memberIds, susanId];
  }
  return memberIds.includes(susanId) ? memberIds.filter((m) => m !== susanId) : memberIds;
}

/**
 * 创建模型判定（与表单预选 `defaultKey ?? options[0]` 同规则）：
 * defaultModel 存在、成对且在 modelList 中 → 用之（显式默认/scope 兜底优先）；
 * 否则首个可见模型；完全无可用模型 → null（引导打开模型配置）。
 */
export function resolveBootstrapModel(
  models: Pick<ModelsData, "defaultModel" | "modelList"> | null | undefined,
): { provider: string; modelId: string } | null {
  const list = models?.modelList ?? [];
  const def = models?.defaultModel;
  if (def && typeof def.provider === "string" && typeof def.modelId === "string") {
    const matched = list.find((m) => m.provider === def.provider && m.id === def.modelId);
    if (matched) return { provider: matched.provider, modelId: matched.id };
  }
  const first = list.find((m) => m && m.provider && m.id);
  return first ? { provider: first.provider, modelId: first.id } : null;
}
