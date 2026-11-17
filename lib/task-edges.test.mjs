import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  TASK_ACTIONS,
  TASK_EDGES,
  taskActionRequest,
  taskEdgeFor,
  taskEdgesForReachable,
} = await jiti.import("./task-edges.ts");

const ACTIONS = [
  "claim",
  "complete",
  "unclaim",
  "close",
  "approve",
  "reject",
  "reopen",
];

test("任务动作边表：from→to 唯一，动作名只含既有七个 i18n key", () => {
  const pairs = TASK_EDGES.map((edge) => `${edge.from}->${edge.to}`);
  assert.equal(new Set(pairs).size, pairs.length, "from→to 不得重复");
  assert.deepEqual([...TASK_ACTIONS].sort(), [...ACTIONS].sort());
  for (const action of TASK_ACTIONS) {
    assert.ok(
      ACTIONS.includes(action),
      `动作名 ${action} 必须是既有 tasks.* key 的后缀（不新增文案 key）`,
    );
  }
});

test("任务动作边表：claim 只对应 todo→in_progress，其余请求 = updateStatus(to)", () => {
  for (const edge of TASK_EDGES) {
    if (edge.request.kind === "claim") {
      assert.deepEqual(
        { from: edge.from, to: edge.to, action: edge.action },
        { from: "todo", to: "in_progress", action: "claim" },
        "claim 是独立操作，只对应服务端合成的 todo→in_progress 边",
      );
    } else {
      assert.equal(
        edge.request.status,
        edge.to,
        `${edge.from}->${edge.to} 的 updateStatus 目标必须与边落点一致`,
      );
    }
  }
  assert.deepEqual(taskActionRequest("claim"), { kind: "claim" });
  assert.deepEqual(taskActionRequest("complete"), {
    kind: "updateStatus",
    status: "in_review",
  });
  assert.deepEqual(taskActionRequest("close"), {
    kind: "updateStatus",
    status: "closed",
  });
});

test("任务动作边表：danger 只属于 close 边（按钮走 btn-danger + 确认框）", () => {
  for (const edge of TASK_EDGES) {
    if (edge.action === "close") {
      assert.equal(edge.danger, true);
    } else {
      assert.notEqual(edge.danger, true, `${edge.action} 不应是危险态`);
    }
  }
});

test("同一动作在表内的请求唯一（action → request 无歧义）", () => {
  const byAction = new Map();
  for (const edge of TASK_EDGES) {
    const previous = byAction.get(edge.action);
    if (previous) {
      assert.deepEqual(
        edge.request,
        previous.request,
        `${edge.action} 的请求在表内必须唯一`,
      );
    } else {
      byAction.set(edge.action, edge);
    }
  }
});

test("reachable → 卡片动作：顺序保持服务端下发顺序，未知落点不伪造边", () => {
  assert.deepEqual(
    taskEdgesForReachable("in_progress", ["in_review", "todo", "closed"]).map(
      (edge) => edge.action,
    ),
    ["complete", "unclaim", "close"],
  );
  assert.deepEqual(
    taskEdgesForReachable("in_review", ["done", "in_progress", "closed"]).map(
      (edge) => edge.action,
    ),
    ["approve", "reject", "close"],
  );
  assert.deepEqual(taskEdgesForReachable("todo", []), []);
  assert.deepEqual(taskEdgesForReachable("todo", ["done"]), []);
  assert.equal(taskEdgeFor("done", "todo")?.action, "reopen");
});

test("边表 client-safe：不 import Node 内置、DB 与 React", async () => {
  const source = await readFile(
    new URL("./task-edges.ts", import.meta.url),
    "utf-8",
  );
  assert.doesNotMatch(source, /from\s+"node:/);
  assert.doesNotMatch(source, /better-sqlite3|db-singleton|sqlite/);
  assert.doesNotMatch(source, /from\s+"react"/);
});
