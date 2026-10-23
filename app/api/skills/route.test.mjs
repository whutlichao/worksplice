import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = mkdtempSync(join(tmpdir(), "skills-route-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET, PATCH } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");

// PATCH 的允许根 = getAgentDir() + 会话推导根；GET 只用会话推导根，
// 因此显式把临时 cwd 加入允许列表，覆盖 DefaultResourceLoader 的读取路径。
allowFileRoot(agentDir);

after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
});

const SKILL_BODY = [
  "---",
  "name: demo",
  'description: "Demo: formatting must survive"',
  "license: MIT",
  "metadata:",
  "  owner: platform",
  "---",
  "",
  "# Demo",
  "",
  "Line with trailing spaces   ",
  "Second line",
  "",
].join("\n");

function skillPath(name = "demo") {
  const dir = join(agentDir, "skills", name);
  mkdirSync(dir, { recursive: true });
  return join(dir, "SKILL.md");
}

function patchRequest(body) {
  return new Request("http://localhost:30142/api/skills", {
    method: "PATCH",
    headers: { "content-type": "application/json", host: "localhost:30142" },
    body: JSON.stringify(body),
  });
}

test("GET lists skills through DefaultResourceLoader for a permitted cwd", async () => {
  const filePath = skillPath("loadable");
  writeFileSync(filePath, "---\nname: loadable\ndescription: loader check\n---\n\n# Body\n", "utf8");

  const response = await GET(new Request(
    `http://localhost:30142/api/skills?cwd=${encodeURIComponent(agentDir)}`,
    { headers: { host: "localhost:30142" } },
  ));

  assert.equal(response.status, 200);
  const body = await response.json();
  const skill = body.skills.find((entry) => entry.name === "loadable");
  assert.ok(skill, "agent-dir skill is discovered by the resource loader");
  assert.equal(skill.filePath, filePath);
  assert.equal(skill.disableModelInvocation, false);
  assert.ok(Array.isArray(body.diagnostics));
});

test("PATCH enable inserts only disable-model-invocation and preserves every other byte", async () => {
  const filePath = skillPath();
  writeFileSync(filePath, SKILL_BODY, "utf8");

  const response = await PATCH(patchRequest({ filePath, disableModelInvocation: true }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });

  const updated = readFileSync(filePath, "utf8");
  assert.equal(updated, SKILL_BODY.replace(/^---\n/, "---\ndisable-model-invocation: true\n"));
  assert.equal((updated.match(/^disable-model-invocation:/gm) ?? []).length, 1);
});

test("PATCH disable removes only the key line and restores the original bytes", async () => {
  const filePath = skillPath("restore");
  writeFileSync(filePath, SKILL_BODY, "utf8");

  assert.equal((await PATCH(patchRequest({ filePath, disableModelInvocation: true }))).status, 200);
  assert.equal((await PATCH(patchRequest({ filePath, disableModelInvocation: false }))).status, 200);

  assert.equal(readFileSync(filePath, "utf8"), SKILL_BODY);
});

test("PATCH enable creates frontmatter when the file has none", async () => {
  const filePath = skillPath("bare");
  const content = "# Bare skill\n\nNo frontmatter here.\n";
  writeFileSync(filePath, content, "utf8");

  assert.equal((await PATCH(patchRequest({ filePath, disableModelInvocation: true }))).status, 200);
  assert.equal(
    readFileSync(filePath, "utf8"),
    `---\ndisable-model-invocation: true\n---\n${content}`,
  );
});

test("PATCH rejects missing fields, missing files and out-of-root paths", async (t) => {
  const filePath = skillPath("errors");
  writeFileSync(filePath, SKILL_BODY, "utf8");
  t.after(() => rmSync(filePath, { force: true }));

  assert.equal((await PATCH(patchRequest({ disableModelInvocation: true }))).status, 400);
  assert.equal((await PATCH(patchRequest({
    filePath: join(agentDir, "skills", "missing", "SKILL.md"),
    disableModelInvocation: true,
  }))).status, 404);

  const outside = mkdtempSync(join(tmpdir(), "skills-route-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const outsideFile = join(outside, "SKILL.md");
  writeFileSync(outsideFile, SKILL_BODY, "utf8");
  assert.equal((await PATCH(patchRequest({ filePath: outsideFile, disableModelInvocation: true }))).status, 403);
  assert.equal(readFileSync(outsideFile, "utf8"), SKILL_BODY);
});
