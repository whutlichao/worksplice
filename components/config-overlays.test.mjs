/**
 * 模型配置 / 技能配置两个浮层的对话框契约（票 03，S1 / S3）。
 *
 * 为什么两个组件一个文件：它们在本票里共享同一条验收语句（S1 对话框语义 + S3 关闭入口），
 * 断言也几乎同构。渲染 seam 与 `AppShell.test.mjs` / `BrutalModal.test.mjs` 同档：
 * `renderToStaticMarkup` + jiti 打到真正渲染出的 markup，再取 `role=dialog` 元素本身断言。
 *
 * 行为面（打开移入 / Tab 回绕 / Esc / 归还 opener / 叠层让路）不在 node 里断言——
 * 它需要真实焦点与 Tab 序，由 ego-browser 实测，读数见票据 Answer。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ModelsConfig } = await jiti.import("./ModelsConfig.tsx");
const { SkillsConfig } = await jiti.import("./SkillsConfig.tsx");
const { ModelPicker } = await jiti.import("./ModelPicker.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");
const { enLocale } = await jiti.import("../lib/i18n/messages/en.ts");
const { zhCNLocale } = await jiti.import("../lib/i18n/messages/zh-CN.ts");

function render(element) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, element),
  );
}

const OVERLAYS = [
  {
    name: "模型配置",
    render: () => render(React.createElement(ModelsConfig, { onClose: () => undefined })),
    titleId: "models-config-title",
    widthPx: 860,
  },
  {
    name: "技能配置",
    render: () => render(React.createElement(SkillsConfig, { onClose: () => undefined })),
    titleId: "skills-config-title",
    widthPx: 860,
  },
];

/** 取 `role="dialog"` 的开标签（本票两个浮层各自只渲染一个顶层对话框）。 */
function dialogTag(html) {
  const tag = html.match(/<div[^>]*\brole="dialog"[^>]*>/)?.[0];
  assert.ok(tag, "浮层根面板应带 role=dialog");
  return tag;
}

for (const overlay of OVERLAYS) {
  test(`S1（${overlay.name}）：根面板是 aria-modal 对话框，可访问名指向可见标题`, () => {
    const html = overlay.render();
    const tag = dialogTag(html);
    assert.match(tag, /aria-modal="true"/);
    assert.match(tag, new RegExp(`aria-labelledby="${overlay.titleId}"`));
    assert.match(
      html,
      new RegExp(`id="${overlay.titleId}"`),
      "aria-labelledby 必须指向 markup 里真实存在的可见标题",
    );
  });

  test(`S1（${overlay.name}）：对话框自身可承接兜底焦点（tabindex=-1，不进 Tab 序）`, () => {
    assert.match(dialogTag(overlay.render()), /tabindex="-1"/);
  });

  test(`S3（${overlay.name}）：关闭键是 .icon-btn + lucide X，带本地化可访问名`, () => {
    const html = overlay.render();
    // 关闭键必须是 .icon-btn（与 .modal-head 同形），且带 aria-label
    const buttons = html.match(/<button\b[^>]*class="icon-btn"[^>]*>[\s\S]*?<\/button>/g) ?? [];
    const close = buttons.find((button) => /aria-label="Close"/.test(button));
    assert.ok(close, "应有一个 aria-label=Close 的 .icon-btn 关闭键");
    assert.match(close, /<svg/, "关闭键内应渲染 lucide X 图标");
    assert.doesNotMatch(close, /outline/i, "关闭键不得压掉焦点环");
    // 不得再留纯文本「×」按钮
    assert.doesNotMatch(html, />\s*×\s*</);
  });

  test(`S1（${overlay.name}）：宽度自带，不借道 --modal-max / --modal-wide-max`, () => {
    const html = overlay.render();
    assert.match(html, new RegExp(`width:\\s*${overlay.widthPx}px`));
    assert.doesNotMatch(html, /class="modal(?: wide)?"/);
  });
}

