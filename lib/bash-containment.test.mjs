import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// 纯函数层（零 SDK 依赖）：沙箱的允许面生成、平台适配、env 收口、越界失败的可读化。
//
// 这里不碰真进程——profile 文本与 bind 清单是数据，可以穷举；真沙箱的行为在
// lib/bash-containment-extension.test.mjs 的集成层。
//
// 三条被这层钉住的纪律（ADR-0012 决策一/二/四）：
//   allow-only（清单外一律不可达，逐条断言「不该出现的路径不出现」）、
//   同一份允许根（改允许根 → profile 跟着变）、
//   越界归因可读（EPERM 与 exit 134 都指向沙箱与允许根，不是裸码）。

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const {
  resolveBashSandbox,
  resolveWorksplicePorts,
  sandboxLaunch,
  planBashSandbox,
  stripWorkspliceEnv,
  explainBashFailure,
  bashBoundaryText,
  bashUnavailableMessage,
  gateBashSandbox,
} = await jiti.import("./bash-containment.ts");

// ---------------------------------------------------------------------------
// 夹具：与路径守卫同一份判定域（复用 pathGuardScopeFor 的产物形状）
// ---------------------------------------------------------------------------

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-sandbox-"));
const dataDir = path.join(root, ".worksplice");
const homeDir = path.join(dataDir, "agents", "alice-a1b2c3d4");
const otherHome = path.join(dataDir, "agents", "bob-b2c3d4e5");
const project = path.join(root, "shared-project");
const userHome = path.join(root, "user");
const tmpdir = path.join(root, "tmp");

for (const dir of [homeDir, otherHome, project, userHome, tmpdir]) {
  fs.mkdirSync(dir, { recursive: true });
}
fs.mkdirSync(path.join(userHome, ".ssh"), { recursive: true });
fs.mkdirSync(path.join(userHome, ".config", "gh"), { recursive: true });
fs.writeFileSync(path.join(userHome, ".gitconfig"), "[user]\n\tname = alice\n");

const scope = {
  allowedRoots: [homeDir, project],
  dataDir,
  homeDir,
  memberName: "Alice",
};

const darwin = resolveBashSandbox({
  platform: "darwin",
  fileExists: (candidate) => candidate === "/usr/bin/sandbox-exec",
});
const linux = resolveBashSandbox({
  platform: "linux",
  fileExists: (candidate) => candidate === "/usr/bin/bwrap",
});
const plan = planBashSandbox(scope, { platform: "darwin", tmpdir, userHome });

// 读面 = 从宽读规则起到显式 deny 之前（deny 行里会出现数据目录，不该混进「在册条目」）。
const readSection = (profile) =>
  profile.slice(profile.indexOf('(allow file-read* (literal "/")'), profile.indexOf("(deny file-read*"));

test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 成员 → 本端口关闭（ADR-0013 决策五第 ③ 环：内核按端口过滤）
// ---------------------------------------------------------------------------

test("封的端口来自服务进程实际监听的那个（Next 在 listening 里写进 PORT），不是硬编码常量", () => {
  // 人类可以用 -p / PORT 起在任意端口：端口会变，所以封的端口必须跟着实例走。
  // 实测教训：某成员速查里记的 base URL 是 30141，实际监听 30142——硬编码就会封在空端口上。
  assert.deepEqual(resolveWorksplicePorts({ PORT: "30142" }).ports, [30142]);
  assert.deepEqual(resolveWorksplicePorts({ PORT: "4041" }).ports, [4041]);
  assert.deepEqual(resolveWorksplicePorts({ PORT: "8080" }).ports, [8080]);

  // 非端口值一律不认（推导不出 ⇒ ports 空，由 fail-closed 分支接手，绝不退化成「不封」）。
  for (const env of [{}, { PORT: "" }, { PORT: "  " }, { PORT: "abc" }, { PORT: "0" }, { PORT: "70000" }, { PORT: "-1" }, { PORT: "3000.5" }]) {
    const resolved = resolveWorksplicePorts(env);
    assert.deepEqual(resolved.ports, [], `PORT=${JSON.stringify(env.PORT)} 不得被当成端口`);
    assert.equal(typeof resolved.reason, "string", "推导不出必须给出可读原因（给 fail-closed 文本用）");
  }
});

