import assert from "node:assert/strict";
import test from "node:test";
import { dismissKey, isOutsideTarget } from "./overlay-dismiss.ts";

// ---------------------------------------------------------------------------
// 票 #288：弹层关场判定层（零 DOM / 零 React）。
// 真浏览器里的焦点归位由 ego-browser 实测；这里钉的是「该不该关」的规则本身。
// ---------------------------------------------------------------------------

function nodeContaining(inside) {
  return {
    contains(target) {
      return target === inside;
    },
  };
}

const INSIDE = { name: "inside" };
const OUTSIDE = { name: "outside" };

test("#288: 内部点击不关", () => {
  assert.equal(isOutsideTarget(INSIDE, [nodeContaining(INSIDE)]), false);
});

test("#288: 外部点击关", () => {
  assert.equal(isOutsideTarget(OUTSIDE, [nodeContaining(INSIDE)]), true);
});

test("#288: 弹层与触发器任一命中都算内部", () => {
  const triggerHit = nodeContaining(INSIDE);
  const panelMiss = nodeContaining({ name: "panel-only" });
  assert.equal(isOutsideTarget(INSIDE, [panelMiss, triggerHit]), false);
});

test("#288: 空引用节点跳过，不会抛错", () => {
  const nodes = [null, undefined, nodeContaining(INSIDE)];
  assert.equal(isOutsideTarget(INSIDE, nodes), false);
  assert.equal(isOutsideTarget(OUTSIDE, nodes), true);
});

test("#288: target 为 null / undefined 不抛错，且不贸然关闭", () => {
  assert.equal(isOutsideTarget(null, [nodeContaining(INSIDE)]), false);
  assert.equal(isOutsideTarget(undefined, [nodeContaining(INSIDE)]), false);
});

test("#288: 没有任何边界时，有目标即视为外部", () => {
  assert.equal(isOutsideTarget(OUTSIDE, []), true);
});

test("#288: Escape 关闭，其它键不关闭", () => {
  assert.equal(dismissKey("Escape"), true);
  for (const key of ["Tab", "Enter", " ", "a", "Esc", "escape", ""]) {
    assert.equal(dismissKey(key), false, `${key || "空字符串"} 不应触发关闭`);
  }
});
