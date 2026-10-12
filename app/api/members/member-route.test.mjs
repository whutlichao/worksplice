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

async function patchMember(id, body) {
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
    const response = await patchMember(agent.id, { avatarTint: tint });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).agent.avatar_tint, tint);
  }

  assert.equal((await patchMember(other.id, { avatarTint: 2 })).status, 200);
  assert.equal(globalThis.__workspliceDb.getMember(other.id).avatar_tint, 2);
  assert.equal((await patchMember(agent.id, { avatarTint: null })).status, 200);
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
    const response = await patchMember(agent.id, { avatarTint });
    assert.equal(response.status, 400, `accepted ${JSON.stringify(avatarTint)}`);
    assert.equal(globalThis.__workspliceDb.getMember(agent.id).avatar_tint, 1);
  }
  assert.equal((await patchMember(agent.id, {})).status, 400);
});

test("member PATCH trims and persists descriptions, including clearing them, without changing other fields", async () => {
  const agent = insertAgent("description-route-agent");
  globalThis.__workspliceDb.setMemberAvatarTint(agent.id, 2);
  globalThis.__workspliceDb.setMemberPiSessionFile(agent.id, "/fake/session.jsonl");
  const before = globalThis.__workspliceDb.getMember(agent.id);

  const saved = await patchMember(agent.id, {
    description: "  Coordinates the team  \n",
  });
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).agent, {
    ...before,
    description: "Coordinates the team",
  });
  assert.deepEqual(globalThis.__workspliceDb.getMember(agent.id), {
    ...before,
    description: "Coordinates the team",
  });

  const cleared = await patchMember(agent.id, { description: "   " });
  assert.equal(cleared.status, 200);
  assert.equal((await cleared.json()).agent.description, "");
  assert.equal(globalThis.__workspliceDb.getMember(agent.id).description, "");
});

test("member PATCH rejects invalid descriptions and unknown or deleted agents", async () => {
  const agent = insertAgent("invalid-description-route-agent");
  globalThis.__workspliceDb.updateMemberDescription(agent.id, "Keep this");

  for (const description of [null, 42, false, {}, []]) {
    const response = await patchMember(agent.id, { description });
    assert.equal(response.status, 400, `accepted ${JSON.stringify(description)}`);
    assert.equal(globalThis.__workspliceDb.getMember(agent.id).description, "Keep this");
  }
  assert.equal((await patchMember(agent.id, {})).status, 400);

  assert.equal((await patchMember("missing-description-route-agent", { description: "x" })).status, 404);
  globalThis.__workspliceDb.setMemberDeleted(agent.id, 1);
  assert.equal((await patchMember(agent.id, { description: "x" })).status, 404);
  assert.equal(globalThis.__workspliceDb.getMember(agent.id).description, "Keep this");
});

test("member PATCH rejects a mixed avatarTint and description update without changing either field", async () => {
  const agent = insertAgent("mixed-description-route-agent");
  globalThis.__workspliceDb.setMemberAvatarTint(agent.id, 1);
  globalThis.__workspliceDb.updateMemberDescription(agent.id, "Keep this");

  const response = await patchMember(agent.id, {
    avatarTint: 3,
    description: "Do not save this",
  });

  assert.equal(response.status, 400);
  const unchanged = globalThis.__workspliceDb.getMember(agent.id);
  assert.equal(unchanged.avatar_tint, 1);
  assert.equal(unchanged.description, "Keep this");
});
