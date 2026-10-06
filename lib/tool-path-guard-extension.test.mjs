import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// 集成层：守卫经 `resourceLoaderOptions.extensionFactories` 接缝同名覆盖六个文件工具后，
// 在**真实会话**里的外部行为。
//
// 只测外部行为——工具调用的结果与被拒时抛出的错误文本，不测 `operations` 的函数签名
// （那是 pi 的内部形状，会随版本漂移）。覆盖后的定义一律由 pi 自己造
// （`createReadToolDefinition(cwd, { operations })` 一类），描述/准则/diff 渲染因此逐字保留。

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { RpcCaller } = await jiti.import("./rpc/caller.ts");
const { destroyRpcSessionsForCwd } = await jiti.import("./rpc/registry.ts");
const { CODING_TOOL_NAMES } = await jiti.import("./tool-presets.ts");
const { allowedRootsFor, pathGuardScopeFor } = await jiti.import("./tool-path-guard.ts");
const {
  GUARDED_TOOL_NAMES,
  TOOL_PATH_GUARD_EXTENSION,
  registerGuardedTools,
  toolPathGuardExtension,
} = await jiti.import("./tool-path-guard-extension.ts");
const pi = await import("@earendil-works/pi-coding-agent");

const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-guard-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-guard-"));
const dataDir = path.join(root, ".worksplice");
const home = path.join(dataDir, "agents", "alice-a1b2c3d4");
const otherHome = path.join(dataDir, "agents", "bob-b2c3d4e5");
const project = path.join(root, "shared-project");

const dbFile = path.join(dataDir, "worksplice.db");
const attachment = path.join(dataDir, "attachments", "8f14e45f-ea0e-4b7c-9f2d-000000000000");
const insideFile = path.join(home, "MEMORY.md");
const projectFile = path.join(project, "src", "deep", "file.ts");
const pngFile = path.join(home, "shot.png");
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function write(file, content = "x") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

write(dbFile, "SQLite format 3");
write(attachment);
write(insideFile, "line one\nline two\nline three\n");
write(path.join(otherHome, "MEMORY.md"), "# Bob");
write(projectFile, "export {};\n");
write(pngFile, PNG_1PX);
write(path.join(project, "notes.md"), "relative notes\n");

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

const alice = agentRow();
const scope = pathGuardScopeFor(alice, dataDir);
const FULL = ["read", "bash", "edit", "write", "grep", "find", "ls"];

