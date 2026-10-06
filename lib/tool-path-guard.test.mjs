import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// 纯函数层（零 SDK 依赖）：路径守卫的判定矩阵。
//
// 判定只回答「这条绝对路径对该成员是否合法」，不做任何文件 IO 的替代实现——
// 这里的每个用例都只断言放行/拒绝与拒绝文本，不碰 pi 的 operations 形状。
//
// 被守护的三个硬要求（ADR-0011 决策六）在这个文件里逐条可见：
//   realpath（最深存在祖先 + basename 回退）、path.relative 判定、fail-closed。

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { allowedRootsFor, pathGuardScopeFor, isWithinAllowedRoots, assertSearchRootWithinAllowedRoots, resolvePathForGuard } =
  await jiti.import("./tool-path-guard.ts");

// ---------------------------------------------------------------------------
// 夹具：一个数据目录 + 两个成员 + 一个共享项目目录
// ---------------------------------------------------------------------------

const root = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-path-guard-"));
const dataDir = path.join(root, ".worksplice");
const home = path.join(dataDir, "agents", "alice-a1b2c3d4");
const otherHome = path.join(dataDir, "agents", "bob-b2c3d4e5");
const homeSibling = path.join(dataDir, "agents", "alice-a1b2c3d4-extra");
const project = path.join(root, "shared-project");
const outside = path.join(root, "outside");

const dbFile = path.join(dataDir, "worksplice.db");
const attachment = path.join(dataDir, "attachments", "8f14e45f-ea0e-4b7c-9f2d-000000000000");

function write(file, content = "x") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

write(dbFile, "SQLite format 3");
write(attachment);
write(path.join(home, "MEMORY.md"), "# Alice");
write(path.join(home, "drafts", "note.md"), "draft");
write(path.join(otherHome, "MEMORY.md"), "# Bob");
write(path.join(homeSibling, "MEMORY.md"), "# not alice");
write(path.join(project, "src", "deep", "file.ts"), "export {}");
write(path.join(outside, "elsewhere.md"), "outside");

