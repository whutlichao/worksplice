import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

// 两个薄封装入口（issue #226）：`GET /api/pi-env/status` 与 `POST /api/pi-env/init`。
//
// 断言入口的外部契约：返回什么 payload、失败映射成什么状态码与可读错误。
// 判定与写盘逻辑在 `lib/pi-env-status.ts` / `lib/pi-env-skeleton.ts`，这里不重复测。
//
// agent 目录一律指向临时目录（`getAgentDir()` 每次调用都读 PI_CODING_AGENT_DIR），
// 绝不碰本机 `~/.pi/agent`。
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-pi-env-route-"));
process.env.PI_CODING_AGENT_DIR = path.join(root, "unset");

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const statusRoute = await jiti.import("./status/route.ts");
const initRoute = await jiti.import("./init/route.ts");

after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  fs.rmSync(root, { recursive: true, force: true });
});

let seq = 0;
/** 每个用例一个 agent 目录，并把它设为路由看到的配置根。 */
function useAgentDir(prepare = () => undefined) {
  const agentDir = path.join(root, `agent-${seq++}`);
  fs.mkdirSync(agentDir, { recursive: true });
  prepare(agentDir);
  process.env.PI_CODING_AGENT_DIR = agentDir;
  return agentDir;
}

function withEnvKey(key, value, run) {
  const saved = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  return run().finally(() => {
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  });
}

function initRequest(body) {
  return new Request("http://localhost:30142/api/pi-env/init", {
    method: "POST",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body }),
  });
}

// ── GET /api/pi-env/status ───────────────────────────────────────────────────

test("status：空目录 ⇒ P1 未初始化，且这次查询没有往目录里写东西", async () => {
  const agentDir = useAgentDir();
  const response = await statusRoute.GET();
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload, {
    agentDir,
    finding: "uninitialized",
    reason: "settings-unwritten",
  });
  assert.deepEqual(fs.readdirSync(agentDir), []);
});

test("status：初始化过骨架、没有任何凭证 ⇒ P2 无可用凭证", async () => {
  const agentDir = useAgentDir((dir) => {
    fs.writeFileSync(path.join(dir, "settings.json"), "{}\n");
  });
  await withEnvKey("DEEPSEEK_API_KEY", undefined, async () => {
    const response = await statusRoute.GET();
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.agentDir, agentDir);
    assert.deepEqual(
      { finding: payload.finding, reason: payload.reason },
      { finding: "no-credentials", reason: "no-credentials" },
    );
  });
});

test("status：配置读出默认模型且环境变量里有 key ⇒ 无结论（存量用户零感知）", async () => {
  useAgentDir((dir) => {
    fs.writeFileSync(
      path.join(dir, "settings.json"),
      JSON.stringify({ defaultProvider: "deepseek", defaultModel: "deepseek-chat" }),
    );
  });
  await withEnvKey("DEEPSEEK_API_KEY", "sk-test-not-a-real-key", async () => {
    const response = await statusRoute.GET();
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual({ finding: payload.finding, reason: payload.reason }, {
      finding: null,
      reason: null,
    });
  });
});

// ── POST /api/pi-env/init ────────────────────────────────────────────────────

test("init：空目录 ⇒ 200 与改动清单，骨架落盘；再跑一次改动清单为空（幂等）", async () => {
  const agentDir = useAgentDir();

  const first = await initRoute.POST(initRequest());
  assert.equal(first.status, 200);
  const firstPayload = await first.json();
  assert.deepEqual(firstPayload, {
    agentDir,
    created: ["settings.json", "models.json", "auth.json", "sessions/"],
  });
  assert.deepEqual(fs.readdirSync(agentDir).sort(), [
    "auth.json",
    "models.json",
    "sessions",
    "settings.json",
  ]);

  const second = await initRoute.POST(initRequest());
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { agentDir, created: [] });
});

test("init：预置内容的文件不被改动", async () => {
  const preset = '{ "theme": "dark" }\n';
  const agentDir = useAgentDir((dir) => {
    fs.writeFileSync(path.join(dir, "settings.json"), preset);
  });
  const response = await initRoute.POST(initRequest());
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.created, ["models.json", "auth.json", "sessions/"]);
  assert.equal(fs.readFileSync(path.join(agentDir, "settings.json"), "utf8"), preset);
});

test("init：请求体想指定目标目录 ⇒ 400 可读错误，且那个目录不会被创建", async () => {
  useAgentDir();
  const evil = path.join(root, "evil-target");
  const response = await initRoute.POST(
    initRequest(JSON.stringify({ agentDir: evil })),
  );
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /agent dir/i);
  assert.equal(fs.existsSync(evil), false);
});

test("init：请求体不是合法 JSON ⇒ 400 可读错误（不是 500 空体）", async () => {
  useAgentDir();
  const response = await initRoute.POST(initRequest("{ not json"));
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(typeof payload.error, "string");
  assert.ok(payload.error.length > 0);
});

test("init：目标目录不可写 ⇒ 403 与可读错误（不是 500 空体）", async () => {
  const agentDir = useAgentDir();
  fs.chmodSync(agentDir, 0o555);
  try {
    const response = await initRoute.POST(initRequest());
    assert.equal(response.status, 403);
    const payload = await response.json();
    assert.match(payload.error, /cannot initialise/i);
    assert.match(payload.error, new RegExp(agentDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    fs.chmodSync(agentDir, 0o755);
  }
});

test("init：目标路径被文件占着 ⇒ 409 与可读错误", async () => {
  const agentFile = path.join(root, "agent-is-a-file");
  fs.writeFileSync(agentFile, "not a directory\n");
  process.env.PI_CODING_AGENT_DIR = agentFile;
  const response = await initRoute.POST(initRequest());
  assert.equal(response.status, 409);
  const payload = await response.json();
  assert.match(payload.error, /cannot initialise/i);
});