test.after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  // 会话持有 idle 定时器：显式销毁，否则测试进程被吊住。
  await destroyRpcSessionsForCwd(project).catch(() => {});
  await destroyRpcSessionsForCwd(dataDir).catch(() => {});
  fs.rmSync(agentDir, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

function startGuarded(sessionId, guardScope = scope, cwd = project) {
  return new RpcCaller().start(sessionId, "", cwd, { toolNames: FULL, pathGuard: guardScope });
}

function startUnguarded(sessionId, cwd = project) {
  return new RpcCaller().start(sessionId, "", cwd, { toolNames: FULL });
}

function toolDefinition(session, name) {
  return session.inner.getToolDefinition(name);
}

function callTool(session, name, input, cwd = project) {
  return toolDefinition(session, name).execute(`call-${name}`, input, undefined, undefined, { cwd });
}

// ---------------------------------------------------------------------------
// 覆盖面：工具集合从唯一事实来源派生
// ---------------------------------------------------------------------------

test("守卫覆盖的工具集合从 CODING_TOOL_NAMES 派生，bash 不在内", () => {
  assert.deepEqual([...GUARDED_TOOL_NAMES].sort(), ["edit", "find", "grep", "ls", "read", "write"]);
  for (const name of GUARDED_TOOL_NAMES) {
    assert.equal(CODING_TOOL_NAMES.includes(name), true, `${name} 必须来自唯一事实来源`);
  }
  assert.equal(CODING_TOOL_NAMES.includes("bash"), true);
  assert.equal(GUARDED_TOOL_NAMES.includes("bash"), false, "bash 的收口是另一张票的范围");
});

// ---------------------------------------------------------------------------
// 描述未退化：覆盖定义必须由 pi 自己造
// ---------------------------------------------------------------------------

test("覆盖定义由 pi 自己造：提示片段、编辑准则、diff 渲染逐字保留", () => {
  // 用记录型 pi 跑生产同一条注册路径（扩展工厂里调的就是它）。
  const recorded = new Map();
  registerGuardedTools(
    { registerTool: (definition) => recorded.set(definition.name, definition) },
    { cwd: project, scope },
  );
  const guarded = recorded;
  const baseline = {
    read: pi.createReadToolDefinition(project),
    write: pi.createWriteToolDefinition(project),
    edit: pi.createEditToolDefinition(project),
    grep: pi.createGrepToolDefinition(project),
    find: pi.createFindToolDefinition(project),
    ls: pi.createLsToolDefinition(project),
  };

  for (const name of GUARDED_TOOL_NAMES) {
    const definition = guarded.get(name);
    const base = baseline[name];
    assert.equal(definition.name, name);
    assert.equal(definition.label, base.label, `${name} label 退化`);
    assert.equal(definition.description, base.description, `${name} description 退化`);
    assert.equal(definition.promptSnippet, base.promptSnippet, `${name} promptSnippet 退化`);
    assert.deepEqual(definition.promptGuidelines, base.promptGuidelines, `${name} promptGuidelines 退化`);
    for (const renderer of ["renderCall", "renderResult"]) {
      if (typeof base[renderer] === "function") {
        assert.equal(typeof definition[renderer], "function", `${name}.${renderer} 丢失`);
      }
    }
  }
  // 手写定义会静默丢掉的那几条，逐条点名。
  assert.equal(guarded.get("read").promptSnippet, "Read file contents");
  assert.deepEqual(guarded.get("read").promptGuidelines, [
    "Use read to examine files instead of cat or sed.",
  ]);
  assert.equal(guarded.get("edit").promptGuidelines.length, 4);
  assert.deepEqual(guarded.get("write").promptGuidelines, [
    "Use write only for new files or complete rewrites.",
  ]);
});

test("扩展外壳：hidden 且用 builtin: 名登记", () => {
  const entry = toolPathGuardExtension({ cwd: project, scope });
  assert.equal(entry.name, TOOL_PATH_GUARD_EXTENSION);
  assert.match(entry.name, /^builtin:/);
  assert.equal(entry.hidden, true);
  assert.equal(typeof entry.factory, "function");
});

// ---------------------------------------------------------------------------
// 守卫在位：真实会话里六个工具都被同一份允许根约束
// ---------------------------------------------------------------------------

test("真实会话里六个文件工具都被拒绝在根外（含反向断言：数据目录设成根也拦得住）", async () => {
  const { session } = await startGuarded("guard-six-tools");
  try {
    const outside = [
      ["read", { path: dbFile }, dbFile],
      // write 的第一个 ops 调用是 mkdir(dirname(target))，所以被点名的绝对路径是父目录。
      ["write", { path: path.join(dataDir, "leak.md"), content: "x" }, dataDir],
      ["edit", { path: dbFile, edits: [{ oldText: "SQLite", newText: "leak" }] }, dbFile],
      ["grep", { pattern: "channels", path: dataDir }, dataDir],
      ["find", { pattern: "*.db", path: dataDir }, dataDir],
      ["ls", { path: path.join(dataDir, "agents") }, path.join(dataDir, "agents")],
    ];
    for (const [name, input, rejectedPath] of outside) {
      await assert.rejects(
        () => callTool(session, name, input),
        (error) => {
          assert.match(error.message, /path outside this agent's allowed roots: \//);
          assert.equal(error.message.includes(rejectedPath), true, `${name} 的报错要说出被拒的绝对路径`);
          assert.equal(error.message.includes(home), true, `${name} 的报错要列出允许根清单`);
          assert.equal(error.message.includes(project), true);
          return true;
        },
        `${name} 必须在根外拒绝`,
      );
    }
    // 只有命令执行的 bash 不在守卫覆盖内（另一张票），这里显式记下边界。
    assert.equal(GUARDED_TOOL_NAMES.includes("bash"), false);

    // 反向断言：把允许根设成数据目录本身，数据库仍被拒（显式不变式，不是「恰好不在列表里」）。
    const fake = pathGuardScopeFor(agentRow({ workspace: dataDir }), dataDir);
    assert.equal(fake.allowedRoots.includes(dataDir), true, "本用例刻意把数据目录放进允许根");
    const { session: leaked } = await startGuarded("guard-fake-member", fake, dataDir);
    await assert.rejects(
      () => callTool(leaked, "read", { path: dbFile }, dataDir),
      /path outside this agent's allowed roots/,
    );
    await assert.rejects(
      () => callTool(leaked, "ls", { path: dataDir }, dataDir),
      /path outside this agent's allowed roots/,
    );
    // 家目录恰在被排除的父目录下，作为更窄的单独条目显式开口。
    const ownMemory = await callTool(leaked, "read", { path: insideFile }, dataDir);
    assert.equal(ownMemory.content[0].text.includes("line one"), true);
    await leaked.shutdown();
  } finally {
    await session.shutdown();
  }
});

// ---------------------------------------------------------------------------
// 合法路径零行为变化
// ---------------------------------------------------------------------------

test("合法路径零行为变化：文本、相对路径、图片、写入、搜索、枚举与未守卫会话一致", async () => {
  const guarded = (await startGuarded("guard-legal")).session;
  const unguarded = (await startUnguarded("guard-baseline")).session;
  try {
    // 文本文件：同一份内容
    const guardedRead = await callTool(guarded, "read", { path: insideFile });
    const baselineRead = await callTool(unguarded, "read", { path: insideFile });
    assert.deepEqual(guardedRead, baselineRead);

    // 相对路径：pi 负责解析，守卫不吃亏
    const relativeRead = await callTool(guarded, "read", { path: "notes.md" }, project);
    assert.equal(relativeRead.content[0].text.includes("relative notes"), true);

    // 图片：detectImageMimeType 仍在（省略它就是行为退化）
    const guardedImage = await callTool(guarded, "read", { path: pngFile });
    const baselineImage = await callTool(unguarded, "read", { path: pngFile });
    assert.deepEqual(guardedImage, baselineImage, "图片读取结果不得因守卫而变");
    assert.match(guardedImage.content[0].text, /Read image file \[image\/png\]/);

    // write：根内新建深层文件照常
    const freshFile = path.join(project, "src", "brand", "new.md");
    await callTool(guarded, "write", { path: freshFile, content: "hello" });
    assert.equal(fs.readFileSync(freshFile, "utf-8"), "hello");

    // edit：根内精确替换照常，且 diff 渲染字段仍在
    const edited = await callTool(guarded, "edit", {
      path: insideFile,
      edits: [{ oldText: "line two", newText: "line TWO" }],
    });
    assert.equal(edited.details.diff.includes("line TWO"), true);
    assert.equal(fs.readFileSync(insideFile, "utf-8").includes("line TWO"), true);

    // grep：遍历途中读文件（context 行）也走守卫，根内照常
    const grepped = await callTool(guarded, "grep", {
      pattern: "relative",
      path: project,
      context: 1,
    });
    assert.equal(grepped.content[0].text.includes("notes.md"), true);

    // find / ls：根内枚举照常
    const found = await callTool(guarded, "find", { pattern: "*.md", path: project });
    const baselineFound = await callTool(unguarded, "find", { pattern: "*.md", path: project });
    assert.deepEqual(found, baselineFound, "find 的结果不得因守卫而变");
    assert.equal(found.content[0].text.includes("notes.md"), true);
    // 相对搜索根（`.省略 path` / 子目录）走的是同一份判定，结果也不变。
    const relativeFind = await callTool(guarded, "find", { pattern: "*.md" }, project);
    assert.equal(relativeFind.content[0].text.includes("notes.md"), true);
    const subdirFind = await callTool(guarded, "find", { pattern: "*.ts", path: "src" }, project);
    assert.equal(subdirFind.content[0].text.includes("file.ts"), true);
    const listed = await callTool(guarded, "ls", { path: home });
    assert.equal(listed.content[0].text.includes("MEMORY.md"), true);

    // 相对搜索根用 `..` 逃出允许根：定义级判定同样拦得住（fd 遍历不经过 ops）。
    await assert.rejects(
      () => callTool(guarded, "find", { pattern: "*.db", path: "../.worksplice" }, project),
      /path outside this agent's allowed roots/,
    );
    await assert.rejects(
      () => callTool(guarded, "grep", { pattern: "SQLite", path: "../.worksplice" }, project),
      /path outside this agent's allowed roots/,
    );
  } finally {
    await guarded.shutdown();
    await unguarded.shutdown();
  }
});

// ---------------------------------------------------------------------------
// reload 存活 + 档位边界
// ---------------------------------------------------------------------------

test("reload 之后守卫仍生效，且不放宽档位（扩展工具默认不自动激活）", async () => {
  const { session } = await new RpcCaller().start("guard-reload", "", project, {
    toolNames: ["read", "bash", "edit", "write"],
    pathGuard: scope,
  });
  try {
    const before = session.inner.getActiveToolNames();
    assert.equal(before.includes("grep"), false, "DEFAULT 档不含 grep");

    await session.send({ type: "reload" });

    const definition = toolDefinition(session, "read");
    assert.equal(definition.promptSnippet, "Read file contents", "reload 后描述仍在");
    assert.deepEqual(definition.promptGuidelines, ["Use read to examine files instead of cat or sed."]);
    await assert.rejects(
      () => callTool(session, "read", { path: dbFile }),
      /path outside this agent's allowed roots/,
      "reload 后守卫仍要拦数据库",
    );
    const ownRead = await callTool(session, "read", { path: insideFile });
    assert.equal(ownRead.content[0].text.includes("line one"), true, "reload 后根内照常");

    const after = session.inner.getActiveToolNames();
    for (const name of ["read", "bash", "edit", "write"]) {
      assert.equal(after.includes(name), true, `${name} 在 reload 后仍激活`);
    }
    for (const name of ["grep", "find", "ls"]) {
      assert.equal(after.includes(name), false, `重载不得把 ${name} 悄悄塞进 DEFAULT 档`);
    }
  } finally {
    await session.shutdown();
  }
});

// ---------------------------------------------------------------------------
// 未传 pathGuard 的会话不被守卫（人类会话仍用默认实现）
// ---------------------------------------------------------------------------

test("未传 pathGuard 的会话不装守卫：人类会话读数据目录不被拦", async () => {
  const { session } = await startUnguarded("guard-human-baseline", root);
  try {
    const result = await callTool(session, "read", { path: dbFile }, root);
    assert.equal(result.content[0].text.includes("SQLite format 3"), true);
  } finally {
    await session.shutdown();
  }
});

test("allowedRootsFor 与测试夹具一致：家目录 + 显式项目目录", () => {
  assert.deepEqual(allowedRootsFor(alice, dataDir), [home, project]);
});
