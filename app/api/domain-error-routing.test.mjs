import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";
import { DomainError, jsonError } from "../../lib/domain/errors.ts";

/**
 * 票 #277 的主要证据：表驱动「错误类 × 期望 (status, code) × 路由接线」。
 *
 * - 表里每一行 = 一个导出的领域错误类；新增 DomainError 子类不登记即红（动态发现 + 双向比对）。
 * - 有 HTTP 面可触达的类必须列出至少一条 route：该 route 的 catch 只能经 `jsonError` 译码，
 *   且不得出现把 unknown 拆成 `instanceof Error` 三分支的手写映射。
 * - 三个没有真实 HTTP 面的类（MemberOperationDeniedError / RoomPrivateChannelForbidden /
 *   RoomBudgetError）今天没有任何 route 会收到它们；表里显式记录（`notHttpReachable`），
 *   不伪造一条不存在的映射。
 * - 行为面抽验：AgentNotFoundError / ReminderNotFoundError 各在两条真实 route 上返回同一状态码。
 */

const ROUTE_ROOT = new URL("./", import.meta.url);
const readRoute = (relativePath) =>
  readFile(new URL(relativePath, ROUTE_ROOT), "utf-8");

/** 递归发现 app/api 下所有 route.ts（只做源码守卫，不依赖路径清单）。 */
function discoverRouteFiles(dir = ROUTE_ROOT) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
    if (entry.isDirectory()) files.push(...discoverRouteFiles(url));
    else if (entry.name === "route.ts") files.push(url);
  }
  return files;
}

const collab = await import("../../lib/domain/collab/index.ts");

const TABLE = [
  {
    name: "ChannelStopError",
    make: () => new collab.ChannelStopError(404, "channel_not_found", "Channel not found"),
    status: 404,
    code: "channel_not_found",
    routes: ["channels/[id]/stop/route.ts"],
  },
  {
    name: "GlobalChiefError",
    make: () => new collab.GlobalChiefError(404, "member_not_found", "Member not found: x"),
    status: 404,
    code: "member_not_found",
    routes: ["global-chief/route.ts"],
  },
  {
    name: "ChannelChiefError",
    make: () => new collab.ChannelChiefError(404, "channel_not_found", "Channel not found"),
    status: 404,
    code: "channel_not_found",
    routes: ["channels/[id]/chief/route.ts", "channels/route.ts"],
  },
  {
    name: "AgentNotFoundError",
    make: () => new collab.AgentNotFoundError("missing-agent"),
    status: 404,
    code: "agent_not_found",
    routes: [
      "members/[id]/route.ts",
      "members/[id]/inbox/route.ts",
      "members/[id]/dm/route.ts",
      "members/[id]/runtime/route.ts",
      "members/[id]/observability/route.ts",
      "members/[id]/transcript/route.ts",
    ],
  },
  {
    name: "DuplicateAgentNameError",
    make: () => new collab.DuplicateAgentNameError("Alice"),
    status: 409,
    code: "agent_name_conflict",
    routes: ["members/route.ts"],
  },
  {
    name: "ReminderNotFoundError",
    make: () => new collab.ReminderNotFoundError("missing-reminder"),
    status: 404,
    code: "reminder_not_found",
    routes: [
      "reminders/[id]/route.ts",
      "reminders/[id]/snooze/route.ts",
      "reminders/[id]/cancel/route.ts",
      "reminders/[id]/log/route.ts",
    ],
  },
  {
    name: "ReminderNotAuthorizedError",
    make: () => new collab.ReminderNotAuthorizedError(),
    status: 403,
    code: "reminder_not_authorized",
    routes: ["reminders/[id]/route.ts", "reminders/[id]/snooze/route.ts", "reminders/[id]/cancel/route.ts"],
  },
  {
    name: "TaskAlreadyExistsError",
    make: () => new collab.TaskAlreadyExistsError(),
    status: 409,
    code: "task_already_exists",
    routes: ["tasks/route.ts"],
  },
  {
    name: "InvalidTaskTransitionError",
    make: () => new collab.InvalidTaskTransitionError("todo", "done"),
    status: 400,
    code: "invalid_task_transition",
    routes: ["tasks/[id]/update-status/route.ts"],
  },
  {
    name: "TaskNotAuthorizedError",
    make: () => new collab.TaskNotAuthorizedError("Only the task owner can do this"),
    status: 403,
    code: "task_not_authorized",
    routes: ["tasks/[id]/update-status/route.ts"],
  },
  {
    name: "TaskClaimConflictError",
    make: () => new collab.TaskClaimConflictError("conflict", "Already claimed"),
    status: 409,
    code: "task_claim_conflict",
    details: { conflict: true, reason: "Already claimed" },
    routes: ["tasks/[id]/update-status/route.ts"],
  },
  {
    name: "MemberOperationDeniedError",
    make: () => new collab.MemberOperationDeniedError("archiveChannel", "human only"),
    status: 403,
    code: "member_operation_denied",
    routes: [],
    notHttpReachable:
      "archive route 恒传 CURRENT_MEMBER_ID（Owner），成员能力表对 Owner 放行；该错误只在 agent 身份调用服务层时抛。",
  },
  {
    name: "RoomPrivateChannelForbidden",
    make: () => new collab.RoomPrivateChannelForbidden(),
    status: 403,
    code: "room_private_channel_forbidden",
    routes: [],
    notHttpReachable:
      "sendMessage 只在 agent-loop 传入 roomContext 时抛；HTTP POST /api/messages 不传 roomContext。",
  },
  {
    name: "RoomBudgetError",
    make: () => new collab.RoomBudgetError("hop_limit_exceeded", "Hop limit exceeded"),
    status: 429,
    code: "hop_limit_exceeded",
    routes: [],
    notHttpReachable:
      "直连链预算原语只被 agent-loop / 测试调用，今天没有 HTTP route 消费它。",
  },
];

