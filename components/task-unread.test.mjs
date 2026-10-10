import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { TaskBoard, TaskViews, sortUnreadTasks } = await jiti.import(
  "./ChannelView.tsx",
);
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const OWNER = {
  id: "owner",
  type: "human",
  name: "Owner",
  description: "",
  role: "owner",
  workspace_path: null,
  pi_session_file: null,
  status: "online",
  created_at: "2026-10-10T00:00:00.000Z",
};

function task(id, number, status, latestUnreadReplyAt, unreadReplyCount = 1) {
  const anchor = {
    id: `anchor-${id}`,
    target_id: "c1",
    seq: number,
    author_id: OWNER.id,
    content: `task-unread-${id}`,
    created_at: latestUnreadReplyAt,
    author: OWNER,
  };
  return {
    id,
    message_id: anchor.id,
    number,
    status,
    owner_id: null,
    reopened: 0,
    updated_at: latestUnreadReplyAt,
    channelId: "c1",
    anchor,
    owner: null,
    reachable: [],
    unreadReplyCount,
    latestUnreadReplyAt,
  };
}

const newest = "2026-10-10T12:00:00.000Z";
const tied = "2026-10-10T11:00:00.000Z";
const older = "2026-10-10T10:00:00.000Z";
const allTasks = [
  task("todo-old", 2, "todo", older, 1),
  task("closed", 5, "closed", newest, 1),
  task("todo-tie-b", 8, "todo", tied, 2),
  task("done", 4, "done", tied, 1),
  task("in-progress", 9, "in_progress", newest, 1),
  task("todo-late", 7, "todo", newest, 126),
  task("in-review", 6, "in_review", older, 3),
  task("read", 1, "todo", newest, 0),
  task("todo-tie-a", 3, "todo", tied, 1),
];

function renderI18n(children) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, children),
  );
}

function viewProps(tasks, overrides = {}) {
  return {
    tasks,
    currentMemberId: OWNER.id,
    busy: false,
    disabled: false,
    error: null,
    notice: null,
    onCreateTask: () => undefined,
    onAction: () => undefined,
    onOpenThread: () => undefined,
    onNotice: () => undefined,
    onUnreadOnlyChange: () => undefined,
    ...overrides,
  };
}

test("unread Tasks sort newest first, then Task number, without mutating input", () => {
  const input = [
    task("older", 1, "done", older),
    task("newer-high", 8, "todo", newest),
    task("read", 0, "todo", "2026-10-10T13:00:00.000Z", 0),
    task("newer-low", 2, "closed", newest),
    task("middle", 5, "in_progress", tied),
  ];
  const original = [...input];
  const sorted = sortUnreadTasks(input);

  assert.deepEqual(
    sorted.map(({ number }) => number),
    [2, 8, 5, 1],
  );
  assert.deepEqual(input, original, "filter/sort must not mutate shared task state");
});

test("unread-only List preserves all status groups and shows exact task details", () => {
  const html = renderI18n(
    React.createElement(TaskViews, viewProps(allTasks, { unreadOnly: true })),
  );
  const visibleItems = [
    "todo-late",
    "todo-tie-a",
    "todo-tie-b",
    "todo-old",
    "in-progress",
    "in-review",
    "done",
    "closed",
  ];
  const positions = visibleItems.map((id) => html.indexOf(`task-unread-${id}`));

  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.doesNotMatch(html, /task-unread-read/, "read Tasks are filtered out");
  assert.equal((html.match(/class="task-group"/g) ?? []).length, 5);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /Unread replies: 126/);
  assert.match(
    html,
    /aria-label="Task #7; status Pool; unread replies: 126"/,
  );
  for (const status of ["Pool", "In progress", "In review", "Done", "Closed"]) {
    assert.ok(html.includes(status), `filtered result should retain ${status} context`);
  }
});

test("unread-only Board keeps five status columns and sorted cards within each column", () => {
  const unreadTasks = sortUnreadTasks(allTasks);
  const html = renderI18n(
    React.createElement(TaskBoard, {
      tasks: unreadTasks,
      currentMemberId: OWNER.id,
      busy: false,
      showUnreadDetails: true,
      onAction: () => undefined,
      onOpenThread: () => undefined,
      onInvalidDrop: () => undefined,
    }),
  );
  const visibleItems = [
    "todo-late",
    "todo-tie-a",
    "todo-tie-b",
    "todo-old",
    "in-progress",
    "in-review",
    "done",
    "closed",
  ];
  const positions = visibleItems.map((id) => html.indexOf(`task-unread-${id}`));

  assert.equal((html.match(/class="col"/g) ?? []).length, 5);
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.match(html, /Unread replies: 126/);
  assert.match(
    html,
    /aria-label="Task #7; status Pool; unread replies: 126"/,
  );
});
