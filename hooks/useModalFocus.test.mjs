/**
 * 模态焦点「接线层」的落盘断言（票 03，S2）。
 *
 * 分层（与 02 票沿用）：规则是 `lib/modal-focus.ts` 的纯函数，由
 * `lib/modal-focus.test.mjs` 钉住；浏览器里的行为（移入 / 回绕 / 归还 / 让路）
 * 由 ego-browser 实测。这里只钉一件事：**接线只写一份**，三个消费方
 * （`BrutalModal` / `ModelsConfig` / `SkillsConfig`）都走这一个 hook。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const load = () => jiti.import("./useModalFocus.ts");

const hookSource = await readFile(
  new URL("./useModalFocus.ts", import.meta.url),
  "utf8",
);

test("S2: 共享接线层导出 useModalFocus", async () => {
  const mod = await load();
  assert.equal(typeof mod.useModalFocus, "function");
});

test("S2: 判定全部交给 lib/modal-focus.ts，接线层不自己重写一份", () => {
  assert.match(
    hookSource,
    /import \{ collectTabbables, nextTabTarget \} from "@\/lib\/modal-focus"/,
  );
});

test("S2: Tab 边界由规则层裁决（nextTabTarget + preventDefault 后移焦）", () => {
  assert.match(hookSource, /nextTabTarget\(/);
  assert.match(hookSource, /e\.preventDefault\(\)/);
});

test("S2: 焦点不在对话框里时按方向拉回边界（body 也算「不在」）", () => {
  // `document.activeElement` 无焦点时就是 body；直接传给规则层会命中 indexOf === -1
  // 的「让浏览器自己走」分支，背景就会被 Tab 到。
  assert.match(
    hookSource,
    /dialog\.contains\(activeElement\) \? activeElement : null/,
  );
});

test("S2: 打开时移入焦点只做一次（父级重渲染不抢回）", () => {
  assert.match(hookSource, /initialFocusDoneRef/);
});

test("S2: 子浮层（叠加的 role=dialog aria-modal=true）在场时让路", () => {
  // 叠层语义：Esc 只关最上层；下层既不接管 Tab 也不重复响应 Escape。
  assert.match(hookSource, /focusInChildDialog/);
  assert.match(
    hookSource,
    /closest\(\s*'\[role="dialog"\]\[aria-modal="true"\]'\s*\)/,
  );
});

test("S2: 关闭后焦点归还 opener（渲染期捕获 + isConnected 守卫）", () => {
  // opener 必须在渲染期记下：子内容的 autoFocus 会在 commit 阶段抢走焦点。
  assert.match(hookSource, /document\.activeElement/);
  assert.match(hookSource, /!dialog\.isConnected && opener/);
  assert.match(hookSource, /opener\.focus\(\)/);
});

test("S2: 三个消费方都只消费共享接线层，不再各自 import 判定函数", async () => {
  for (const file of [
    "../components/BrutalModal.tsx",
    "../components/ModelsConfig.tsx",
    "../components/SkillsConfig.tsx",
  ]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(
      source,
      /import \{ useModalFocus \} from "@\/hooks\/useModalFocus"/,
      `${file} 应消费共享接线层`,
    );
    assert.match(
      source,
      /useModalFocus[<(]/,
      `${file} 应调用 useModalFocus`,
    );
    assert.doesNotMatch(
      source,
      /from "@\/lib\/modal-focus"/,
      `${file} 不应各自接判定层（接线只写一份）`,
    );
  }
});
