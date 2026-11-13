/**
 * 模型覆盖草稿的判定层（Agent 详情面板「模型」节，界面反馈第 7 条）。
 *
 * 面板原本靠「应用」按钮显式提交：草稿留在本地状态里，按钮在 `draftModel === null &&
 * draftThinking === null` 时 disabled —— 等于**无法把覆盖改回「继承全局默认」**（缺陷）。
 * 现在改成失焦自动保存，于是「这次失焦要不要发 PATCH」成了唯一的判据，必须能单测：
 * 仓内没有 jsdom，`renderToStaticMarkup` 验不了 focusout，判定只能落在纯函数上。
 *
 * 判据的形状刻意与持久化面一致：`provider` / `modelId` / `thinkingLevel` 三个字段逐一比对，
 * 草稿端由 `runtimeOverrideFromDraft` 从 ModelPicker 的两处状态合成。零依赖：不 import
 * 任何东西，服务端 / 客户端 / 测试都能直接引。
 */

/** 模型覆盖：与 `GET /api/members/[id]/runtime` 的 `configured` 面同形。 */
export interface RuntimeOverride {
  provider: string | null;
  modelId: string | null;
  thinkingLevel: string | null;
}

/** 面板草稿（ModelPicker 的两处状态）→ 三字段覆盖。模型未选中时两个字段同时为 null。 */
export function runtimeOverrideFromDraft(
  model: { provider: string; modelId: string } | null,
  thinkingLevel: string | null,
): RuntimeOverride {
  return {
    provider: model?.provider ?? null,
    modelId: model?.modelId ?? null,
    thinkingLevel: thinkingLevel ?? null,
  };
}

/**
 * 草稿是否与已持久化的覆盖不同 —— 不同才发 PATCH。
 *
 * 三个字段都参与判定：只改思考级别、只改 provider、只改 modelId 都算变化；
 * **把三字段全清空成 null 也算变化**（清空 = 回到继承全局默认，必须能保存）。
 */
export function needsRuntimeSave(
  persisted: RuntimeOverride,
  draft: RuntimeOverride,
): boolean {
  return (
    persisted.provider !== draft.provider ||
    persisted.modelId !== draft.modelId ||
    persisted.thinkingLevel !== draft.thinkingLevel
  );
}
