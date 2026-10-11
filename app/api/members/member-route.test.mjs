import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-avatar-tint-route-"));
const { openDataDb } = await import("../../../lib/data/sqlite.ts");
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { GET, PATCH } = await jiti.import("./[id]/route.ts");

function insertAgent(name) {
  return globalThis.__workspliceDb.insertMember({ type: "agent", name });
}

async function patchTint(id, body) {
  return PATCH(
    new Request(`http://localhost/api/members/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

test("member PATCH persists each allowed tint, permits duplicates, and clears to automatic", async () => {
  const agent = insertAgent("tint-route-agent");
  const other = insertAgent("tint-route-other");
  assert.equal(agent.avatar_tint, null);

  for (const tint of [0, 1, 2, 3]) {
    const response = await patchTint(agent.id, { avatarTint: tint });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).agent.avatar_tint, tint);
  }

  assert.equal((await patchTint(other.id, { avatarTint: 2 })).status, 200);
  assert.equal(globalThis.__workspliceDb.getMember(other.id).avatar_tint, 2);
  assert.equal((await patchTint(agent.id, { avatarTint: null })).status, 200);
  assert.equal(globalThis.__workspliceDb.getMember(agent.id).avatar_tint, null);

  const response = await GET(new Request(`http://localhost/api/members/${agent.id}`), {
    params: Promise.resolve({ id: agent.id }),
  });
  assert.equal((await response.json()).agent.avatar_tint, null);
});

test("member PATCH rejects non-index values without changing the saved tint", async () => {
  const agent = insertAgent("invalid-tint-route-agent");
  globalThis.__workspliceDb.setMemberAvatarTint(agent.id, 1);

  for (const avatarTint of [-1, 4, 1.5, "2", "blue", false, {}, []]) {
    const response = await patchTint(agent.id, { avatarTint });
    assert.equal(response.status, 400, `accepted ${JSON.stringify(avatarTint)}`);
    assert.equal(globalThis.__workspliceDb.getMember(agent.id).avatar_tint, 1);
  }
  assert.equal((await patchTint(agent.id, {})).status, 400);
});
