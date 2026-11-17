import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { useChannelData } = await jiti.import("./useChannelData.ts");

/**
 * #278 第一步的外部接口锁：字段名、顺序、值类别与基线逐字一致。
 *
 * 这里刻意不 import 任何类型/常量，快照必须是独立的一份字面量：若实现里悄悄
 * 增删字段、改字段顺序或把某个数组换成 Set（或反过来），本测试直接红。
 */
const EXPECTED_INTERFACE = [
  ["messages", "array"],
  ["messagesLoading", "boolean"],
  ["maxSeq", "number"],
  ["hasMore", "boolean"],
  ["loadError", "null"],
  ["loadPage", "function"],
  ["loadLatest", "function"],
  ["loadEarlier", "function"],
  ["send", "function"],
  ["heldNotice", "null"],
  ["busyAction", "boolean"],
  ["setBusyAction", "function"],
  ["setHeldNotice", "function"],
  ["pinnedItems", "array"],
  ["pinnedSort", "string"],
  ["setPinnedSort", "function"],
  ["pinnedError", "null"],
  ["pinnedLoading", "boolean"],
  ["togglePin", "function"],
  ["reorderPinned", "function"],
  ["mutes", "array"],
  ["mutesLoading", "boolean"],
  ["loadMutes", "function"],
  ["toggleMute", "function"],
  ["channelMemberIds", "Set"],
  ["membersLoading", "boolean"],
  ["membersError", "null"],
  ["loadMembers", "function"],
  ["tasks", "array"],
  ["tasksLoading", "boolean"],
  ["tasksError", "null"],
  ["taskNotice", "null"],
  ["setTasksError", "function"],
  ["setTaskNotice", "function"],
  ["loadTasks", "function"],
  ["runTaskTransition", "function"],
  ["completeTask", "function"],
  ["convertToTask", "function"],
  ["createTaskFromBoard", "function"],
  ["taskOps", "object"],
];

function typeTag(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (value instanceof Set) return "Set";
  if (typeof value === "function") return "function";
  return typeof value;
}

function captureInterface() {
  let captured;
  function Probe() {
    captured = useChannelData("channel-278");
    return null;
  }
  renderToStaticMarkup(React.createElement(Probe));
  assert.ok(captured, "useChannelData 必须在渲染时返回对象");
  return Object.keys(captured).map((key) => [key, typeTag(captured[key])]);
}

test("useChannelData 对外返回字段名/顺序/类型与基线逐字一致（#278）", () => {
  assert.equal(EXPECTED_INTERFACE.length, 40);
  assert.deepEqual(captureInterface(), EXPECTED_INTERFACE);
});
