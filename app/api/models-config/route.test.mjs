import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

// getAgentDir() 每次调用都读取 PI_CODING_AGENT_DIR，把 agent 目录指向临时目录，
// 避免测试读写开发机上的 ~/.pi（models.json、auth.json、settings.json）。
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = mkdtempSync(join(tmpdir(), "models-config-route-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET, PUT } = await jiti.import("./route.ts");
const { invalidateModelsCache, loadModelsWithCache } = await jiti.import(
  "../../../lib/models-cache.ts",
);
const { buildApiKeyProviderList, buildOAuthProviderList } = await jiti.import(
  "../../../lib/provider-listing.ts",
);

const modelsPath = join(agentDir, "models.json");

after(() => {
  invalidateModelsCache();
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
});

function putRequest(body) {
  return new Request("http://localhost:30142/api/models-config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sampleModels() {
  return {
    providers: {
      acme: {
        baseUrl: "https://api.acme.test/v1",
        api: "openai-completions",
        models: [
          { id: "acme-fast", name: "Acme Fast" },
          { id: "acme-deep", name: "Acme Deep" },
        ],
        customField: { keep: true },
      },
    },
  };
}

test("GET returns the existing models.json as-is", async () => {
  const data = sampleModels();
  writeFileSync(modelsPath, JSON.stringify(data, null, 2), "utf8");

  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), data);
});

test("GET falls back to an empty provider map when models.json is missing", async () => {
  rmSync(modelsPath, { force: true });

  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { providers: {} });
});

test("PUT strips empty model entries and lands the file atomically with private permissions", async () => {
  writeFileSync(modelsPath, JSON.stringify({ providers: {} }), "utf8");

  const body = sampleModels();
  body.providers.acme.models.push({ id: "" }, { id: "   " }, { name: "no-id" }, null);
  const response = await PUT(putRequest(body));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });

  const written = JSON.parse(readFileSync(modelsPath, "utf8"));
  assert.deepEqual(written.providers.acme.models.map((model) => model.id), [
    "acme-fast",
    "acme-deep",
  ]);
  // 非模型字段不参与清洗，必须逐字保留。
  assert.deepEqual(written.providers.acme.customField, { keep: true });
  assert.equal(written.providers.acme.baseUrl, "https://api.acme.test/v1");

  // writePrivateFileAtomicSync 以 0600 写临时文件再 rename；rename 之后不得残留临时文件。
  assert.equal(statSync(modelsPath).mode & 0o777, 0o600);
  assert.deepEqual(
    readdirSync(agentDir).filter((name) => name.endsWith(".tmp")),
    [],
  );

  const readBack = await (await GET()).json();
  assert.deepEqual(readBack, written);
});

test("PUT invalidates the models cache so the next listing re-reads models.json", async () => {
  const cacheKey = join(agentDir, "cache-key");
  let loads = 0;
  const load = (tag) => async () => {
    loads += 1;
    return { models: {}, modelList: [], defaultModel: null, thinkingLevels: {}, thinkingLevelMaps: {}, thinkingLevelPins: {}, tag };
  };

  invalidateModelsCache();
  const first = await loadModelsWithCache(cacheKey, load("first"));
  const cached = await loadModelsWithCache(cacheKey, load("second"));
  assert.equal(loads, 1);
  assert.equal(cached, first);

  const response = await PUT(putRequest(sampleModels()));
  assert.equal(response.status, 200);

  const refreshed = await loadModelsWithCache(cacheKey, load("after-put"));
  assert.equal(loads, 2);
  assert.equal(refreshed.tag, "after-put");
});

test("a dual-auth provider stays visible in both auth lists across credential switches", () => {
  // 全量矩阵在 lib/provider-listing.test.mjs；这里只钉住 auth 变化后 Models 面板
  // 依赖的刷新规则（同一 provider 双列表可见、凭据类型切换后互斥点亮）。
  const dual = (credentialType) => [{
    id: "anthropic",
    name: "Anthropic",
    hasApiKeyLogin: true,
    hasOAuth: true,
    oauthName: "Anthropic (Claude Pro/Max)",
    status: { configured: true, source: "stored" },
    credentialType,
    modelCount: 3,
  }];

  const withApiKey = dual("api_key");
  assert.deepEqual(
    buildApiKeyProviderList(withApiKey).map((p) => [p.id, p.configured, p.supportsOAuth]),
    [["anthropic", true, true]],
  );
  assert.deepEqual(
    buildOAuthProviderList(withApiKey).map((p) => [p.id, p.loggedIn, p.supportsApiKey]),
    [["anthropic", false, true]],
  );

  const withOAuth = dual("oauth");
  assert.deepEqual(
    buildApiKeyProviderList(withOAuth).map((p) => [p.id, p.configured, p.supportsOAuth]),
    [["anthropic", false, true]],
  );
  assert.deepEqual(
    buildOAuthProviderList(withOAuth).map((p) => [p.id, p.loggedIn, p.supportsApiKey]),
    [["anthropic", true, true]],
  );
});
