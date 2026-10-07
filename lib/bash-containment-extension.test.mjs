import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// 集成层：真沙箱 + 真实会话。这里测的是**外部行为**，不测 operations 的函数签名。
//
// 覆盖两层 seam（票 02 建立的纪律）：
//   纯函数层（profile 生成 / 允许面判定 / env 过滤）在 lib/bash-containment.test.mjs；
//   本文件是集成层——工具面（同名覆盖定义）与 RPC 面（`{type:"bash"}`）走同一份判定、
//   人类无归属会话不被沙箱、fail-closed 平台不跑命令、越界的失败可读、冒烟清单够用。
//
// 平台：本机是 macOS（sandbox-exec 可用，实测）。Linux 的 bwrap 分支在纯函数层只断言形态，
// **未在本机验证**——本文件的用例在 bwrap 缺席时按 skip 记，不声称覆盖。

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { RpcCaller } = await jiti.import("./rpc/caller.ts");
const { createContainedBash } = await jiti.import("./bash-containment-extension.ts");
const { destroyRpcSessionsForCwd } = await jiti.import("./rpc/registry.ts");
const { pathGuardScopeFor } = await jiti.import("./tool-path-guard.ts");
const { detectBashSandbox } = await jiti.import("./bash-containment.ts");
const pi = await import("@earendil-works/pi-coding-agent");

const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-sandbox-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-sandbox-"));
const dataDir = path.join(root, ".worksplice");
const home = path.join(dataDir, "agents", "alice-a1b2c3d4");
const project = path.join(root, "shared-project");
// 「根外」夹具必须在**允许根与进程自己的 TMPDIR 之外**：fixture root 本身住在 TMPDIR 里，
// 而 TMPDIR 是清单的一部分（ADR-0012 决策二），所以根外的对照物另开在一个清单外的目录。
const outside = fs.mkdtempSync("/tmp/worksplice-sandbox-outside-");

const dbFile = path.join(dataDir, "worksplice.db");
const secretFile = path.join(outside, "secret.txt");
const SECRET = "outside-the-allowed-roots";
const FULL = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const sandbox = detectBashSandbox();
// 「沙箱真的激活」≠「矩阵说可用」：矩阵只回答「拿不拿得到机制」（票 05），
// 有效结论还要过第二个前提——机制能按端口过滤且推导得出端口（票 07 / ADR-0013 决策五）。
// Linux 装了 bwrap 时矩阵说可用，但 bwrap 封不了单个端口 ⇒ bash 不激活 ⇒ 真沙箱用例如实 skip，
// 而不是假装通过或莫名失败。用例的 skip 谓词一律用 `!contained`。
const contained = sandbox.available && sandbox.sandbox?.canFilterPort === true;

function write(file, content = "x") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

write(dbFile, "SQLite format 3");
write(secretFile, SECRET);
write(path.join(home, "MEMORY.md"), "# Alice");
write(path.join(project, "notes.md"), "notes\n");