const uniqueSorted = (values) => [...new Set(values)].sort();

test("table covers every exported DomainError subclass (new class without a row is red)", () => {
  const discovered = uniqueSorted(
    Object.entries(collab)
      .filter(
        ([name, value]) =>
          name !== "DomainError" &&
          typeof value === "function" &&
          value.prototype instanceof DomainError,
      )
      .map(([name]) => name),
  );
  assert.deepEqual(discovered, uniqueSorted(TABLE.map((row) => row.name)));
});

for (const row of TABLE) {
  test(`${row.name} → ${row.status} ${row.code}`, async () => {
    const error = row.make();
    assert.ok(error instanceof DomainError, `${row.name} must extend DomainError`);
    assert.equal(error.status, row.status);
    assert.equal(error.code, row.code);

    const response = jsonError(error);
    assert.equal(response.status, row.status);
    const body = await response.json();
    assert.equal(body.error, error.message);
    assert.equal(body.code, row.code);
    for (const [key, value] of Object.entries(row.details ?? {})) {
      assert.deepEqual(body[key], value);
    }
  });
}

test("each route-linked error class is decoded through jsonError, never hand-mapped", async () => {
  for (const row of TABLE) {
    assert.ok(
      row.routes.length > 0 || row.notHttpReachable,
      `${row.name}: either list a route or explain why no HTTP route can receive it`,
    );
    for (const route of row.routes) {
      const source = await readRoute(route);
      assert.match(source, /jsonError\(error/, `${route} must decode via jsonError`);
      assert.doesNotMatch(source, /instanceof Error \?/, `${route} must not hand-map unknown errors`);
    }
  }
});

test("no API route hand-maps unknown errors with instanceof Error", async () => {
  for (const file of discoverRouteFiles()) {
    const source = await readFile(file, "utf-8");
    assert.doesNotMatch(
      source,
      /instanceof Error \?/,
      `${file.pathname}: error decoding must go through jsonError / errorMessage`,
    );
  }
});

test("no API route hand-maps a known domain error class", async () => {
  const names = TABLE.map((row) => row.name);
  for (const file of discoverRouteFiles()) {
    const source = await readFile(file, "utf-8");
    for (const name of names) {
      assert.doesNotMatch(
        source,
        new RegExp(`instanceof\\s+${name}\\b`),
        `${file.pathname}: ${name} must be decoded by jsonError, not hand-mapped`,
      );
    }
  }
});

test("jsonError keeps the route fallback for unknown errors (default 500)", async () => {
  const plain = await jsonError(new Error("boom")).json();
  assert.deepEqual(plain, { error: "boom" });
  const response = jsonError(new Error("boom"));
  assert.equal(response.status, 500);

  const fallback = jsonError(new Error("bad input"), 400);
  assert.equal(fallback.status, 400);
  const opaque = await jsonError(new Error("/secret/path"), 500, {
    fallbackMessage: "Unable to read agent transcript",
  }).json();
  assert.deepEqual(opaque, { error: "Unable to read agent transcript" });
  const domain = jsonError(new collab.AgentNotFoundError("x"), 400);
  assert.equal(domain.status, 404, "domain status wins over the route fallback");
});

test("TaskClaimConflictError keeps the frontend conflict/blocked 409 compatibility fields", async () => {
  const conflict = jsonError(new collab.TaskClaimConflictError("conflict", "already claimed"));
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), {
    conflict: true,
    reason: "already claimed",
    error: "already claimed",
    code: "task_claim_conflict",
  });

  const blocked = jsonError(new collab.TaskClaimConflictError("blocked", "reopened task"));
  assert.equal(blocked.status, 409);
  assert.deepEqual(await blocked.json(), {
    blocked: true,
    reason: "reopened task",
    error: "reopened task",
    code: "task_claim_blocked",
  });
});

