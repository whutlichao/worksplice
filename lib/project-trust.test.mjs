import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createAgentSessionServices,
  DefaultResourceLoader,
} from "@earendil-works/pi-coding-agent";
import {
  getProjectTrustStatus,
  projectTrustReloadOptions,
  trustProject,
} from "./project-trust.ts";

// `lib/model-listing.ts` 用无扩展名相对 import（`./project-trust`），node 的 TS
// strip 模式解析不了；走 jiti，与 `lib/model-listing.test.mjs` 同一个加载口。
async function loadModelListingSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./model-listing.ts");
  } catch {
    return import("./model-listing.ts");
  }
}

const { loadModelListingServices } = await loadModelListingSubject();

async function createProjectFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "worksplice-project-trust-"));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  await mkdir(cwd, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, cwd, agentDir };
}

test("clean projects stay on the normal trusted load path", async (t) => {
  const { cwd, agentDir } = await createProjectFixture(t);

  assert.deepEqual(getProjectTrustStatus(cwd, agentDir), {
    requiresTrust: false,
    trusted: true,
  });
  assert.equal(projectTrustReloadOptions(cwd, agentDir), undefined);
});

test("project extensions execute only after the project is trusted", async (t) => {
  const { root, cwd, agentDir } = await createProjectFixture(t);
  const extensionDir = join(cwd, ".pi", "extensions");
  const marker = join(root, "extension-executed");
  await mkdir(extensionDir, { recursive: true });
  await writeFile(
    join(extensionDir, "probe.js"),
    `import { writeFileSync } from "node:fs";\nexport default () => { writeFileSync(${JSON.stringify(marker)}, "executed"); };\n`,
  );

  assert.deepEqual(getProjectTrustStatus(cwd, agentDir), {
    requiresTrust: true,
    trusted: false,
  });

  const restrictedLoader = new DefaultResourceLoader({ cwd, agentDir });
  await restrictedLoader.reload(projectTrustReloadOptions(cwd, agentDir));
  assert.equal(existsSync(marker), false);
  assert.equal(restrictedLoader.getExtensions().extensions.length, 0);

  assert.deepEqual(trustProject(cwd, agentDir), {
    requiresTrust: true,
    trusted: true,
  });

  const trustedLoader = new DefaultResourceLoader({ cwd, agentDir });
  await trustedLoader.reload(projectTrustReloadOptions(cwd, agentDir));
  assert.equal(existsSync(marker), true);
  assert.equal(trustedLoader.getExtensions().extensions.length, 1);
});

test("the reload resolver reads the latest persisted trust decision", async (t) => {
  const { cwd, agentDir } = await createProjectFixture(t);
  await mkdir(join(cwd, ".pi", "extensions"), { recursive: true });

  const reloadOptions = projectTrustReloadOptions(cwd, agentDir);
  assert.ok(reloadOptions);
  assert.equal(await reloadOptions.resolveProjectTrust(), false);

  trustProject(cwd, agentDir);
  assert.equal(await reloadOptions.resolveProjectTrust(), true);
});

// ---------------------------------------------------------------------------
// 已知缺口（engineering-standards.md:38「只测外部行为，不测实现细节」）
//
// 这里原本挂着两个「读源码 + 正则匹配」的用例
// （`all project resource loaders and reloads enforce project trust` 与
// `the trust API invalidates cached models and restricted runtimes`，
// 合计 17 条源码文本断言）。它们断言的是「某个文件里出现了某段文字」，
// 而不是「从外部调用会得到什么结果」——重构改个变量名就红，却拦不住任何
// 真实的行为回归。两个用例已删除；下面逐条列出被删掉的**接线断言**
// 以及它们各自的当前覆盖状态。
//
// 仍然有人守（由同形态的源码断言继续守护，grep 证据见各条）：
//   - caller.ts 的 `const sessionCwd = sessionManager.getCwd()`
//         → lib/rpc/caller.test.mjs:86
//   - caller.ts 的 `projectTrustReloadOptions(sessionCwd, agentDir)`
//         → lib/rpc/caller.test.mjs:87
//   - project-trust route 的 `destroyRpcSessionsForCwd(result.cwd)`
//         → lib/rpc/session.test.mjs:243
//
// 当前无人守护（诚实记账；grep 全仓确认这些断言只出现在本文件）：
//   - caller.ts 把 trustReloadOptions 传成 `resourceLoaderReloadOptions`
//   - session.ts 两处 reload 前各自调用 `syncProjectTrust()`（旧断言还数了
//     出现次数恰为 2）
//   - skills-service.ts 的 `loader.reload(projectTrustReloadOptions(...))`
//   - plugins route 的 `projectTrusted: projectTrust.trusted`
//     （旧断言另有一条要求它出现恰好 2 次）
//   - plugins route 的 `scope === "project" && !projectTrust.trusted`
//   - skills/install route 的 `getProjectTrustStatus(...).trusted`
//   - project-trust route 的 `trustProject(result.cwd, agentDir)`
//   - project-trust route 的 `invalidateModelsCache()`
//         （lib/models-cache.test.mjs 只测该函数自身行为，不测 route 是否调用）
//   - project-trust route 的 `hasBusyRpcSessionForCwd(result.cwd)`
//
// 特例（接线无人守，但原语行为有人守 / 本就冗余）：
//   - caller.ts 的 `trackStarting(sessionCwd)`：trackStarting 原语本身有行为
//     覆盖（lib/cwd-mutex.test.mjs:159 与 lib/rpc/registry.test.mjs:62
//     同名用例「trackStarting is reference counted across concurrent starts」），
//     但**「caller.ts 接上了它」这一层无人守**。
//   - cwd-mutex.ts 的 `realpathSync(resolved)`：本就冗余，删除无损——归一语义
//     已由 lib/cwd-mutex.test.mjs:44 与 :46 的符号链接用例行为化覆盖。
//
// model-listing.ts 的那 2 条（`projectTrustReloadOptions(cwd, agentDir)` 与
// `resourceLoaderReloadOptions: trustReloadOptions`）**没有变成缺口**：已改写为
// 紧接其下的行为用例，直接观测探针是否被执行。
// ---------------------------------------------------------------------------

test("the full model-listing load keeps an untrusted project's extensions dormant", async (t) => {
  const { root, cwd, agentDir } = await createProjectFixture(t);
  const marker = join(root, "model-listing-extension-executed");
  // 顶层副作用探针：extension 模块被 import 就落标记，不依赖 handler 何时触发。
  await mkdir(join(cwd, ".pi", "extensions"), { recursive: true });
  await writeFile(
    join(cwd, ".pi", "extensions", "probe.js"),
    `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "executed");\nexport default () => {};\n`,
  );

  const services = await loadModelListingServices(cwd, agentDir);
  assert.equal(services.strategy, "full");
  assert.equal(
    existsSync(marker),
    false,
    "an untrusted project extension must not execute on the full model-listing path (#236)",
  );

  // 负向对照：同一 cwd、同一探针，只去掉 trust 门控，标记必须出现。
  // 少了这一段，上面的断言就无法区分「门控生效」与「恒真」。
  await createAgentSessionServices({ cwd, agentDir });
  assert.equal(
    existsSync(marker),
    true,
    "control: without the trust gate the same project probe does execute",
  );
});