function agentRow({ id = "a1b2c3d4-0000-4000-8000-000000000000", name = "Alice", workspace = project } = {}) {
  return {
    id,
    type: "agent",
    name,
    description: "",
    role: "member",
    workspace_path: workspace,
    pi_session_file: null,
    status: "offline",
    deleted: 0,
    model_provider: null,
    model_id: null,
    thinking_level: null,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

const scope = pathGuardScopeFor(agentRow(), dataDir);
const started = [];

/**
 * 两个真 loopback 服务（票 07 / ADR-0013 决策五第 ③ 环的夹具）：
 * - `appServer` 扮演 worksplice 自己的 HTTP 端口（被封的那个）；
 * - `otherServer` 是同机另一个 loopback 服务（**不得**被连坐）。
 *
 * 为什么要真服务器：验收判据是「内核拒绝，不是 HTTP 4xx/5xx」。一个只在断言里编造的端口
 * 测不出这一点，而真服务器的**命中计数**能给出无歧义的证据——请求根本没到达
 * （`hits` 不涨），而不是到达后被 HTTP 层拒了。
 */
async function startLoopbackServer(body) {
  const hits = { count: 0 };
  const server = http.createServer((_request, response) => {
    hits.count += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(body);
  });
  // listen 是异步的：地址要等 `listening` 事件，不能在回调外读 `server.address()`。
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { hits, server, port: server.address().port };
}

const appServer = await startLoopbackServer(JSON.stringify([{ id: "secretary-office", private: true }]));
const otherServer = await startLoopbackServer("other-loopback-service");

/**
 * 出网探测（AC「正例一：仍能出网」）。`example.com` 是 IANA 保留的文档用域名，HEAD 请求无副作用、
 * 不外传任何数据；先在**测试进程自己**（未沙箱）探一次，不通就 skip——离线/CI 环境里这条用例
 * 不该变成一个假红的门禁，而「出网被封」这件事本身由纯层的 `(allow network*)` 断言兼着。
 */
const EGRESS_PROBE_URL = "https://example.com";
const egressReachable = await new Promise((resolve) => {
  const request = https.request(EGRESS_PROBE_URL, { method: "HEAD", timeout: 5000 }, (response) => {
    response.resume();
    resolve((response.statusCode ?? 0) < 500);
  });
  request.on("timeout", () => { request.destroy(); resolve(false); });
  request.on("error", () => resolve(false));
  request.end();
});

test.after(async () => {
  for (const session of started) await session.shutdown().catch(() => {});
  await new Promise((resolve) => appServer.server.close(resolve));
  await new Promise((resolve) => otherServer.server.close(resolve));
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  // 会话持有 idle 定时器：显式销毁，否则测试进程被吊住。
  await destroyRpcSessionsForCwd(project).catch(() => {});
  await destroyRpcSessionsForCwd(dataDir).catch(() => {});
  fs.rmSync(agentDir, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

/**
 * 生产形态：成员会话（`pathGuard` 在场 = 会话归属的成员 ⇒ 沙箱跟着走）。
 *
 * 默认注入 `worksplicePorts: { ports: [appServer.port] }`：生产路径是从 `process.env.PORT`
 * **推导**（Next 在 listening 里写真实绑定端口），而测试进程里没有 app 在跑，所以显式告诉
 * 装配层「要封哪个端口」——封的仍然是真的那个 loopback 端口，沙箱里跑的是真的 curl。
 */
async function startContained(sessionId, containment = {}) {
  const { session } = await new RpcCaller().start(sessionId, "", project, {
    toolNames: FULL,
    pathGuard: scope,
    bashContainment: {
      worksplicePorts: { ports: [appServer.port] },
      ...containment,
    },
  });
  started.push(session);
  return session;
}

/** 无人归属的会话（人类自己的会话）：两个选项都不传。 */
async function startHuman(sessionId) {
  const { session } = await new RpcCaller().start(sessionId, "", project, { toolNames: FULL });
  started.push(session);
  return session;
}

function toolDefinition(session, name) {
  return session.inner.getToolDefinition(name);
}

function callTool(session, name, input, cwd = project) {
  // ctx 必须像真实运行那样带 sessionManager：pi 的 bash 定义会把当前的 PI_* 环境变量重新塞进子进程
  // （`resolveSpawnContext` 的 `exposeSessionEnvironment`），拿它当参数少一项就 TypeError。
  const ctx = {
    cwd,
    sessionManager: session.inner.sessionManager,
    model: session.inner.model,
    thinkingLevel: session.inner.thinkingLevel,
  };
  return toolDefinition(session, name).execute(`call-${name}`, input, undefined, undefined, ctx);
}

async function bash(session, command, cwd) {
  return callTool(session, "bash", { command }, cwd);
}

function textOf(result) {
  return (result.content ?? []).map((part) => part.text ?? "").join("\n");
}

// ---------------------------------------------------------------------------
// 注册期：边界写进工具描述（决策四「边界先于撞墙」），pi 原生描述不退化
// ---------------------------------------------------------------------------

test("bash 的覆盖定义由 pi 自己造：描述与准则不退化，边界与允许根在注册期就带着", async () => {
  const session = await startContained("sandbox-description");
  const definition = toolDefinition(session, "bash");
  const baseline = pi.createBashToolDefinition(project);

  assert.equal(definition.label, baseline.label, "label 退化");
  assert.equal(definition.description.startsWith(baseline.description), true, "pi 原生描述必须逐字保留");
  assert.deepEqual(definition.promptGuidelines, baseline.promptGuidelines, "pi 的 PI_* 准则不得丢");
  assert.equal(definition.promptSnippet, baseline.promptSnippet);
  assert.match(definition.description, /^.*Sandbox: /s, "边界要在描述里");
  assert.equal(definition.description.includes(home), true, "注册期就给出允许根");
  assert.equal(definition.description.includes(project), true);
  assert.match(definition.description, /allow-only/i);
});

test("档位构成不变：bash 仍在默认激活集里（覆盖定义不得改成 defaultActive: false）", async () => {
  const { session } = await new RpcCaller().start("sandbox-tier", "", project, { pathGuard: scope });
  started.push(session);
  const active = session.inner.getActiveToolNames();
  for (const name of ["read", "bash", "edit", "write"]) {
    assert.equal(active.includes(name), true, `${name} 必须在默认档位里（名义构成不改）`);
  }
  assert.equal(active.includes("grep"), false, "默认档位不含 grep");
});

// ---------------------------------------------------------------------------
// 工具面：真沙箱里越界被拒、合法路径零行为变化
// ---------------------------------------------------------------------------

test("冒烟清单：node / npm / git / bun 各跑一条只读命令（清单够用），gh 是已知代价", { skip: !contained }, async () => {
  const session = await startContained("sandbox-smoke");
  const commands = [
    ["node --version", /^v\d+/],
    ["npm --version", /^\d+\./],
    ["git --version", /^git version/],
    ["bun --version", /^\d+\./],
  ];
  for (const [command, pattern] of commands) {
    const result = await bash(session, command);
    assert.equal(result.isError, undefined, `${command} 不该失败：${textOf(result)}`);
    assert.match(textOf(result).trim(), pattern, `${command} 的输出不对劲`);
  }

  // 实测修正（票 05）：`gh` 整条命令都跑不起来 —— 它的 hosts.yml 就是 token 落点，
  // 而 ADR-0012 决策二明令凭证不进清单。代价比 ADR 预估的「不能 git push / gh pr create」
  // 更强，所以这里断言的是「**可归因的拒绝**」（不是 SIGABRT、不是静默放行），不是成功。
  const gh = await bash(session, "gh --version");
  assert.equal(gh.isError, true);
  const ghText = textOf(gh);
  assert.match(ghText, /operation not permitted/i, "gh 的失败必须是内核拒绝，而不是沙箱崩掉");
  assert.match(ghText, /\[worksplice sandbox: sandbox-exec\]/, "拒绝必须可归因到沙箱与允许根");
  assert.equal(textOf(ghText).includes("exit 134 (SIGABRT)"), false, "不得是漏规则的 SIGABRT 失败签名");
});

test("允许根内合法路径零行为变化：读写、TMPDIR、相对路径照常", { skip: !contained }, async () => {
  const session = await startContained("sandbox-legal");
  const notes = await bash(session, "cat notes.md");
  assert.equal(textOf(notes).trim(), "notes");

  const wrote = await bash(session, "echo written > fresh.txt && cat fresh.txt");
  assert.equal(textOf(wrote).trim(), "written");
  assert.equal(fs.readFileSync(path.join(project, "fresh.txt"), "utf-8").trim(), "written");

  const homeWrite = await bash(session, "echo memory > note.md && cat note.md", home);
  assert.equal(textOf(homeWrite).trim(), "memory");

  const tmp = await bash(session, "node -e 'require(\"fs\").writeFileSync(require(\"os\").tmpdir()+\"/probe.txt\",\"z\");console.log(\"tmp ok\")'");
  assert.equal(textOf(tmp).trim(), "tmp ok");

  // 进程自己的 TMPDIR 在清单里（node 要能写它），但共享 TMPDIR 之外的东西不在。
  assert.match(textOf(tmp), /tmp ok/);

  // 已知残留（ADR-0012 后果表 #3）：TMPDIR 是同一用户共享的 —— 名单内的目录不等于私有目录。
  const tmpSibling = path.join(os.tmpdir(), "worksplice-sandbox-shared-probe.txt");
  fs.writeFileSync(tmpSibling, "shared-tmp");
  try {
    const readShared = await bash(session, `cat ${tmpSibling}`);
    assert.equal(textOf(readShared).trim(), "shared-tmp", "TMPDIR 在清单内 ⇒ 同用户的其他临时文件可读（已记账的残留）");
  } finally {
    fs.rmSync(tmpSibling, { force: true });
  }
});

test("越界读/写被内核拒，且失败被归因成带允许根的可读错误", { skip: !contained }, async () => {
  const session = await startContained("sandbox-denied");

  const read = await bash(session, `cat ${secretFile}`);
  assert.equal(read.isError, true);
  const readText = textOf(read);
  assert.match(readText, /Operation not permitted/);
  assert.equal(readText.includes(SECRET), false, "越界内容不得出现在输出里");
  assert.match(readText, /\[worksplice sandbox: sandbox-exec\]/, "失败要归因到沙箱，而不是裸 EPERM");
  assert.equal(readText.includes(home), true, "归因文本要列允许根");
  assert.equal(readText.includes(project), true);

  const writeOutside = await bash(session, `touch ${path.join(outside, "evil.txt")}`);
  assert.equal(writeOutside.isError, true);
  assert.match(textOf(writeOutside), /Operation not permitted/);
  assert.equal(fs.existsSync(path.join(outside, "evil.txt")), false);

  const db = await bash(session, `head -c 16 ${dbFile}`);
  assert.equal(db.isError, true);
  assert.match(textOf(db), /Operation not permitted/);
});

test("命令文本判据的三条逃逸在沙箱里全部失效", { skip: !contained }, async () => {
  const session = await startContained("sandbox-escapes");

  // ① `sh <工作区内脚本>`：命令文本里没有越界路径，载荷在文件里。
  write(path.join(project, "payload.sh"), `cat ${secretFile}\n`);
  const script = await bash(session, "sh payload.sh");
  assert.equal(script.isError, true);
  assert.equal(textOf(script).includes(SECRET), false);
  assert.match(textOf(script), /Operation not permitted/);

  // ② `node -e`：路径是数据，不是命令文本的一部分。
  const nodeData = await bash(
    session,
    `node -e 'try{console.log(require("fs").readFileSync(${JSON.stringify(secretFile)},"utf8"))}catch(e){console.log("DENIED",e.code)}'`,
  );
  assert.equal(textOf(nodeData).includes(SECRET), false);
  assert.match(textOf(nodeData), /DENIED EPERM/);

  // ③ `$VAR` 间接：字面量路径不存在于文本里。
  const indirect = await bash(session, `export P=${outside}; bash -c 'cat "$P/secret.txt"'`);
  assert.equal(indirect.isError, true);
  assert.equal(textOf(indirect).includes(SECRET), false);
  assert.match(textOf(indirect), /Operation not permitted/);
});

// ---------------------------------------------------------------------------
// RPC 面：与工具面走同一份判定（决策三）
// ---------------------------------------------------------------------------

test("RPC 面（人类 !bash 走的那条路）同样进沙箱，与工具面同一份判定", { skip: !contained }, async () => {
  const session = await startContained("sandbox-rpc");

  const legal = await session.send({ type: "bash", command: "echo via-rpc" });
  assert.equal(String(legal.output).includes("via-rpc"), true, "RPC 面合法命令照常");

  const denied = await session.send({ type: "bash", command: `cat ${secretFile}` });
  assert.equal(String(denied.output).includes(SECRET), false, "RPC 面同样越界不可达");
  assert.match(String(denied.output), /Operation not permitted/);
  assert.match(String(denied.output), /\[worksplice sandbox: sandbox-exec\]/);
});

test("无人归属的会话（人类自己的会话）不沙箱：同一份判定认的是会话归属", { skip: !contained }, async () => {
  const session = await startHuman("sandbox-human");

  const read = await session.send({ type: "bash", command: `cat ${secretFile}` });
  assert.equal(String(read.output).trim(), SECRET, "人类会话照旧可达根外（不沙箱）");

  const definition = toolDefinition(session, "bash");
  assert.equal(definition.description.includes("Sandbox: "), false, "人类会话不注册沙箱描述");
  assert.equal(definition.description, pi.createBashToolDefinition(project).description);
});

// ---------------------------------------------------------------------------
// env 收口（ADR-0013 决策三）
// ---------------------------------------------------------------------------

test("成员 shell 里 WORKSPLICE_* 全部剥除、五个 PI_* 全部保留", { skip: !contained }, async () => {
  const injected = {
    WORKSPLICE_PASSWORD: "hunter2",
    WORKSPLICE_DATA_DIR: dataDir,
    PI_SESSION_ID: "sess-fixture",
    PI_SESSION_FILE: "/tmp/sess-fixture.jsonl",
    PI_PROVIDER: "fixture-provider",
    PI_MODEL: "fixture-model",
    PI_REASONING_LEVEL: "high",
  };
  const saved = Object.fromEntries(Object.keys(injected).map((key) => [key, process.env[key]]));
  Object.assign(process.env, injected);
  try {
    const session = await startContained("sandbox-env");

    // RPC 面没有 env 传递（`executeBashWithOperations` 只传 onData/signal），
    // 所以这里的底必须是包装自己构造的 —— 这一条正是「总是显式构造 env」的断言。
    const rpc = await session.send({ type: "bash", command: "env" });
    const envText = String(rpc.output);
    assert.equal(/^WORKSPLICE_/m.test(envText), false, "WORKSPLICE_* 必须全部剥掉");
    assert.equal(envText.includes("hunter2"), false, "真秘密不得出现");
    for (const key of ["PI_SESSION_ID", "PI_SESSION_FILE", "PI_PROVIDER", "PI_MODEL", "PI_REASONING_LEVEL"]) {
      assert.match(envText, new RegExp(`^${key}=`, "m"), `${key} 必须保留（pi 故意暴露）`);
    }

    // 工具面同样剥：pi 传下来的 env 里带着 WORKSPLICE_*，包装必须再剥一次。
    const toolResult = await bash(session, "env");
    assert.equal(/^WORKSPLICE_/m.test(textOf(toolResult)), false);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

// ---------------------------------------------------------------------------
// fail-closed（决策五）：拿不到沙箱就不激活 bash，且档位展示能解释
// ---------------------------------------------------------------------------

test("拿不到沙箱的平台：bash 拒绝执行（不裸跑），原因说得出、工具面与 RPC 面一致", async () => {
  const session = await startContained("sandbox-fail-closed", {
    platform: "win32",
    fileExists: () => false,
  });

  assert.equal(toolDefinition(session, "bash") !== undefined, true, "工具名义上仍在档位里（不改档位构成）");
  assert.equal(session.inner.getActiveToolNames().includes("bash"), true);
  const description = toolDefinition(session, "bash").description;
  assert.match(description, /not activated/i, "档位展示要能解释「本平台无沙箱 ⇒ 实际不含 bash」");
  assert.match(description, /win32|Windows/i);
  assert.equal(description.includes(home), true, "即便不可用也要说清边界");

  const refused = await bash(session, "echo should-not-run").then(
    () => assert.fail("fail-closed 平台不得执行任何命令"),
    (error) => error,
  );
  assert.match(refused.message, /bash is not activated/);

  await assert.rejects(
    () => session.send({ type: "bash", command: "echo should-not-run" }),
    /bash is not activated/,
    "RPC 面同样 fail-closed",
  );

  const state = await session.send({ type: "get_state" });
  assert.deepEqual(state.bashContainment, {
    available: false,
    mechanism: null,
    reason: "no OS-level sandbox on win32",
  });
});

test("get_state 暴露沙箱状态：成员会话给机制、无人归属会话给 null", { skip: !contained }, async () => {
  const member = await startContained("sandbox-state-member");
  const memberState = await member.send({ type: "get_state" });
  assert.deepEqual(memberState.bashContainment, {
    available: true,
    mechanism: sandbox.sandbox.kind,
    reason: null,
  });

  const human = await startHuman("sandbox-state-human");
  const humanState = await human.send({ type: "get_state" });
  assert.equal(humanState.bashContainment, null);
});

// ---------------------------------------------------------------------------
// 成员 → 本端口关闭（票 07 / ADR-0013 决策五第 ③ 环）：内核按端口过滤
// ---------------------------------------------------------------------------

test("负例：成员 shell 连不上 worksplice 自己的端口——内核拒绝，不是 HTTP 层报错", { skip: !contained }, async () => {
  const session = await startContained("sandbox-port-denied");
  const before = appServer.hits.count;

  // 判据按票据要求：不看 curl 的退出码当主证据（管道/写失败会污染它），看①输出里有没有 HTTP 状态码
  // 与②请求有没有真的到达服务器。不加 `-s`：静默模式会把内核/连接层那句可读错误也吞掉。
  const result = await bash(
    session,
    `curl -o /dev/null -m 5 -w '%{http_code}' http://127.0.0.1:${appServer.port}/api/channels`,
  );
  const text = textOf(result);
  assert.equal(appServer.hits.count, before, "请求根本没到达 app：不是 HTTP 4xx/5xx，是连不上");
  assert.equal(/^\s*200\s*$/m.test(text), false, `不得拿到 HTTP 200：${text}`);
  assert.equal(/(^|\D)200(\D|$)/.test(text), false, `输出里不得出现任何 HTTP 状态码：${text}`);
  assert.match(text, /curl: \(\d+\) (Failed to connect|Couldn't connect|Connection refused|Operation not permitted)/i);
  assert.match(text, /Command exited with code 7/, "curl 的 7 = 连不上主机（次要证据，主证据是命中计数）");

  // 同一个端口从**工具面**与 **RPC 面**都进不去（两个面共用同一份 operations，决策三）。
  const rpc = await session
    .send({ type: "bash", command: `curl -m 5 http://127.0.0.1:${appServer.port}/api/channels` })
    .then((value) => value, (error) => error);
  assert.equal(appServer.hits.count, before, "RPC 面同样进不去（同一份判定）");
  const rpcText = typeof rpc === "string" ? rpc : JSON.stringify(rpc);
  assert.equal(rpcText.includes("secretary-office"), false, "频道 JSON 不得泄露到成员 shell");
});

test("正例一：只封这一个端口——同机其它 loopback 服务照常可达", { skip: !contained }, async () => {
  const session = await startContained("sandbox-port-scoped");
  const before = otherServer.hits.count;

  const result = await bash(session, `curl -s -m 5 http://127.0.0.1:${otherServer.port}/ping`);
  assert.equal(otherServer.hits.count, before + 1, "同机其它 loopback 端口不得被连坐封掉");
  assert.equal(textOf(result).includes("other-loopback-service"), true, `输出不对：${textOf(result)}`);
});

test("正例一b：出网照常——成员要能装依赖、拉依赖、访问外部服务", { skip: !contained || !egressReachable }, async () => {
  const session = await startContained("sandbox-egress");
  const result = await bash(
    session,
    `curl -s -o /dev/null -m 15 -w 'egress_http=%{http_code}' -I ${EGRESS_PROBE_URL}`,
  );
  assert.match(textOf(result), /egress_http=200/, `出网不得被封：${textOf(result)}`);
});

test("生产默认分支：端口是从 process.env.PORT 推导进 profile 的，不靠任何注入", () => {
  // 集成层其余用例都显式注入 `worksplicePorts`，所以这里专门钉住**生产那一支**：
  // 不传 deps 时端口必须来自服务进程自己的 env（Next 在 listening 里写真实绑定端口）。
  const saved = process.env.PORT;
  try {
    delete process.env.PORT;
    const undetermined = createContainedBash(scope);
    assert.equal(undetermined.resolution.available, false, "env 里没有端口 ⇒ fail-closed，不激活 bash");
    assert.match(undetermined.resolution.reason, /PORT/);
    assert.equal(
      undetermined.plan.profile.includes("(deny network*)"),
      true,
      "拿不到端口时 profile 封死网络面（而不是放开）",
    );

    process.env.PORT = "4041";
    const determined = createContainedBash(scope);
    assert.equal(determined.resolution.available, contained, "有端口时与平台前提合取（Linux bwrap 仍不激活）");
    if (contained) {
      assert.equal(
        determined.plan.profile.includes('(deny network* (remote ip "*:4041"))'),
        true,
        "PORT 的值就是被封的端口（推导，不是硬编码常量）",
      );
      assert.match(determined.boundary, /4041/, "边界文本注册期就说出这个端口");
    }
  } finally {
    if (saved === undefined) delete process.env.PORT;
    else process.env.PORT = saved;
  }
});

test("正例二：人类会话（无人归属 ⇒ 不沙箱）访问同一个端口不受影响", async () => {
  const session = await startHuman("sandbox-port-human");
  const before = appServer.hits.count;

  const result = await bash(session, `curl -s -m 5 http://127.0.0.1:${appServer.port}/api/channels`);
  assert.equal(appServer.hits.count, before + 1, "人类的浏览器/curl 照常通（决策三：只封成员的会话）");
  assert.equal(textOf(result).includes("secretary-office"), true, "人类侧读得到自己的 app");
});

test("fail-closed：推导不出本进程端口时不激活 bash（不退回「不封端口的沙箱」）", async () => {
  const session = await startContained("sandbox-port-undetermined", {
    worksplicePorts: { ports: [], reason: "PORT is not set (test stand-in for an undeterminable port)" },
  });

  const description = toolDefinition(session, "bash").description;
  assert.match(description, /not activated/i, "推导不出端口 ⇒ bash 不激活，档位展示要能解释");
  assert.match(description, /PORT is not set/);

  await assert.rejects(
    () => bash(session, `curl -m 5 http://127.0.0.1:${appServer.port}/api/channels`),
    /bash is not activated/,
    "不得落成「不封端口的沙箱」——那等于洞开着",
  );

  const state = await session.send({ type: "get_state" });
  assert.equal(state.bashContainment.available, false);
  assert.match(state.bashContainment.reason, /PORT is not set/);
});

test("边界文本在注册期就说出被封的端口（边界先于撞墙）", { skip: !contained }, async () => {
  const session = await startContained("sandbox-port-boundary");
  const description = toolDefinition(session, "bash").description;
  assert.match(description, new RegExp(String(appServer.port)), "封掉的端口要写进工具描述");
  assert.match(description, /unreachable/i);
});

// ---------------------------------------------------------------------------
// 进程监督语义不漂移（自建 spawn 对 pi 契约的遵守）
// ---------------------------------------------------------------------------

test("timeout 契约：超时报 pi 同款错误文本，并把进程树杀掉", { skip: !contained }, async () => {
  const session = await startContained("sandbox-timeout");
  await assert.rejects(
    () => callTool(session, "bash", { command: "sleep 30", timeout: 0.3 }),
    /Command timed out after 0\.3 seconds/,
  );
  assert.equal(session.inner.isBashRunning, false, "超时后不得停在 running 状态");
});

test("abort 契约：中止后进程被真的杀掉（不挂满整段 sleep），会话回到空闲", { skip: !contained }, async () => {
  const session = await startContained("sandbox-abort");
  const startedAt = Date.now();
  const execution = session.send({ type: "bash", command: "sleep 30" });
  await new Promise((resolve) => setTimeout(resolve, 200));
  await session.send({ type: "abort_bash" });
  // pi 的 `executeBashWithOperations` 在中止时**不**抛错，而是回 `{cancelled: true}`。
  const result = await execution;
  assert.equal(result.cancelled, true);
  const elapsed = Date.now() - startedAt;
  assert.equal(elapsed < 5_000, true, `中止必须杀掉整棵进程树（实际 ${elapsed}ms）`);
  assert.equal(session.inner.isBashRunning, false);
});

test("exit 134（SIGABRT）被归因：不是裸码，也不冒充普通失败", { skip: !contained }, async () => {
  const session = await startContained("sandbox-abrt");
  // 真的让子进程自己 abort（沙箱漏规则时的失败签名同款：无 stderr、exit 134）。
  const result = await bash(session, "kill -ABRT $$");
  assert.equal(result.isError, true);
  const text = textOf(result);
  assert.match(text, /134/);
  assert.match(text, /\[worksplice sandbox: sandbox-exec\]/);
  assert.match(text, /exit 134 \(SIGABRT\)/);
  assert.equal(text.includes(home), true);

  // 普通失败不冒充沙箱。
  const ordinary = await bash(session, "exit 3");
  assert.equal(ordinary.isError, true);
  assert.equal(/\[worksplice sandbox:/.test(textOf(ordinary)), false);
});

// ---------------------------------------------------------------------------
// 凭证面：不在清单里（决策二的代价，响亮且可断言）
// ---------------------------------------------------------------------------

test("用户级凭证面不可达：~/.ssh 与 ~/.config/gh 都在清单外", { skip: !contained }, async () => {
  const session = await startContained("sandbox-credentials");
  const userHome = os.homedir();
  const probe = await bash(
    session,
    `ls ${path.join(userHome, ".ssh")} ${path.join(userHome, ".config", "gh")} 2>&1 | head -2`,
  );
  const text = textOf(probe);
  assert.match(text, /Operation not permitted/);
  assert.equal(leavesNoCredentialEntries(text), true);
});

/** 凭证面的探针只允许出现「被拒」，不允许出现任何条目名。 */
function leavesNoCredentialEntries(text) {
  return !/id_rsa|id_ed25519|known_hosts|config\.yml|hosts\.yml/.test(text);
}
