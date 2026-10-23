import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = mkdtempSync(join(tmpdir(), "plugins-route-agent-"));
const cwd = mkdtempSync(join(tmpdir(), "plugins-route-cwd-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET, POST } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");

allowFileRoot(cwd);

const settingsPath = join(agentDir, "settings.json");
const PACKAGE = "npm:demo-package@1.2.3";

before(() => {
  writeFileSync(settingsPath, JSON.stringify({ packages: [PACKAGE] }, null, 2), "utf8");
});

after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function getRequest(target = cwd) {
  return new Request(`http://localhost:30142/api/plugins?cwd=${encodeURIComponent(target)}`, {
    headers: { host: "localhost:30142" },
  });
}

function postRequest(body, headers = {}) {
  return new Request("http://localhost:30142/api/plugins", {
    method: "POST",
    headers: { host: "localhost:30142", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("GET lists configured packages from DefaultPackageManager with zeroed totals", async () => {
  const response = await GET(getRequest());
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.deepEqual(body.totals, { extensions: 0, skills: 0, prompts: 0, themes: 0 });
  assert.equal(body.packages.length, 1);

  const [pkg] = body.packages;
  assert.equal(pkg.source, PACKAGE);
  assert.equal(pkg.scope, "global");
  assert.equal(pkg.disabled, false);
  assert.equal(pkg.configuredVersion, "1.2.3");
  assert.deepEqual(pkg.counts, { extensions: 0, skills: 0, prompts: 0, themes: 0 });
  // 本机未安装该包：readPlugins 应把包标为 missing 并留下 diagnostic，而不是整份列表失败。
  assert.equal(pkg.status, "missing");
  assert.ok(body.diagnostics.some((d) => d.source === PACKAGE && d.type === "warning"));
  assert.equal(body.projectResourcesLoaded, true);
});

test("POST disable persists the empty-resource entry and the next GET reports it disabled", async () => {
  const disable = await POST(postRequest({
    action: "disable",
    source: PACKAGE,
    scope: "global",
    cwd,
  }));
  assert.equal(disable.status, 200);
  const afterDisable = await disable.json();
  assert.equal(afterDisable.packages[0].disabled, true);
  assert.equal(afterDisable.packages[0].status, "disabled");

  const persisted = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.deepEqual(persisted.packages, [{
    source: PACKAGE,
    extensions: [],
    skills: [],
    prompts: [],
    themes: [],
  }]);

  const listed = await (await GET(getRequest())).json();
  assert.equal(listed.packages[0].disabled, true);
});

test("POST enable restores the string package entry and the swap is visible on reload", async () => {
  const enable = await POST(postRequest({
    action: "enable",
    source: PACKAGE,
    scope: "global",
    cwd,
  }));
  assert.equal(enable.status, 200);
  const afterEnable = await enable.json();
  assert.equal(afterEnable.packages[0].disabled, false);
  assert.equal(afterEnable.packages[0].status, "missing");

  assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")).packages, [PACKAGE]);

  const listed = await (await GET(getRequest())).json();
  assert.equal(listed.packages[0].disabled, false);
});

test("GET rejects a missing or unlisted cwd", async () => {
  assert.equal((await GET(new Request("http://localhost:30142/api/plugins", {
    headers: { host: "localhost:30142" },
  }))).status, 400);

  const outside = mkdtempSync(join(tmpdir(), "plugins-route-outside-"));
  try {
    assert.equal((await GET(getRequest(outside))).status, 403);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("POST enforces trust, JSON content type and required fields", async () => {
  assert.equal((await POST(postRequest({}, { host: "evil.example" }))).status, 403);
  assert.equal((await POST(postRequest({ action: "disable", cwd }, { "content-type": "text/plain" }))).status, 415);
  assert.equal((await POST(postRequest({ action: "disable" }))).status, 400);
  assert.equal((await POST(postRequest({ cwd }))).status, 400);
  assert.equal((await POST(postRequest({ action: "disable", cwd }))).status, 400);
  assert.equal((await POST(postRequest({ action: "frobnicate", cwd }))).status, 400);
});