// ---------------------------------------------------------------------------
// 行为面：同一错误跨两条真实 route 返回同一状态码（AgentNotFoundError / ReminderNotFoundError）
// ---------------------------------------------------------------------------

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-domain-errors-"));
const { openDataDb } = await import("../../lib/data/sqlite.ts");
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  delete globalThis.__workspliceDb;
  fs.rmSync(root, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const membersGet = (await jiti.import("./members/[id]/route.ts")).GET;
const inboxGet = (await jiti.import("./members/[id]/inbox/route.ts")).GET;
const reminderGet = (await jiti.import("./reminders/[id]/route.ts")).GET;
const reminderSnooze = (await jiti.import("./reminders/[id]/snooze/route.ts")).POST;
const taskClaim = (await jiti.import("./tasks/[id]/claim/route.ts")).POST;
const taskUpdateStatus = (await jiti.import("./tasks/[id]/update-status/route.ts")).POST;

const params = (id) => ({ params: Promise.resolve({ id }) });

test("AgentNotFoundError returns 404 + agent_not_found from two different routes", async () => {
  const first = await membersGet(
    new Request("http://localhost/api/members/missing"),
    params("missing"),
  );
  const second = await inboxGet(
    new Request("http://localhost/api/members/missing/inbox"),
    params("missing"),
  );
  assert.equal(first.status, 404);
  assert.equal(second.status, 404);
  assert.deepEqual(await first.json(), {
    error: "Agent not found: missing",
    code: "agent_not_found",
  });
  assert.deepEqual(await second.json(), {
    error: "Agent not found: missing",
    code: "agent_not_found",
  });
});

test("ReminderNotFoundError returns 404 + reminder_not_found from two different routes", async () => {
  const first = await reminderGet(
    new Request("http://localhost/api/reminders/missing"),
    params("missing"),
  );
  const second = await reminderSnooze(
    new Request("http://localhost/api/reminders/missing/snooze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ minutes: 5 }),
    }),
    params("missing"),
  );
  assert.equal(first.status, 404);
  assert.equal(second.status, 404);
  assert.deepEqual(await first.json(), {
    error: "Reminder not found: missing",
    code: "reminder_not_found",
  });
  assert.deepEqual(await second.json(), {
    error: "Reminder not found: missing",
    code: "reminder_not_found",
  });
});

test("missing tasks return 404 + task_not_found from claim and update-status (no 400 drift)", async () => {
  const claim = await taskClaim(
    new Request("http://localhost/api/tasks/missing/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
    params("missing"),
  );
  const update = await taskUpdateStatus(
    new Request("http://localhost/api/tasks/missing/update-status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "todo" }),
    }),
    params("missing"),
  );
  assert.equal(claim.status, 404);
  assert.equal(update.status, 404);
  assert.deepEqual(await claim.json(), { error: "Task not found", code: "task_not_found" });
  assert.deepEqual(await update.json(), { error: "Task not found", code: "task_not_found" });
});
