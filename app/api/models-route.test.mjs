import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

// 隔离真实 pi agent 目录：allowlist 由会话列表推导，loadModels 还会读取
// auth/models/settings/trust。指向空临时目录后，测试不依赖开发机上的会话与配置，
// 显式 cwd 的 403 也成为确定性结果。
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = mkdtempSync(join(tmpdir(), "models-route-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET } = await jiti.import("./models/route.ts");

after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
});

/**
 * 把服务端 `process.cwd()` 指向一个不在 allowlist 里的新临时目录，
 * 复现打包模式（cwd = 安装目录，由服务端选定，而非客户端传入），
 * 从而不依赖本仓库所在路径恰好是某个 pi 会话的 cwd。
 */
async function withUnlistedServerCwd(t, fn) {
  const dir = mkdtempSync(join(tmpdir(), "models-route-server-cwd-"));
  const previous = process.cwd();
  process.chdir(dir);
  t.after(() => {
    process.chdir(previous);
    rmSync(dir, { recursive: true, force: true });
  });
  return fn(dir);
}

function modelsRequest(search = "") {
  return new Request(`http://localhost/api/models${search}`);
}

async function assertModelsOk(response) {
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(typeof body, "object");
  assert.ok(Array.isArray(body.modelList));
}

test("GET /api/models without cwd does not apply the file-access allowlist to the server cwd", async (t) => {
  await withUnlistedServerCwd(t, async () => {
    await assertModelsOk(await GET(modelsRequest()));
  });
});

test("GET /api/models?cwd=<unlisted dir> still rejects explicit cwd outside the allowlist", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "models-route-explicit-cwd-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const response = await GET(modelsRequest(`?cwd=${encodeURIComponent(dir)}`));
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error, "Access denied");
});

test("GET /api/models?cwd= (empty) behaves like no cwd", async (t) => {
  await withUnlistedServerCwd(t, async () => {
    await assertModelsOk(await GET(modelsRequest("?cwd=")));
  });
});