test("profile 只封这一个端口：出网照常（allow network* 保留），同机其它 loopback 不动", () => {
  const withPort = planBashSandbox(scope, { platform: "darwin", tmpdir, userHome, blockedPorts: [30142] });
  const lines = withPort.profile.split("\n");
  const allowNetwork = lines.findIndex((line) => line === "(allow network*)");
  const denyPort = lines.findIndex((line) => line.startsWith("(deny network*"));
  assert.notEqual(allowNetwork, -1, "出网必须保留：成员要能 npm install、拉依赖、访问外部服务");
  assert.notEqual(denyPort, -1, "worksplice 自己的端口必须被封");
  assert.equal(allowNetwork < denyPort, true, "deny 必须跟在 allow 之后（更具体的规则胜出）");
  assert.equal(lines[denyPort], '(deny network* (remote ip "*:30142"))');

  // 端口是入参：换端口 → profile 跟着变（断言「不是硬编码常量」的可观察形式）。
  const other = planBashSandbox(scope, { platform: "darwin", tmpdir, userHome, blockedPorts: [4041] });
  assert.equal(other.profile.includes('(remote ip "*:4041")'), true);
  assert.equal(other.profile.includes('(remote ip "*:30142")'), false);
  assert.equal(other.profile.includes('(allow network*)'), true, "换了端口也不许把出网一起封掉");

  // 多个端口（本机同时跑着第二个实例等情形）收在同一条 deny 里，按数值升序（profile 文本因此是确定的）。
  const two = planBashSandbox(scope, { platform: "darwin", tmpdir, userHome, blockedPorts: [30142, 4041] });
  assert.equal(
    two.profile.includes('(deny network* (remote ip "*:4041") (remote ip "*:30142"))'),
    true,
    "两个端口必须在同一条 deny 里，且升序可复现",
  );
});

test("推导不出端口时 profile 整体封死网络面——不是静默放开", () => {
  // 空列表 ⇒ (deny network*) 而不是退回 (allow network*)：不封 = 洞开着。
  const blocked = planBashSandbox(scope, { platform: "darwin", tmpdir, userHome, blockedPorts: [] });
  assert.equal(blocked.profile.includes("(allow network*)"), false, "没有可封的端口时不得把网络面放开");
  assert.equal(blocked.profile.includes("(deny network*)"), true);
});

test("激活沙箱要两个前提同时成立：机制封得了端口 ∧ 推导得出本端口", () => {
  const ok = gateBashSandbox(darwin, { ports: [30142] });
  assert.equal(ok.available, true, "macOS + 推导得出端口 = 可用");
  assert.equal(ok.sandbox.kind, "sandbox-exec");

  // ① 推导不出端口 ⇒ fail-closed（不封 = 洞开着，绝不退回「不封端口的沙箱」）。
  const noPort = gateBashSandbox(darwin, resolveWorksplicePorts({}));
  assert.equal(noPort.available, false, "推导不出本端口就不激活 bash");
  assert.equal(noPort.sandbox, undefined, "不可用时不得留下机制（否则调用方可能仍拿它去 spawn）");
  assert.match(noPort.reason, /port/i);
  assert.match(bashUnavailableMessage(noPort), /not activated/i);

  // ② 机制封不了单个端口 ⇒ 同样 fail-closed（bwrap 只有 --share-net / --unshare-net 两档，
  // 而 --unshare-net 会连出网一起封死，成员就装不了依赖）。
  const bwrap = gateBashSandbox(linux, { ports: [30142] });
  assert.equal(bwrap.available, false, "bwrap 封不了单个端口 ⇒ 不激活（不静默放开）");
  assert.match(bwrap.reason, /port/i);
  assert.match(bwrap.reason, /bwrap/i);

  // ③ 平台没有沙箱：票 05 的姿态原样带过（两个前提只是追加，不改写既有原因）。
  const win = gateBashSandbox(resolveBashSandbox({ platform: "win32", fileExists: () => true }), { ports: [30142] });
  assert.equal(win.available, false);
  assert.match(win.reason, /win32/);
});

