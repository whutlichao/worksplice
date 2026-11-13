import assert from "node:assert/strict";
import test from "node:test";

/**
 * 模型覆盖草稿的判定层（`lib/runtime-draft.ts`）：面板的「失焦是否要保存」只有这一处判据。
 *
 * 只测外部行为——给定已持久化的覆盖与当前草稿，得出「要不要发 PATCH」；不断言内部实现。
 * 仓内没有 jsdom，`renderToStaticMarkup` 也验不了 focusout，所以第 7 条反馈的四种判定
 * 全部落在这里：无变化 / 仅 thinking 变化 / 清空成继承 / 从无覆盖改为有覆盖。
 */

const { needsRuntimeSave, runtimeOverrideFromDraft } = await import(
  "./runtime-draft.ts"
);

const INHERIT = { provider: null, modelId: null, thinkingLevel: null };

test("无变化时不保存（三字段逐一相等）", () => {
  const persisted = {
    provider: "zenmux",
    modelId: "claude-sonnet-4-6",
    thinkingLevel: "high",
  };
  assert.equal(needsRuntimeSave(persisted, { ...persisted }), false);
  assert.equal(needsRuntimeSave(INHERIT, { ...INHERIT }), false);
});

test("仅 thinking 变化时要保存（模型两字段不参与误判）", () => {
  const persisted = { provider: null, modelId: null, thinkingLevel: "low" };
  const draft = { ...persisted, thinkingLevel: "high" };
  assert.equal(needsRuntimeSave(persisted, draft), true);
  // 反向（高 → 低）同样是变化；清空 thinking 也走这里
  assert.equal(needsRuntimeSave(draft, persisted), true);
  assert.equal(
    needsRuntimeSave(draft, { ...draft, thinkingLevel: null }),
    true,
  );
});

test("仅 provider 或仅 modelId 变化时要保存", () => {
  const persisted = {
    provider: "zenmux",
    modelId: "claude-sonnet-4-6",
    thinkingLevel: null,
  };
  assert.equal(
    needsRuntimeSave(persisted, { ...persisted, provider: "openai" }),
    true,
  );
  assert.equal(
    needsRuntimeSave(persisted, { ...persisted, modelId: "gpt-5" }),
    true,
  );
});

test("清空成继承全局默认时要保存（旧按钮在此处 disabled，是本次修掉的缺陷）", () => {
  const persisted = {
    provider: "zenmux",
    modelId: "claude-sonnet-4-6",
    thinkingLevel: "high",
  };
  assert.equal(needsRuntimeSave(persisted, INHERIT), true);
});

test("从无覆盖改为有覆盖时要保存", () => {
  assert.equal(
    needsRuntimeSave(INHERIT, {
      provider: "zenmux",
      modelId: "claude-sonnet-4-6",
      thinkingLevel: null,
    }),
    true,
  );
  assert.equal(
    needsRuntimeSave(INHERIT, {
      provider: null,
      modelId: null,
      thinkingLevel: "medium",
    }),
    true,
  );
});

test("草稿组装：模型与思考级别两处状态合成三字段", () => {
  assert.deepEqual(runtimeOverrideFromDraft(null, null), INHERIT);
  assert.deepEqual(
    runtimeOverrideFromDraft(
      { provider: "zenmux", modelId: "claude-sonnet-4-6" },
      null,
    ),
    { provider: "zenmux", modelId: "claude-sonnet-4-6", thinkingLevel: null },
  );
  // 只覆盖思考级别（模型继承全局默认）：模型两字段保持 null
  assert.deepEqual(runtimeOverrideFromDraft(null, "high"), {
    provider: null,
    modelId: null,
    thinkingLevel: "high",
  });
});

test("组装与判定连起来用：加载完成后的草稿不会触发保存", () => {
  const configured = {
    provider: "zenmux",
    modelId: "claude-sonnet-4-6",
    thinkingLevel: "high",
  };
  const draft = runtimeOverrideFromDraft(
    { provider: configured.provider, modelId: configured.modelId },
    configured.thinkingLevel,
  );
  assert.deepEqual(draft, configured);
  assert.equal(needsRuntimeSave(configured, draft), false);
});
