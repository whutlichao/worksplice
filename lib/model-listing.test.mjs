import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./model-listing.ts");
  } catch {
    return import("./model-listing.ts");
  }
}

const { resolveModelListingStrategy, loadModelListingServices } = await loadSubject();

const NO_PROVIDERS = { providers: {} };

/** `models` 是配置面的唯一旋钮：默认空配置，对照用例写入自己的 provider。 */
function makeAgentDir(models = NO_PROVIDERS) {
  const agentDir = mkdtempSync(join(tmpdir(), "model-listing-agent-"));
  writeFileSync(join(agentDir, "settings.json"), "{}");
  writeFileSync(join(agentDir, "models.json"), JSON.stringify(models));
  writeFileSync(join(agentDir, "auth.json"), "{}");
  return agentDir;
}

/**
 * 进程环境里的 provider 凭证（如 `DEEPSEEK_API_KEY`）是这套用例唯一拿不到的入参，
 * 也是 issue #228 的红因：`ModelRuntime` 除 auth.json / models.json 之外还会从
 * `process.env` 发现凭证（`defaultProviderAuthContext()` 每次调用现读 env），
 * 而没有任何开关能关掉这一面——`ModelRuntime.create` 不收 `authContext`，
 * `getAvailable(providerId?, options?)` 的 `AuthOperationOptions` 只有 `signal`，
 * 注入空 `CredentialStore` 也挡不住（探针实测仍返回 `deepseek/*`）。
 *
 * 所以断言「配置面为空 ⇒ 零模型」时，环境面必须由测试自己固定：窗口内把
 * `process.env` 置空，`finally` 原样放回。`node --test` 每个测试文件独占子进程，
 * 窗口里只有 SDK 的本地可用性枚举（无网络、无 spawn、不碰 `~/.pi/agent`）。
 */
async function withoutAmbientCredentials(fn) {
  const saved = process.env;
  process.env = {};
  try {
    return await fn();
  } finally {
    process.env = saved;
  }
}

test("plain cwd without project resources takes the lite path", () => {
  const cwd = mkdtempSync(join(tmpdir(), "model-listing-plain-"));
  const agentDir = makeAgentDir();
  assert.equal(resolveModelListingStrategy(cwd, agentDir), "lite");
});

test("untrusted cwd with project settings falls back to full (trust gate, #236)", () => {
  const cwd = mkdtempSync(join(tmpdir(), "model-listing-untrusted-"));
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "settings.json"), "{}");
  const agentDir = makeAgentDir();
  assert.equal(resolveModelListingStrategy(cwd, agentDir), "full");
});

test("trusted cwd with project settings stays on the lite path", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "model-listing-trusted-"));
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "settings.json"), "{}");
  const agentDir = makeAgentDir();
  const { ProjectTrustStore } = await import("@earendil-works/pi-coding-agent");
  new ProjectTrustStore(agentDir).set(cwd, true);
  assert.equal(resolveModelListingStrategy(cwd, agentDir), "lite");
});

test("lite path returns a working runtime without loading extensions", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "model-listing-lite-"));
  const agentDir = makeAgentDir();
  const services = await loadModelListingServices(cwd, agentDir);
  assert.equal(services.strategy, "lite");
  assert.deepEqual(
    await withoutAmbientCredentials(() => services.modelRuntime.getAvailable()),
    [],
  );
  assert.equal(services.settings.getEnabledModels(), undefined);
});

test("lite path surfaces exactly the providers its models.json declares", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "model-listing-configured-"));
  const agentDir = makeAgentDir({
    providers: {
      acme: {
        apiKey: "test-key-not-a-real-credential",
        api: "openai-completions",
        baseUrl: "https://acme.test/v1",
        models: [{ id: "acme-small" }],
      },
    },
  });
  const services = await loadModelListingServices(cwd, agentDir);
  const available = await withoutAmbientCredentials(() => services.modelRuntime.getAvailable());
  // 空配置那条断言的反面对照：模型清单确实跟着配置面走，不是恒空。
  assert.deepEqual(
    available.map((model) => `${model.provider}/${model.id}`),
    ["acme/acme-small"],
  );
});
