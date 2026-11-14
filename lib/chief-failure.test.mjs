import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * 首席失败码 → 文案的单一映射（评审 finding：弹窗按前缀猜码、频道页有自己的一张表）。
 *
 * 接缝 = `lib/chief-failure.ts` 的纯函数 + 两个消费方的源码（两处都在浏览器里跑，
 * 提交链路要真发请求才能走到，故用源码级断言守「共用同一份」这一件事）。
 */

const { CHIEF_FAILURE_KEYS, chiefFailureText, isChiefFailureCode } = await import(
  "./chief-failure.ts"
);

const fakeT = (key) => `t:${key}`;

test("每个拒绝码都有文案，未知码 / 缺码退回服务端消息（不吞原因）", () => {
  for (const code of Object.keys(CHIEF_FAILURE_KEYS)) {
    assert.equal(isChiefFailureCode(code), true, code);
    assert.equal(chiefFailureText(fakeT, code, "server said"), `t:${CHIEF_FAILURE_KEYS[code]}`);
  }
  assert.equal(isChiefFailureCode("not_a_chief_code"), false);
  assert.equal(isChiefFailureCode(undefined), false);
  assert.equal(chiefFailureText(fakeT, "not_a_chief_code", "server said"), "server said");
  assert.equal(chiefFailureText(fakeT, undefined, "server said"), "server said");
});

test("覆盖三条写面回的全部码（含弹窗此前漏掉的 not_channel_member / channel_not_found）", () => {
  // 明细来自协作域：频道首席 6 码 + 全局首席复用其中 3 码
  assert.deepEqual(Object.keys(CHIEF_FAILURE_KEYS).sort(), [
    "channel_not_found",
    "human_member",
    "member_deleted",
    "member_not_found",
    "not_channel_member",
    "owner_only",
  ]);
  // 中文文案存在（不是占位 key 直出）
  assert.equal(chiefFailureText(fakeT, "not_channel_member", "x"), "t:chief.failNotChannelMember");
});

test("两个消费方共用这一份映射：不再各写一套前缀匹配 / 私有表", async () => {
  for (const file of ["../components/ChannelView.tsx", "../components/CreateChannelModal.tsx"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf-8");
    assert.match(
      source,
      /from "@\/lib\/chief-failure"/,
      `${file} 必须从唯一映射模块取文案`,
    );
    assert.doesNotMatch(
      source,
      /code\?\.startsWith\(|const CHIEF_FAILURE_KEYS/,
      `${file} 不得自带一套码映射 / 前缀猜码`,
    );
  }
});
