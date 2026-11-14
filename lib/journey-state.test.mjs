import assert from "node:assert/strict";
import test from "node:test";

const { countOpenTasks } = await import("./journey-state.ts");

/**
 * Tasks badge 未完成计数（本模块现在只承担这一项语义）：
 * todo / in_progress / in_review 计入，done / closed 不计入。
 * 引导卡已整体删除（票 journey-guide-removal），这里不再推导任何卡面形态，
 * 也不再看消息数。
 */

const tasks = (...statuses) =>
  statuses.map((status, index) => ({
    id: `task-${index + 1}`,
    status,
  }));

test("空任务列表 → 0", () => {
  assert.equal(countOpenTasks([]), 0);
});

test("只有 in_progress 也计入（未完成 = 待办 + 进行中 + 待复核）", () => {
  assert.equal(countOpenTasks(tasks("in_progress")), 1);
});

test("todo / in_progress / in_review 都计入", () => {
  assert.equal(countOpenTasks(tasks("todo", "in_progress", "in_review")), 3);
});

test("全部完成或关闭 → 0（done / closed 不计入）", () => {
  assert.equal(countOpenTasks(tasks("done", "closed")), 0);
});

test("混合状态只数未完成与待复核", () => {
  assert.equal(
    countOpenTasks(tasks("todo", "in_progress", "in_review", "done", "closed")),
    3,
  );
});
