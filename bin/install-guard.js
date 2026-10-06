"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");

const PACKAGE_ROOT = path.resolve(__dirname, "..");
// bun 也会设一堆 npm_* 环境变量，所以只认用户代理的 npm/ 前缀。
const NPM_USER_AGENT_PREFIX = "npm/";
const LOCK_FILE = "bun.lock";

// 判定矩阵见 lib/install-guard.test.mjs：只有「npm 家族 + 本仓库源码 checkout」同时成立才拦。
function isInstallBlocked({ userAgent, initCwd, hasBunLock, packageRoot }) {
  if (!userAgent || !userAgent.startsWith(NPM_USER_AGENT_PREFIX)) return false;
  // 没有 bun.lock = 不是本仓库 checkout（消费者从 tarball 装时包里不含 bun.lock）。
  if (!hasBunLock) return false;
  // npm 把 INIT_CWD 设成用户敲命令的目录；在消费者项目里跑 preinstall 时它不是包根。
  if (initCwd && path.resolve(initCwd) !== packageRoot) return false;
  return true;
}

function getBlockedInstallMessage() {
  return [
    "This checkout tracks bun.lock, so install dependencies with `bun install` (or `bun install --frozen-lockfile`).",
    "`npm install` is blocked here: it ignores bun.lock and resolves a different dependency tree, which makes every lint/typecheck baseline incomparable.",
    "`npm run <script>` is unaffected — the script runner does not touch dependency resolution.",
    "See AGENTS.md > Quick Start for the install discipline.",
  ].join("\n");
}

function main() {
  const blocked = isInstallBlocked({
    userAgent: process.env.npm_config_user_agent,
    initCwd: process.env.INIT_CWD,
    hasBunLock: fs.existsSync(path.join(PACKAGE_ROOT, LOCK_FILE)),
    packageRoot: PACKAGE_ROOT,
  });

  if (!blocked) return 0;

  console.error(getBlockedInstallMessage());
  return 1;
}

if (require.main === module) process.exit(main());

module.exports = {
  getBlockedInstallMessage,
  isInstallBlocked,
};