// ---------------------------------------------------------------------------
// 平台适配（ADR-0012 决策五：fail-closed）
// ---------------------------------------------------------------------------

test("拿得到沙箱的平台给机制与可执行文件；拿不到的一律 unavailable", () => {
  assert.deepEqual(darwin, {
    available: true,
    sandbox: { kind: "sandbox-exec", command: "/usr/bin/sandbox-exec", canFilterPort: true },
  });
  assert.equal(linux.available, true);
  assert.equal(linux.sandbox.kind, "bwrap");
  // 「能否按端口过滤」是矩阵的一维（票 07 / ADR-0013 决策五）：SBPL 能，bwrap 不能。
  assert.equal(linux.sandbox.canFilterPort, false, "bwrap 只有 --share-net / --unshare-net 两档，封不了单个端口");

  for (const platform of ["win32", "freebsd", "openbsd", "aix", "sunos", "android"]) {
    const resolution = resolveBashSandbox({ platform, fileExists: () => true });
    assert.equal(resolution.available, false, `${platform} 没有对应物，必须 fail-closed`);
    assert.equal(typeof resolution.reason, "string");
    assert.match(resolution.reason, /sandbox/i);
  }

  // macOS 上 sandbox-exec 缺失（被移除/被换平台）同样 fail-closed。
  const missing = resolveBashSandbox({ platform: "darwin", fileExists: () => false });
  assert.equal(missing.available, false);
  assert.match(missing.reason, /sandbox-exec/);

  // Linux 上没有 bwrap 也 fail-closed（未安装 ≠ 放行）。
  const noBwrap = resolveBashSandbox({ platform: "linux", fileExists: () => false });
  assert.equal(noBwrap.available, false);
  assert.match(noBwrap.reason, /bwrap/);
});

test("fail-closed 的拒绝文本是给人看的，并指明这是本平台的能力缺失", () => {
  const missing = resolveBashSandbox({ platform: "win32", fileExists: () => true });
  const message = bashUnavailableMessage(missing);
  assert.match(message, /not activated/i);
  assert.match(message, /sandbox/i);
  assert.equal(bashUnavailableMessage(darwin), "", "可用时不得有拒绝文本");
});

// ---------------------------------------------------------------------------
// allow-only profile：清单内可达、其余一律不可达
// ---------------------------------------------------------------------------

test("profile 是 allow-only：清单内逐条在册，清单外逐条不在册", () => {
  const profile = plan.profile;
  assert.match(profile, /^\(version 1\)/);
  assert.match(profile, /\(deny default\)/);

  for (const allowed of [homeDir, project, tmpdir]) {
    assert.equal(profile.includes(`(subpath "${allowed}")`), true, `${allowed} 必须在清单内`);
  }
  // 系统只读面与工具链缓存是清单的一部分（否则 git / node 起不来）。
  for (const systemPath of ["/usr", "/bin", "/System", "/Library", "/private/etc", "/dev"]) {
    assert.equal(profile.includes(`(subpath "${systemPath}")`), true, `${systemPath} 必须在清单内`);
  }
  assert.equal(profile.includes(`(subpath "${path.join(userHome, ".cache")}")`), true);
  assert.equal(profile.includes(`(subpath "${userHome}/.local")`), false, "~/.local 不收：Linux 密钥环落在它下面");
  // `~/.gitconfig` 是实测的长尾（`git --version` 都要读它），以单文件 literal 在册。
  assert.equal(profile.includes(`(literal "${path.join(userHome, ".gitconfig")}")`), true);

  // 用户级凭证面不在清单内（ADR-0012 决策二：拿用户私钥换 git push 权更坏）。
  for (const credential of [
    path.join(userHome, ".ssh"),
    path.join(userHome, ".config", "gh"),
    path.join(userHome, "Library", "Keychains"),
    path.join(userHome, ".aws"),
    path.join(userHome, ".netrc"),
    path.join(userHome, ".local"),
    otherHome,
  ]) {
    assert.equal(profile.includes(`(subpath "${credential}")`), false, `${credential} 不得进清单`);
  }
  assert.equal(profile.includes(`(literal "${path.join(userHome, ".ssh")}"`), false);
  // 用户家目录没有作为**读面**条目被开口（只有 `.gitconfig` 这一个 literal 在册）：
  // 它下方的工具链缓存是逐条列出的，且只读。
  assert.equal(readSection(profile).includes(`(subpath "${userHome}")`), false);
  // 唯一允许提到用户家目录的是 read-metadata（realpath 要逐级 stat 祖先，只暴露存在性、读不到内容）。
  const metadataLine = profile.split("\n").find((line) => line.startsWith("(allow file-read-metadata"));
  assert.equal(metadataLine.includes(`(subpath "${userHome}")`), true);
});