function agentRow({ id = "a1b2c3d4-0000-4000-8000-000000000000", name = "Alice", workspace = null } = {}) {
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
// 默认判定域：家目录 + 显式绑定的共享项目目录（ADR-0001 允许多成员绑定同一项目目录）。
const scope = pathGuardScopeFor(agentRow({ workspace: project }), dataDir);

test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const allowed = (target, guardScope = scope) => isWithinAllowedRoots(target, guardScope).allowed;
const denial = (target, guardScope = scope) => {
  const verdict = isWithinAllowedRoots(target, guardScope);
  assert.equal(verdict.allowed, false, `expected ${target} to be rejected`);
  return verdict.message;
};

// ---------------------------------------------------------------------------
// 根内
// ---------------------------------------------------------------------------

test("根内：家目录、家目录深层路径、项目目录深层路径都放行", () => {
  assert.equal(allowed(home), true, "家目录本身");
  assert.equal(allowed(path.join(home, "MEMORY.md")), true, "家目录下的文件");
  assert.equal(allowed(path.join(home, "drafts", "note.md")), true, "家目录下的深层路径");
  assert.equal(allowed(path.join(project, "src", "deep", "file.ts")), true, "项目目录下的深层路径");
});

test("根内：`~` 展开后的绝对路径照常放行（展开是 pi 的事，守卫只看结果）", () => {
  // pi 的 resolveReadPathAsync 先把 `~/x` 展开成绝对路径，ops 才拿到它；
  // 守卫要保证自己不把这类已是绝对路径的结果再判错。
  assert.equal(allowed(path.join(home, "notes.md")), true);
  assert.equal(allowed(path.join(home, "drafts", "note.md")), true);
});

// ---------------------------------------------------------------------------
// 根外
// ---------------------------------------------------------------------------

test("根外：数据库 / 附件目录 / 他人家目录 / 家目录兄弟目录 / 系统文件一律拒绝", () => {
  const cases = {
    "数据库": dbFile,
    "附件目录": attachment,
    "他人家目录": path.join(otherHome, "MEMORY.md"),
    "家目录的兄弟目录": path.join(homeSibling, "MEMORY.md"),
    "系统文件": "/etc/passwd",
    "数据目录本身": dataDir,
    "数据目录下的普通文件": path.join(dataDir, "notes.md"),
  };
  for (const [label, target] of Object.entries(cases)) {
    assert.equal(allowed(target), false, `${label} should be rejected: ${target}`);
  }
});

test("拒绝文本含被拒的绝对路径与该成员当前的允许根清单", () => {
  const message = denial(dbFile);
  assert.match(message, /^path outside this agent's allowed roots: /);
  assert.equal(message.includes(dbFile), true, "报错要说出被拒的是哪条绝对路径");
  assert.equal(message.includes(home), true, "报错要列出家目录这条允许根");
  assert.equal(message.includes(project), true, "报错要列出项目目录这条允许根");
  assert.equal(message.includes(dataDir + "\n") || message.split("\n")[0].includes("worksplice.db"), true);
  const lines = message.split("\n");
  assert.equal(lines[1], "allowed roots for Alice:");
  assert.deepEqual(lines.slice(2), [`  - ${home}`, `  - ${project}`]);
});

test("未署名成员时仍给出允许根清单", () => {
  const anonymous = pathGuardScopeFor(agentRow({ name: "" }), dataDir);
  const verdict = isWithinAllowedRoots(dbFile, anonymous);
  assert.equal(verdict.allowed, false);
  assert.match(verdict.message, /allowed roots:/);
});

// ---------------------------------------------------------------------------
// 前缀陷阱
// ---------------------------------------------------------------------------

test("前缀陷阱：根 /a/b 不得让 /a/bc 通过（用 path.relative 判，不用 startsWith）", () => {
  const projectSibling = path.join(root, "shared-project-extra");
  write(path.join(projectSibling, "file.md"));
  assert.equal(allowed(path.join(projectSibling, "file.md")), false, "project-extra 不是 project 的下属");
  // 家目录的兄弟同款陷阱（`alice-a1b2c3d4` vs `alice-a1b2c3d4-extra`）
  assert.equal(allowed(homeSibling), false);
  assert.equal(allowed(path.join(home, "..", path.basename(homeSibling), "MEMORY.md")), false);
});

// ---------------------------------------------------------------------------
// 符号链接
// ---------------------------------------------------------------------------

test("符号链接：根内指向根外拒绝；指向根内放行", () => {
  const escape = path.join(home, "escape.md");
  fs.symlinkSync("/etc/passwd", escape);
  assert.equal(allowed(escape), false, "根内 symlink 指向根外必须拒绝");

  const intoDataDir = path.join(home, "db-link");
  fs.symlinkSync(dbFile, intoDataDir);
  assert.equal(allowed(intoDataDir), false, "根内 symlink 指向数据库必须拒绝");

  const insideLink = path.join(home, "note-link.md");
  fs.symlinkSync(path.join(home, "drafts", "note.md"), insideLink);
  assert.equal(allowed(insideLink), true, "根内 symlink 指向根内放行");

  const projectLink = path.join(project, "home-link");
  fs.symlinkSync(home, projectLink);
  assert.equal(allowed(path.join(projectLink, "MEMORY.md")), true, "经 symlink 落在另一条允许根内也算放行");
});

// ---------------------------------------------------------------------------
// 不存在的目标路径
// ---------------------------------------------------------------------------

test("不存在的深层目标：父目录 realpath + basename 回退", () => {
  assert.equal(allowed(path.join(project, "new", "deep", "file.txt")), true, "write 新建文件的常见形态");
  assert.equal(allowed(path.join(home, "drafts", "another", "new.md")), true);
  assert.equal(allowed(path.join(outside, "new", "deep", "file.txt")), false, "根外的不存在路径照样拒绝");
  assert.equal(allowed(path.join(dataDir, "new.txt")), false, "数据目录下的新文件照样拒绝");
});

test("不存在的目标：父目录是根内指向根外的符号链接时拒绝", () => {
  const escapeDir = path.join(project, "escape-dir");
  fs.symlinkSync(outside, escapeDir);
  assert.equal(allowed(path.join(escapeDir, "new", "file.txt")), false);
});

// ---------------------------------------------------------------------------
// 根列表异常（fail-closed）
// ---------------------------------------------------------------------------

test("根列表异常 fail-closed：空根列表一律拒绝", () => {
  const empty = pathGuardScopeFor(alice, dataDir);
  const noRoots = { ...empty, allowedRoots: [] };
  assert.equal(allowed(home, noRoots), false, "空根列表下连家目录也不放行");
  assert.equal(allowed(dbFile, noRoots), false);
  assert.equal(allowed("/etc/passwd", noRoots), false);
});

test("判定自身出错一律拒绝：非绝对路径输入 / 根列表全是坏条目", () => {
  assert.equal(allowed("MEMORY.md"), false, "相对路径无法判定，fail-closed");
  assert.equal(allowed("~/MEMORY.md"), false, "未展开的 `~` 无法判定，fail-closed");
  assert.equal(allowed("@MEMORY.md"), false, "未裁剪的 `@` 无法判定，fail-closed");
  assert.equal(allowed(""), false);
  const broken = { ...scope, allowedRoots: ["", "relative/root"] };
  assert.equal(allowed(home, broken), false, "根列表无法解析时拒绝");
  assert.equal(allowed(path.join(project, "src", "deep", "file.ts"), broken), false);
});

test("判定自身出错一律拒绝：homeDir 缺失时数据目录树整体封闭", () => {
  const bound = pathGuardScopeFor(agentRow({ workspace: project }), dataDir);
  const anonymousHome = { ...bound, homeDir: "" };
  assert.equal(allowed(path.join(home, "MEMORY.md"), anonymousHome), false, "没有家目录开口，数据目录树全封闭");
  assert.equal(allowed(path.join(project, "src", "deep", "file.ts"), anonymousHome), true, "项目目录仍照常");

  // 数据目录形态不对 = 无法证明「数据库永不可达」，同样 fail-closed（不是跳过不变式）。
  const unknownDataDir = { ...bound, dataDir: "" };
  assert.equal(allowed(path.join(project, "src", "deep", "file.ts"), unknownDataDir), false);
  assert.equal(allowed(path.join(home, "MEMORY.md"), unknownDataDir), false);
});

// ---------------------------------------------------------------------------
// 注入形态
// ---------------------------------------------------------------------------

test("注入形态：@ 前缀裁剪结果与 macOS 变体文件名都不会被守卫吃掉", () => {
  // pi 的 resolveToCwd 会裁掉开头的 `@`（`@foo.md` → `foo.md`），守卫拿到的是裁剪后的结果。
  const atStripped = path.join(home, "notes.md");
  assert.equal(allowed(atStripped), true);

  // macOS 截图名的 NFD / 花引号变体：pi 只在原路径不存在时才回退到变体，
  // 守卫必须放行它回退出来的那条路径，而不是拿原路径的判据去否掉变体。
  const nfc = path.join(home, "café.md");
  write(nfc);
  const nfd = path.join(home, "cafe\u0301.md");
  const curly = path.join(home, "Capture d’écran.md");
  write(curly);
  assert.equal(fs.realpathSync.native(nfc), fs.realpathSync.native(nfd));
  assert.equal(allowed(nfd), true, "NFD 变体放行");
  assert.equal(allowed(nfc), true, "NFC 形态同样放行");
  assert.equal(allowed(curly), true, "花引号文件名放行");
});

// ---------------------------------------------------------------------------
// 搜索根判定（find / grep 的定义级判定）：原始字符串 → 解析 → 同一条规则
// ---------------------------------------------------------------------------

/** find / grep 的搜索根判定：不抛则返回 undefined。 */
function searchRoot(raw, cwd = project, guardScope = scope) {
  try {
    assertSearchRootWithinAllowedRoots(raw, cwd, guardScope);
    return undefined;
  } catch (error) {
    return error.message;
  }
}

test("搜索根判定：相对路径按会话 cwd 解析，`~` 与 `file://` 与 pi 同源展开", () => {
  assert.equal(resolvePathForGuard("src", project), path.join(project, "src"));
  assert.equal(resolvePathForGuard("@src", project), path.join(project, "src"));
  assert.equal(resolvePathForGuard("~", project), os.homedir());
  assert.equal(resolvePathForGuard("~/x", project), path.join(os.homedir(), "x"));
  assert.equal(resolvePathForGuard(`file://${project}/src`, project), path.join(project, "src"));
});

test("搜索根判定：根内放行（含缺省 `.` 与相对子目录），根外拒绝且报错含允许根清单", () => {
  assert.equal(searchRoot(undefined), undefined, "缺省搜索根 = cwd，在根内");
  assert.equal(searchRoot("."), undefined);
  assert.equal(searchRoot("src"), undefined);
  assert.equal(searchRoot(home), undefined);
  assert.equal(searchRoot(project), undefined);

  for (const raw of [dbFile, dataDir, path.join(otherHome), "..", path.join(project, ".."), "~/elsewhere"]) {
    const message = searchRoot(raw);
    assert.equal(typeof message, "string", `${raw} 应被拒绝`);
    assert.match(message, /^path outside this agent's allowed roots: /);
    assert.equal(message.includes(home), true, "报错要列出允许根清单");
    assert.equal(message.includes(project), true);
  }
});

test("搜索根判定：`@` 前缀裁剪后是绝对路径时照样拦（`@/etc/passwd` 不能变成 cwd 下的相对名）", () => {
  assert.equal(searchRoot("@src"), undefined, "`@` 裁剪后仍是 cwd 下的相对路径");
  const message = searchRoot("@/etc/passwd");
  assert.equal(typeof message, "string");
  assert.equal(message.includes("/etc/passwd"), true);
});

test("搜索根判定：归一步骤顺序与 pi 一致——`@~` 先裁 `@` 再展开成家目录（否则会漏）", () => {
  // pi 的 normalizePath 先 stripAtPrefix 再 expandTilde；顺序反了的话 `@~` 会被当成 cwd 下的
  // 相对名 `~` 而放行，pi 却会展开成用户家目录并让 fd 遍历整个家目录。
  assert.equal(resolvePathForGuard("@~", project), os.homedir());
  assert.equal(resolvePathForGuard("@~/x", project), path.join(os.homedir(), "x"));
  assert.equal(typeof searchRoot("@~"), "string", "用户家目录不在允许根内，应当拒绝");
  assert.equal(typeof searchRoot("@~/x"), "string");
});

test("搜索根判定 fail-closed：畸形 file:// 与空根列表一律拒绝", () => {
  assert.equal(typeof searchRoot("file://"), "string", "file:// 解析失败 → 拒绝");
  assert.equal(typeof searchRoot(project, project, { ...scope, allowedRoots: [] }), "string");
});

// ---------------------------------------------------------------------------
// 根的构成
// ---------------------------------------------------------------------------

test("allowedRootsFor：家目录 + 显式绑定的项目目录；派生绑定的家目录不重复", () => {
  assert.deepEqual(allowedRootsFor(alice, dataDir), [home]);
  assert.deepEqual(allowedRootsFor(agentRow({ workspace: project }), dataDir), [home, project]);
  // 数据层读取侧把「家目录形态」的存量值重推成当前数据目录下的家目录：去重后仍只有一条。
  assert.deepEqual(allowedRootsFor(agentRow({ workspace: home }), dataDir), [home]);
  assert.deepEqual(allowedRootsFor(agentRow({ workspace: otherHome }), dataDir), [home, otherHome]);
});

// ---------------------------------------------------------------------------
// 显式不变式（ADR-0011 决策二）
// ---------------------------------------------------------------------------

test("显式不变式：把允许根设成数据目录本身，worksplice.db 仍不可达", () => {
  // 这条不是「恰好不在列表里」的巧合：本用例刻意让数据目录成为一条允许根，
  // 判定仍必须拒绝落在其树下的数据库、附件与他人家目录。
  const fake = pathGuardScopeFor(agentRow({ workspace: dataDir }), dataDir);
  assert.equal(fake.allowedRoots.includes(dataDir), true, "本用例刻意把数据目录放进允许根");

  for (const target of [dbFile, attachment, path.join(otherHome, "MEMORY.md"), dataDir]) {
    assert.equal(allowed(target, fake), false, `${target} 必须仍被拒绝`);
  }
  // 家目录恰在被排除的父目录下，作为更窄的单独条目显式开口。
  assert.equal(allowed(path.join(home, "MEMORY.md"), fake), true);
  // 把数据目录与其他根并列也翻不了案（未来调用方绕过组合函数时同样拦得住）。
  const sideBySide = { ...fake, allowedRoots: [home, dataDir, project] };
  assert.equal(allowed(dbFile, sideBySide), false, "并列条目里数据目录仍无效");
  assert.equal(allowed(attachment, sideBySide), false);
  assert.equal(allowed(path.join(project, "src", "deep", "file.ts"), sideBySide), true);
});

test("显式不变式：项目目录是数据目录的父目录时，数据目录树仍不可达", () => {
  // 允许根 /Users/x 之下住着 /Users/x/.worksplice —— 根本身不落在数据目录内，
  // 靠「根不在数据目录内」的过滤拦不住，只有判定层的不变式能拦住。
  const parentRoot = pathGuardScopeFor(agentRow({ workspace: root }), dataDir);
  assert.equal(parentRoot.allowedRoots.includes(root), true);
  assert.equal(allowed(path.join(outside, "elsewhere.md"), parentRoot), true, "根内的普通目录照常");
  assert.equal(allowed(dbFile, parentRoot), false, "数据目录树下仍拒绝");
  assert.equal(allowed(attachment, parentRoot), false);
  assert.equal(allowed(path.join(home, "MEMORY.md"), parentRoot), true);
});
