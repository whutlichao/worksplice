import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const [{ openDataDb }, { OWNER_MEMBER_ID }] = await Promise.all([
  jiti.import("../../lib/data/sqlite.ts"),
  jiti.import("../../lib/data/schema.ts"),
]);
const { POST } = await jiti.import("./tasks/[id]/read/route.ts");

test("POST task read advances only through the presented reply and reports the remaining count", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "task-thread-read-route-"));
  const store = openDataDb(root);
  globalThis.__workspliceDb = store;
  t.after(() => {
    store.close();
    delete globalThis.__workspliceDb;
    rmSync(root, { recursive: true, force: true });
  });

  const channel = store.insertChannel({ name: "thread-read-route" });
  const owner = store.getMember(OWNER_MEMBER_ID);
  assert.ok(owner);
  const agent = store.insertMember({ type: "agent", name: "thread-read-agent" });
  const anchor = store.appendMessage({
    targetId: channel.id,
    authorId: owner.id,
    content: "task anchor",
  });
  const task = store.insertTask({ messageId: anchor.id, number: 1 });
  const visible = store.appendMessage({
    targetId: anchor.id,
    authorId: agent.id,
    content: "presented reply",
  });
  store.appendMessage({
    targetId: anchor.id,
    authorId: owner.id,
    content: "Owner reply does not count",
  });
  store.appendMessage({
    targetId: anchor.id,
    authorId: agent.id,
    content: "not yet presented",
  });

  const response = await POST(
    new Request(`http://localhost/api/tasks/${task.id}/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ throughSeq: visible.seq }),
    }),
    { params: Promise.resolve({ id: task.id }) },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    baselineSeq: 0,
    readSeq: visible.seq,
    unreadReplyCount: 1,
  });

  const invalid = await POST(
    new Request(`http://localhost/api/tasks/${task.id}/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ throughSeq: -1 }),
    }),
    { params: Promise.resolve({ id: task.id }) },
  );
  assert.equal(invalid.status, 400);

  const nullBody = await POST(
    new Request(`http://localhost/api/tasks/${task.id}/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "null",
    }),
    { params: Promise.resolve({ id: task.id }) },
  );
  assert.equal(nullBody.status, 400);
});