test("只读面不写、写面只到允许根与进程自己的 TMPDIR", () => {
  const profile = plan.profile;
  const read = readSection(profile);
  const write = profile.slice(profile.indexOf("(allow file-write*"));

  for (const readOnly of ["/usr", "/bin", "/System", "/Library", "/private/etc", "/usr/local"]) {
    assert.equal(read.includes(`(subpath "${readOnly}")`), true, `${readOnly} 应在读面`);
    assert.equal(write.includes(`(subpath "${readOnly}")`), false, `${readOnly} 不得进写面`);
  }
  for (const writable of [homeDir, project, tmpdir]) {
    assert.equal(write.includes(`(subpath "${writable}")`), true, `${writable} 应在写面`);
  }
  // 成员允许根之外的用户级目录：读面在册（工具链缓存）而写面不在册。
  assert.equal(write.includes(`(subpath "${path.join(userHome, ".npm")}")`), false);
  assert.equal(write.includes(`(subpath "${path.join(userHome, ".cache")}")`), false);
});

test("profile 由允许根派生：改允许根 → profile 跟着变（同一份判定，ADR-0007 决策 5）", () => {
  const another = planBashSandbox(
    { ...scope, allowedRoots: [homeDir], homeDir },
    { platform: "darwin", tmpdir, userHome },
  );
  assert.equal(another.profile.includes(`(subpath "${project}")`), false, "不再绑定的项目目录必须从清单消失");
  assert.equal(another.profile.includes(`(subpath "${homeDir}")`), true);

  const widened = planBashSandbox(
    { ...scope, allowedRoots: [homeDir, project, path.join(root, "second-project")] },
    { platform: "darwin", tmpdir, userHome },
  );
  assert.equal(widened.profile.includes(`(subpath "${path.join(root, "second-project")}")`), true);
});

test("数据目录显式不变式：allow 之后 deny，再把成员自己家目录单独开口", () => {
  // 反向形态：成员被绑定到**包含数据目录**的项目目录（人类可以这么绑）。
  const containing = planBashSandbox(
    { ...scope, allowedRoots: [homeDir, root], homeDir },
    { platform: "darwin", tmpdir, userHome },
  );
  const profile = containing.profile;
  const lineIndex = (predicate) => profile.split("\n").findIndex(predicate);
  const denyRead = lineIndex((line) => line.startsWith("(deny file-read*") && line.includes(dataDir));
  const denyWrite = lineIndex((line) => line.startsWith("(deny file-write*") && line.includes(dataDir));
  const reopenRead = lineIndex((line) => line.startsWith("(allow file-read* (subpath") && line.includes(homeDir));
  const reopenWrite = lineIndex((line) => line.startsWith("(allow file-write* (subpath") && line.includes(homeDir));
  assert.notEqual(denyRead, -1, "数据目录必须被显式 deny");
  assert.notEqual(denyWrite, -1);
  assert.notEqual(reopenRead, -1, "成员自己家目录是更窄的单独条目，要跟在 deny 之后重新开口");
  assert.notEqual(reopenWrite, -1);
  // SBPL 语义：更具体的规则胜出，同宽度时后写的胜出——所以顺序就是契约。
  assert.equal(denyRead < reopenRead, true, "deny 必须先于更窄的 reopen");
  assert.equal(denyWrite < reopenWrite, true);
  // 数据目录整片不得出现在任何 allow 行里（只有 deny 行与更窄的 reopen）。
  const allowedRead = readSection(profile);
  assert.equal(allowedRead.includes(`(subpath "${dataDir}")`), false, "数据目录本身不得作为 allow 条目");
});

