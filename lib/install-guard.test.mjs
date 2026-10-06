import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { getBlockedInstallMessage, isInstallBlocked } = require("../bin/install-guard.js");

// 真实包根（守卫入口从这里推导）与合成包根（纯判定矩阵用，便于构造相对路径用例）。
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GUARD = path.join(PACKAGE_ROOT, "bin", "install-guard.js");
const FIXTURE_ROOT = "/repo/worksplice";
const NPM_AGENT = "npm/10.9.2 node/v22.19.0 darwin arm64 workspaces/false";

// 判定矩阵：只有「npm 家族」与「仓库源码 checkout」同时成立才拦。
const INSTALL_CASES = [
  {
    name: "blocks npm install at the package root of the source checkout",
    input: { userAgent: NPM_AGENT, initCwd: FIXTURE_ROOT, hasBunLock: true },
    blocked: true,
  },
  {
    name: "blocks npm ci, whose user agent also starts with npm/",
    input: { userAgent: "npm/10.9.2 node/v22.19.0 linux x64 workspaces/false ci/true", initCwd: FIXTURE_ROOT, hasBunLock: true },
    blocked: true,
  },
  {
    name: "blocks npm started from the package root written with a trailing slash",
    input: { userAgent: NPM_AGENT, initCwd: `${FIXTURE_ROOT}/`, hasBunLock: true },
    blocked: true,
  },
  {
    name: "allows bun, which sets npm_* variables but never npm/ as the user agent",
    input: { userAgent: "bun/1.3.14 npm/? node/v22.19.0 darwin arm64", initCwd: FIXTURE_ROOT, hasBunLock: true },
    blocked: false,
  },
  {
    name: "allows pnpm",
    input: { userAgent: "pnpm/10.0.0 npm/? node/v22.19.0 darwin arm64", initCwd: FIXTURE_ROOT, hasBunLock: true },
    blocked: false,
  },
  {
    name: "allows yarn",
    input: { userAgent: "yarn/1.22.22 npm/? node/v22.19.0 darwin arm64", initCwd: FIXTURE_ROOT, hasBunLock: true },
    blocked: false,
  },
  {
    name: "allows a hand-run node script, which has no user agent at all",
    input: { userAgent: undefined, initCwd: FIXTURE_ROOT, hasBunLock: true },
    blocked: false,
  },
  {
    name: "allows npm when the package root has no bun.lock, as when a consumer installs the tarball",
    input: { userAgent: NPM_AGENT, initCwd: FIXTURE_ROOT, hasBunLock: false },
    blocked: false,
  },
  {
    name: "allows npm when INIT_CWD points somewhere other than the package root",
    input: { userAgent: NPM_AGENT, initCwd: "/tmp/consumer-app", hasBunLock: true },
    blocked: false,
  },
];

function runGuardEntry(env) {
  return spawnSync(process.execPath, [GUARD], {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

for (const { name, input, blocked } of INSTALL_CASES) {
  test(name, () => {
    assert.equal(isInstallBlocked({ ...input, packageRoot: FIXTURE_ROOT }), blocked);
  });
}

test("tells the reader to use bun install and that npm run <script> still works", () => {
  const message = getBlockedInstallMessage();

  assert.match(message, /bun install/);
  assert.match(message, /bun\.lock/);
  assert.match(message, /npm install/);
  assert.match(message, /npm run <script>/);
});

test("exits non-zero with the guidance when npm runs the guard as its preinstall hook", () => {
  const result = runGuardEntry({ npm_config_user_agent: NPM_AGENT, INIT_CWD: PACKAGE_ROOT });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /bun install/);
});

test("exits zero and prints nothing when bun runs the guard as its preinstall hook", () => {
  const result = runGuardEntry({
    npm_config_user_agent: "bun/1.3.14 npm/? node/v22.19.0 darwin arm64",
    INIT_CWD: PACKAGE_ROOT,
  });

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
});
