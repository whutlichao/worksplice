import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ModelsEmptyHint, normalizeModelsBody } = await jiti.import("./CreateAgentModal.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

/** /api/models 的错误 body（app/api/models/route.ts：cwd 校验失败 → 400/403，无 modelList 字段）。 */
const ERROR_BODY = { error: "Access denied" };

function renderHint(models, loading) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, [
      React.createElement(ModelsEmptyHint, { key: "hint", models, loading }),
    ]),
  );
}

// 回归：点击「+ 新建 agent」→ modal 挂载 → fetch /api/models 拿到 { error }（无 modelList）
// → setModels(body) → 重渲染时 models?.modelList.length 抛
// TypeError: Cannot read properties of undefined (reading 'length')。
// 全仓 app/ 下无 error boundary（find app -name error.tsx 为空），抛错打穿整页 →
// Next.js 显示「This page couldn't load / Reload / Back」。

test("错误 body（缺 modelList）不抛错，且按「模型为空」提示渲染", () => {
  const html = renderHint(ERROR_BODY, false);
  assert.match(html, /Configure a model first/);
});

test("空 body {}（缺 modelList）不抛错，且按「模型为空」提示渲染", () => {
  const html = renderHint({}, false);
  assert.match(html, /Configure a model first/);
});

test("归一化后的错误 body 与裸错误 body 渲染结果一致", () => {
  // 归一化只补 modelList 缺省，不改文案/结构——两路渲染必须同形，
  // 否则「有 body」与「无 body」的 UI 会出现行为分叉。
  assert.equal(
    renderHint(normalizeModelsBody(ERROR_BODY), false),
    renderHint(ERROR_BODY, false),
  );
});

test("models 为 null 且加载完毕 → 渲染「模型为空」提示（首次加载失败不留白屏）", () => {
  assert.match(renderHint(null, false), /Configure a model first/);
});

test("加载中不渲染提示（避免先闪一句「没配模型」）", () => {
  assert.equal(renderHint(null, true), "");
  assert.equal(renderHint(ERROR_BODY, true), "");
});

test("modelList 非空 → 不渲染提示（对照组：正常路径不被误伤）", () => {
  const html = renderHint(
    { modelList: [{ id: "m1", name: "M1", provider: "p1" }] },
    false,
  );
  assert.equal(html, "");
});

test("modelList 为空数组 → 渲染提示", () => {
  assert.match(renderHint({ modelList: [] }, false), /Configure a model first/);
});

test("normalizeModelsBody：错误 body 补出完整 ModelsData 骨架", () => {
  const out = normalizeModelsBody(ERROR_BODY);
  assert.deepEqual(out.modelList, []);
  assert.deepEqual(out.models, {});
  assert.equal(out.defaultModel, null);
  assert.deepEqual(out.thinkingLevels, {});
  assert.deepEqual(out.thinkingLevelMaps, {});
  assert.deepEqual(out.thinkingLevelPins, {});
});

test("normalizeModelsBody：{} 与非对象 body 同样兜底（.catch(() => ({})) 那条路径）", () => {
  for (const body of [{}, null, undefined, "oops", 42, []]) {
    const out = normalizeModelsBody(body);
    assert.ok(Array.isArray(out.modelList), `modelList must be array for ${JSON.stringify(body)}`);
    assert.deepEqual(out.modelList, []);
  }
});

test("normalizeModelsBody：合法 body 原样保留（defaultModel / pins 不被抹掉）", () => {
  const body = {
    models: { "p1:m1": "M1" },
    modelList: [{ id: "m1", name: "M1", provider: "p1" }],
    defaultModel: { provider: "p1", modelId: "m1" },
    thinkingLevels: { "p1:m1": ["low", "high"] },
    thinkingLevelMaps: { "p1:m1": { low: "low" } },
    thinkingLevelPins: { "p1:m1": "high" },
  };
  assert.deepEqual(normalizeModelsBody(body), body);
});

test("normalizeModelsBody：局部残缺 body 补缺省而非整体丢弃", () => {
  const out = normalizeModelsBody({
    modelList: [{ id: "m1", name: "M1", provider: "p1" }],
  });
  assert.equal(out.modelList.length, 1);
  assert.deepEqual(out.thinkingLevelPins, {});
  assert.equal(out.defaultModel, null);
});