test("S3：关闭键的可访问名复用两包已有的 common.close（不新增文案）", () => {
  for (const messages of [enLocale.messages, zhCNLocale.messages]) {
    assert.ok(messages["common.close"], "两包都应有 common.close");
  }
  assert.equal(enLocale.messages["common.close"], "Close");
  assert.equal(zhCNLocale.messages["common.close"], "关闭");
});

test("S2：模型配置里叠加的「添加 Provider」子浮层同样是对话框（叠层时下层让路）", async () => {
  // 该子浮层只在 `pickerOpen` 时渲染，静态渲染够不着；断言落在源码契约上：
  // 它必须自己带 role=dialog / aria-modal，并接同一个 `useModalFocus`
  // （少一条，叠层时下层模型配置就会抢走 Esc / Tab）。行为读数见票据 Answer。
  const source = await readFile(
    new URL("./ModelsConfig.tsx", import.meta.url),
    "utf8",
  );
  const picker = source.slice(source.indexOf("function AddProviderPicker"));
  assert.ok(picker.length > 0, "应存在 AddProviderPicker");
  assert.match(picker, /role="dialog"/);
  assert.match(picker, /aria-modal="true"/);
  assert.match(picker, /aria-label=\{t\("i18n\.addProvider"\)\}/);
  assert.match(picker, /useModalFocus<HTMLDivElement>\(onClose\)/);
  assert.doesNotMatch(picker, /onKeyDown=\{\(e\) => \{ if \(e\.key === "Escape"\)/, "Esc 应交给共享接线层，不再挂在搜索框上");
});

// ─── 票 04：票 03 漏掉的接线断言 + 两个新消费方的契约 ─────────────────────────

/**
 * 票 03 的缺口：`components/config-overlays.test.mjs` 只断 markup，把
 * `useModalFocus(onClose)` 换成 `useModalFocus(() => {})` 时该文件仍然全绿——
 * markup 一个字都不变，坏掉的只有接线。这里钉住「关闭回调必须是被传进来的那个」。
 *
 * 断言直接读源码而不是渲染结果：`onClose` 是调用方的引用，静态 markup 里看不见它；
 * 而「把 prop 交给接线层」正是本条要守的接线事实。
 */
const OVERLAY_SOURCES = [
  { name: "模型配置", file: "./ModelsConfig.tsx", closeProp: "onClose" },
  { name: "技能配置", file: "./SkillsConfig.tsx", closeProp: "onClose" },
];

for (const overlay of OVERLAY_SOURCES) {
  test(`票03 漏项（${overlay.name}）：关闭回调必须是调用方传进来的 ${overlay.closeProp}`, async () => {
    const source = await readFile(new URL(overlay.file, import.meta.url), "utf8");
    assert.match(
      source,
      /useModalFocus<HTMLDivElement>\(onClose\)/,
      `${overlay.name} 必须把 ${overlay.closeProp} 原样交给 useModalFocus，` +
        "换成内联空函数会让 Esc / 关闭退化成无操作而 markup 断言仍全绿",
    );
    assert.doesNotMatch(
      source,
      /useModalFocus<HTMLDivElement>\(\(\)\s*=>/,
      `${overlay.name} 的接线层回调不得是内联空函数`,
    );
  });
}

/**
 * T1（票 04）：`DirectoryPicker` 是唯一漏掉接线的对话框。
 *
 * 它 portal 到 body，`renderToStaticMarkup` 时 `portalTarget` 仍是 null、组件直接
 * `return null`（同 `DirectoryPicker.test.mjs` 的 seam 降级记录），所以断言落在源码：
 * 接线必须真的接上，且 `dialogRef` 挂在 `.directory-picker-backdrop`（`role="dialog"`
 * 的那个元素）而不是内层 panel——挂错根，`collectTabbables` 就少掉头部关闭键。
 */
test("T1：DirectoryPicker 接共享接线层，dialogRef 挂在 role=dialog 的 backdrop 上", async () => {
  const source = await readFile(
    new URL("./DirectoryPicker.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /import \{ useModalFocus \} from "@\/hooks\/useModalFocus"/,
    "DirectoryPicker 必须消费共享接线层，而不是自己再写一份焦点陷阱",
  );
  assert.match(
    source,
    /useModalFocus<HTMLDivElement>\(/,
    "DirectoryPicker 必须消费共享接线层",
  );
  // 关闭回调必须最终落到调用方传进来的 onCancel 上（空函数或别的东西都算接线断裂）。
  // 允许包一层 `busy` 守卫：原行为是选择进行中按 Esc 不关闭。
  const hookCall = source.match(
    /const dialogRef = useModalFocus<HTMLDivElement>\(([\s\S]*?)\n  \}\);/,
  )?.[1];
  assert.ok(hookCall, "应把 useModalFocus 的返回值命名为 dialogRef");
  assert.match(hookCall, /onCancel\(\)/, "关闭回调必须调用调用方传进来的 onCancel");
  assert.doesNotMatch(
    hookCall.replace(/onCancel\(\)/g, ""),
    /onCancel/,
    "除调用之外不得再出现 onCancel 的引用（避免接到别处）",
  );
  // ref 与 role=dialog 必须在同一个开标签上：这是「根是 backdrop」的结构性证据。
  const backdropTag = source.match(
    /<div\b[^>]*className="directory-picker-backdrop"[^>]*>/,
  )?.[0];
  assert.ok(backdropTag, "应存在 .directory-picker-backdrop 根元素");
  assert.match(backdropTag, /ref=\{dialogRef\}/, "dialogRef 必须挂在 backdrop 上");
  assert.match(backdropTag, /role="dialog"/);
  assert.match(
    backdropTag,
    /tabIndex=\{-1\}/,
    "对话框自身要能承接兜底焦点（tabIndex=-1 不进 Tab 序）",
  );
});

test("T1：DirectoryPicker 的 Esc 拦住 React 树冒泡（否则背后的面板一起关）", async () => {
  const source = await readFile(
    new URL("./DirectoryPicker.tsx", import.meta.url),
    "utf8",
  );
  // 实测：picker 在右栏 `aside` 的 React 子树里，Esc 会冒泡到 aside 的 onKeyDown，
  // 把背后打开的 agent 面板一起关掉。接线层的 Esc 监听在 window 上，拦不住 React 树。
  const escapeHandlers = [...source.matchAll(/onKeyDown=\{([\s\S]*?)\}\n/g)].map(
    ([, body]) => body,
  );
  const handler = escapeHandlers.find((body) => /Escape/.test(body));
  assert.ok(handler, "backdrop 应有 Escape 处理");
  assert.match(handler, /stopPropagation\(\)/);
});

test("T1：DirectoryPicker 的关闭键复用 DialogCloseButton（与各对话框同形）", async () => {
  const source = await readFile(
    new URL("./DirectoryPicker.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /import \{ DialogCloseButton \} from "\.\/DialogCloseButton"/,
    "关闭键一律复用 DialogCloseButton（.icon-btn + lucide X + common.close）",
  );
  assert.match(source, /<DialogCloseButton\b/);
  assert.doesNotMatch(
    source,
    />\s*×\s*</,
    "关闭键不得再是裸 × 文本按钮（票 03 已把同类替换成 DialogCloseButton）",
  );
});

/**
 * T2（票 04）：`ModelPicker` 的两个下拉补最小 popover 契约。
 *
 * 选 `role="dialog"` 而不是 `listbox`：面板里除选项还有过滤输入框与 provider 分组
 * 标题，`listbox` 会承诺一套本组件没有实现的方向键/type-ahead 模型。非模态 dialog
 * 的键盘模型就是真实 Tab 序——声明与实现相符。因此也**不**写 `aria-modal`
 * （它不拦整页 Tab，`useModalFocus` 的子浮层判定按 `[role=dialog][aria-modal=true]`
 * 走，非模态面板不会被误认为叠层对话框）。
 */
const MODEL_PICKER_FIXTURE = {
  models: {
    models: { "zenmux:claude-sonnet-4-6": "Claude Sonnet 4.6" },
    modelList: [
      { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "zenmux" },
      { id: "gpt-5", name: "GPT-5", provider: "openai" },
    ],
    defaultModel: null,
    thinkingLevels: {},
    thinkingLevelMaps: {},
    thinkingLevelPins: {},
  },
  model: { provider: "zenmux", modelId: "claude-sonnet-4-6" },
  thinkingLevel: "high",
};

function renderModelPicker() {
  return render(React.createElement(ModelPicker, MODEL_PICKER_FIXTURE));
}

test("T2：两个触发按钮声明 aria-expanded / aria-haspopup=dialog", () => {
  const html = renderModelPicker();
  const triggerTags = [...html.matchAll(/<button\b[^>]*>/g)].map(([tag]) => tag);
  const expanded = triggerTags.filter((tag) =>
    /aria-expanded="false"/.test(tag),
  );
  assert.equal(
    expanded.length,
    2,
    "模型与思考级别两个触发按钮都要暴露展开态（初始均收起）",
  );
  for (const tag of expanded) {
    assert.match(tag, /aria-haspopup="dialog"/, "弹出的是非模态 dialog 面板");
    assert.match(tag, /aria-controls="/, "展开态必须指向真实存在的面板 id");
  }
  // aria-controls 的目标必须真的在 markup 里（悬空 id 会让读屏报无效目标）。
  const controls = expanded
    .map((tag) => tag.match(/aria-controls="([^"]+)"/)?.[1])
    .filter(Boolean);
  assert.equal(new Set(controls).size, 2, "两个面板的 id 必须互不相同（同组件可多实例）");
  for (const id of controls) {
    assert.match(html, new RegExp(`id="${id}"`), `aria-controls 目标 #${id} 应存在于面板上`);
  }
});

test("T2：两个面板是带可访问名的非模态 dialog（不写 aria-modal）", () => {
  const html = renderModelPicker();
  const panels = [...html.matchAll(/<div\b[^>]*role="dialog"[^>]*>/g)].map(
    ([tag]) => tag,
  );
  assert.equal(panels.length, 2, "模型 / 思考级别各一个面板");
  assert.match(panels[0], /aria-label="Model"/);
  assert.match(panels[1], /aria-label="Thinking"/);
  for (const tag of panels) {
    assert.doesNotMatch(
      tag,
      /aria-modal/,
      "非模态 popover 不得声明 aria-modal——它不拦整页 Tab",
    );
    assert.match(tag, /tabindex="-1"/, "面板自身可承接兜底焦点");
  }
});

test("T2：打开时焦点移入面板、Esc 由本组件关闭并归还触发按钮", async () => {
  const source = await readFile(
    new URL("./ModelPicker.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /import \{ collectTabbables \} from "@\/lib\/modal-focus"/,
    "面板内首个可聚焦项必须走共享判定层，不另写一份选择器",
  );
  assert.match(source, /collectTabbables\(/, "打开时移焦到面板内首个可聚焦项");
  assert.match(
    source,
    /triggerRef|TriggerRef/,
    "关闭后要能把焦点还给触发按钮",
  );
  assert.match(source, /\.focus\(\)/, "Esc / 选择后归还焦点到触发按钮");
  // 注释里提到 autoFocus（解释它为何是死代码）不算：只检查非注释行还有没有这个 prop。
  const codeOnly = source
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  assert.doesNotMatch(
    codeOnly,
    /\bautoFocus\b/,
    "面板常驻 DOM + display 切换，autoFocus 永远不会生效（死代码会掩盖真正的移焦逻辑）",
  );
  const escapeBlock = source.match(
    /if \(event\.key !== "Escape"[\s\S]{0,400}/,
  )?.[0];
  assert.ok(escapeBlock, "组件自己要处理 Escape");
  assert.match(
    escapeBlock,
    /stopPropagation\(\)/,
    "Esc 必须拦住 React 树：否则淘汰到外层模态 / 右栏的 Esc 处理器",
  );
  assert.match(escapeBlock, /close(Model|Thinking)\(true\)/, "Esc 关闭并归还焦点");
});