test("路径按「用户写法 + realpath」两形在册：/tmp 与 /private/tmp 这类分叉不漏", () => {
  const realRoot = fs.realpathSync.native(root);
  if (realRoot === root) return; // 平台不产生分叉时该断言无意义（Linux 上 /tmp 不是符号链接）
  const profile = plan.profile;
  assert.equal(profile.includes(`(subpath "${path.join(root, "shared-project")}")`), true);
  assert.equal(
    profile.includes(`(subpath "${path.join(realRoot, "shared-project")}")`),
    true,
    "realpath 形态必须在册，否则 /var → /private/var 这层会拦住合法访问",
  );
});

// ---------------------------------------------------------------------------
// Linux（bwrap）：生成有实现，但**本机未验证**——这里只断言形态，不声称覆盖
// ---------------------------------------------------------------------------

test("bwrap 的清单是白名单式 bind：系统只读面 ro-bind、允许根 bind、数据目录 tmpfs 遮罩", () => {
  const linuxPlan = planBashSandbox(
    { ...scope, allowedRoots: [homeDir, root], homeDir },
    { platform: "linux", tmpdir, userHome },
  );
  const launch = sandboxLaunch(linux.sandbox, linuxPlan);
  assert.equal(launch.command, "/usr/bin/bwrap");
  const args = launch.args;
  assert.equal(args.includes("--die-with-parent"), true);
  assert.equal(args.includes("--unshare-all"), true);
  assert.equal(args.includes("--share-net"), true, "网络面按 ADR-0012 决策六不动（秘书的 curl 是锁定能力面）");
  const pairs = (flag) => args.flatMap((arg, index) => (arg === flag ? [args[index + 1]] : []));
  assert.equal(pairs("--ro-bind-try").includes("/usr"), true, "系统面只读 bind（-try：清单里的缺失路径被容忍，不让 bwrap 每条命令都启动失败）");
  assert.equal(pairs("--bind-try").includes(homeDir), true);
  assert.equal(pairs("--tmpfs").includes(dataDir), true, "含数据目录的根要用空 tmpfs 遮罩");
  // 遮罩之后再把成员自己的家目录 bind 回来——顺序即契约（最后一次出现必须晚于遮罩）。
  assert.equal(args.lastIndexOf(homeDir) > args.indexOf(dataDir), true);
  // 未验证：本机没有 bwrap（`which bwrap` 为空），没有在真沙箱里跑过它。
  assert.equal(typeof launch, "object");
});

// ---------------------------------------------------------------------------
// env 收口（ADR-0013 决策三）
// ---------------------------------------------------------------------------

test("WORKSPLICE_* 一刀切剥除，五个 PI_* 与用户自己的变量保留", () => {
  const stripped = stripWorkspliceEnv({
    PATH: "/usr/bin",
    HOME: "/Users/someone",
    WORKSPLICE_PASSWORD: "hunter2",
    WORKSPLICE_DATA_DIR: "/Users/someone/.worksplice",
    WORKSPLICE_HOSTNAME: "0.0.0.0",
    WORKSPLICE_ANYTHING_NEW: "x",
    PI_SESSION_ID: "sess-1",
    PI_SESSION_FILE: "/tmp/sess.jsonl",
    PI_PROVIDER: "anthropic",
    PI_MODEL: "claude",
    PI_REASONING_LEVEL: "high",
  });
  assert.deepEqual(Object.keys(stripped).sort(), [
    "HOME",
    "PATH",
    "PI_MODEL",
    "PI_PROVIDER",
    "PI_REASONING_LEVEL",
    "PI_SESSION_FILE",
    "PI_SESSION_ID",
  ]);
  assert.equal("WORKSPLICE_PASSWORD" in stripped, false, "真秘密必须剥掉");
  assert.equal(stripped.PI_SESSION_ID, "sess-1", "pi 故意暴露的项照原样保留");
});

