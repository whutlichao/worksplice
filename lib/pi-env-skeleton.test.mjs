import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// 初始化动作（`lib/pi-env-skeleton.ts`）：只补缺、不覆盖、可重复执行、只碰目标目录。
//
// 断言的全是磁盘上留下的副作用（哪些文件被建、哪些文件逐字节未变），不是内部实现：
// 唯一看的实现细节是「不得 spawn 任何进程」——那由「本模块没有任何 spawn 调用点」保证，
// 这里用 `package.json` 的 `bin` 零 diff 与「跑完目录里只有骨架」间接证明。
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { initializePiAgentDir, PI_AGENT_DIR_SKELETON, planPiAgentDirSkeleton } = await jiti.import(
  "./pi-env-skeleton.ts",
);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-pi-env-skeleton-"));
test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

let seq = 0;
function tmpDir() {
  const dir = path.join(root, `case-${seq++}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 目录树快照：相对路径 → 文件字节（目录记为 null）。用来断言「逐字节未变」。 */
function snapshot(dir) {
  const entries = new Map();
  const walk = (current, prefix) => {
    for (const name of fs.readdirSync(current).sort()) {
      const full = path.join(current, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        entries.set(`${relative}/`, null);
        walk(full, relative);
      } else {
        entries.set(relative, fs.readFileSync(full, "utf8"));
      }
    }
  };
  walk(dir, "");
  return entries;
}

const SKELETON_PATHS = ["auth.json", "models.json", "sessions/", "settings.json"];

test("空目录跑一次：骨架齐（settings.json / models.json / auth.json / sessions/）", () => {
  const root = tmpDir();
  const agentDir = path.join(root, "agent");
  const result = initializePiAgentDir(agentDir);

  assert.equal(result.agentDir, agentDir);
  assert.deepEqual([...result.created].sort(), SKELETON_PATHS);
  assert.deepEqual([...snapshot(agentDir).keys()].sort(), SKELETON_PATHS);
  assert.equal(fs.readFileSync(path.join(agentDir, "settings.json"), "utf8"), "{}\n");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(agentDir, "models.json"), "utf8")), {
    providers: {},
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(agentDir, "auth.json"), "utf8")), {});
});

test("骨架文件权限是 0600（auth.json 里会有凭证）", () => {
  const agentDir = path.join(tmpDir(), "agent");
  initializePiAgentDir(agentDir);
  for (const name of ["auth.json", "models.json", "settings.json"]) {
    const mode = fs.statSync(path.join(agentDir, name)).mode & 0o777;
    assert.equal(mode.toString(8), "600", `${name} 权限应为 0600`);
  }
});

test("预置内容的文件跑完逐字节相同（不覆盖是硬约束）", () => {
  const agentDir = path.join(tmpDir(), "agent");
  fs.mkdirSync(path.join(agentDir, "sessions"), { recursive: true });
  const preset = {
    settings: '{ "theme": "dark",   "defaultProvider": "deepseek" }\n',
    auth: '{"deepseek": {"type": "api_key", "apiKey": "sk-keep-me"}}',
    models: '{"providers": {"acme": {"api": "openai-completions"}}}',
    session: '{"type":"session"}\n',
  };
  fs.writeFileSync(path.join(agentDir, "settings.json"), preset.settings);
  fs.writeFileSync(path.join(agentDir, "auth.json"), preset.auth);
  fs.writeFileSync(path.join(agentDir, "models.json"), preset.models);
  fs.writeFileSync(path.join(agentDir, "sessions", "keep.jsonl"), preset.session);
  const before = snapshot(agentDir);

  const result = initializePiAgentDir(agentDir);

  assert.deepEqual(result.created, []);
  assert.deepEqual(snapshot(agentDir), before);
  assert.equal(fs.readFileSync(path.join(agentDir, "settings.json"), "utf8"), preset.settings);
  assert.equal(fs.readFileSync(path.join(agentDir, "auth.json"), "utf8"), preset.auth);
  assert.equal(fs.readFileSync(path.join(agentDir, "models.json"), "utf8"), preset.models);
  assert.equal(fs.readFileSync(path.join(agentDir, "sessions", "keep.jsonl"), "utf8"), preset.session);
});

test("幂等：连跑两次，第二次改动清单为空且目录逐字节不变", () => {
  const agentDir = path.join(tmpDir(), "agent");
  const first = initializePiAgentDir(agentDir);
  assert.equal(first.created.length, SKELETON_PATHS.length);
  const afterFirst = snapshot(agentDir);

  const second = initializePiAgentDir(agentDir);

  assert.deepEqual(second.created, []);
  assert.deepEqual(snapshot(agentDir), afterFirst);
});

test("只碰目标目录：旁边的目录与文件逐字节不变", () => {
  const parent = tmpDir();
  const agentDir = path.join(parent, "agent");
  const sibling = path.join(parent, "sibling");
  fs.mkdirSync(sibling, { recursive: true });
  fs.writeFileSync(path.join(sibling, "keep.txt"), "do not touch\n");
  const siblingBefore = snapshot(sibling);

  initializePiAgentDir(agentDir);

  assert.deepEqual(snapshot(sibling), siblingBefore);
  assert.deepEqual([...snapshot(parent).keys()].filter((key) => !key.startsWith("agent")), [
    "sibling/",
    "sibling/keep.txt",
  ]);
});

test("planPiAgentDirSkeleton：空目录报全部四条，补过之后报空", () => {
  const agentDir = path.join(tmpDir(), "agent");
  assert.deepEqual([...planPiAgentDirSkeleton(agentDir)].sort(), SKELETON_PATHS);
  initializePiAgentDir(agentDir);
  assert.deepEqual(planPiAgentDirSkeleton(agentDir), []);
});

test("骨架清单自描述：四条，且没有把 bin / PATH 之类的东西塞进来", () => {
  assert.deepEqual(
    PI_AGENT_DIR_SKELETON.map((entry) => [entry.path, entry.kind]),
    [
      ["settings.json", "file"],
      ["models.json", "file"],
      ["auth.json", "file"],
      ["sessions", "directory"],
    ],
  );
});

test("目标路径被一个文件占着 ⇒ 抛出可归因的错误（不静默成功）", () => {
  const parent = tmpDir();
  const agentDir = path.join(parent, "agent");
  fs.writeFileSync(agentDir, "not a directory\n");
  assert.throws(() => initializePiAgentDir(agentDir), (error) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /agent/);
    return true;
  });
});