test("env 收口不挑成员：没有归属信息的路径也在剥除范围内", () => {
  // 值里带 WORKSPLICE_ 字样不算（剥的是**键**的命名空间）；空对象不炸。
  const stripped = stripWorkspliceEnv({ NOTE: "WORKSPLICE_PASSWORD=hunter2" });
  assert.deepEqual(stripped, { NOTE: "WORKSPLICE_PASSWORD=hunter2" });
  assert.deepEqual(stripWorkspliceEnv({}), {});
  assert.deepEqual(stripWorkspliceEnv(undefined), {});
  // 大小写变体同属一个命名空间（Windows 环境变量大小写不敏感）。
  assert.deepEqual(stripWorkspliceEnv({ worksplice_password: "x" }), {});
});

// ---------------------------------------------------------------------------
// 越界失败的可读化（ADR-0012 决策四：机制替换，意图不变）
// ---------------------------------------------------------------------------

test("exit 134 与 EPERM 都归因到沙箱，并列出该成员的允许根", () => {
  const aborted = explainBashFailure({ exitCode: 134, output: "" }, scope, darwin.sandbox);
  assert.notEqual(aborted, null, "134 是沙箱漏规则的特征失败，必须归因");
  assert.match(aborted, /134/);
  assert.match(aborted, /sandbox/i);
  assert.equal(aborted.includes(homeDir), true, "归因文本要带允许根清单");
  assert.equal(aborted.includes(project), true);
  assert.equal(aborted.includes("Alice"), true, "清单署名成员名");

  const denied = explainBashFailure(
    { exitCode: 1, output: "cat: /Users/someone/.ssh/id_rsa: Operation not permitted" },
    scope,
    darwin.sandbox,
  );
  assert.notEqual(denied, null);
  assert.match(denied, /Operation not permitted/);
  assert.match(denied, /sandbox/i);
  assert.equal(denied.includes(homeDir), true);

  // node 的 EPERM 写法同样认得出。
  const nodeEperm = explainBashFailure(
    { exitCode: 1, output: "Error: EPERM: operation not permitted, open '/Users/someone/.azure/token'" },
    scope,
    darwin.sandbox,
  );
  assert.notEqual(nodeEperm, null);
  assert.match(nodeEperm, /EPERM/);
});

test("普通失败不冒充沙箱：归因只在真的越界时出现", () => {
  assert.equal(explainBashFailure({ exitCode: 0, output: "ok" }, scope, darwin.sandbox), null);
  assert.equal(
    explainBashFailure({ exitCode: 127, output: "bash: nope: command not found" }, scope, darwin.sandbox),
    null,
  );
  assert.equal(
    explainBashFailure({ exitCode: 2, output: "npm ERR! Missing script: \"build\"" }, scope, darwin.sandbox),
    null,
  );
});

// ---------------------------------------------------------------------------
// 边界先于撞墙：允许根写进注册期的工具描述（ADR-0012 决策四）
// ---------------------------------------------------------------------------

test("工具描述带该成员的允许根；不可用平台说明「不激活 bash」的原因", () => {
  const text = bashBoundaryText(scope, darwin, { ports: [30142] });
  assert.equal(text.includes(homeDir), true);
  assert.equal(text.includes(project), true);
  assert.equal(text.includes("Alice"), true);
  assert.match(text, /sandbox-exec/);
  assert.match(text, /allow-only/i);
  // 端口规则也要在注册期说清（决策四「边界先于撞墙」）：否则模型会拿 curl 一轮轮撞墙烧预算。
  assert.match(text, /30142/, "封掉的端口要写进边界文本");

  const unavailableText = bashBoundaryText(scope, resolveBashSandbox({ platform: "win32", fileExists: () => true }), { ports: [30142] });
  assert.match(unavailableText, /not activated/i);
  assert.match(unavailableText, /win32|Windows/i);
  assert.equal(unavailableText.includes(homeDir), true, "即便不可用也要说清边界在哪");
});
