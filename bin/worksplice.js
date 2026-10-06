#!/usr/bin/env node
"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getUnsupportedNodeVersionMessage, isNodeVersionSupported } = require("./node-version");

if (!isNodeVersionSupported(process.versions.node)) {
  console.error(getUnsupportedNodeVersionMessage(process.versions.node));
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseLaunchOptions } = require("./worksplice-options");

const pkgDir = path.join(__dirname, "..");
const nextDir = path.join(pkgDir, ".next");

// Resolve next's CLI entry directly to avoid relying on .bin symlinks (which
// may not exist when installed via npx).
let nextBin;
try {
  nextBin = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
} catch {
  // Fallback: locate next package root and derive the bin path manually.
  try {
    const nextPkg = require.resolve("next/package.json", { paths: [pkgDir] });
    nextBin = path.join(path.dirname(nextPkg), "dist", "bin", "next");
  } catch {
    nextBin = path.join(pkgDir, "node_modules", "next", "dist", "bin", "next");
  }
}

const { port, hostname, openBrowser, demo } = parseLaunchOptions();
const loopbackHostnames = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const passwordEnabled = Boolean(process.env.WORKSPLICE_PASSWORD);

// 人类面准入闸第一道（ADR-0013 决策二）：非 loopback bind + 无凭证 ⇒ 拒绝启动。
// 第二道在服务进程内（lib/access-gate.ts + proxy.ts），因为四条 npm 脚本直接起 `next`，绕过本包装。
if (!loopbackHostnames.has(hostname) && !passwordEnabled) {
  console.error(
    `Refusing to start: worksplice would listen on ${hostname} without WORKSPLICE_PASSWORD.\n` +
      "Set WORKSPLICE_PASSWORD to allow remote access, or bind to 127.0.0.1 (the default).",
  );
  process.exit(1);
}

if (!fs.existsSync(nextDir)) {
  console.error("Build artifacts not found. Please report this issue.");
  process.exit(1);
}

// 演示模式：用一份预置演示库启动，不碰用户真实的 ~/.worksplice，也不启动任何 agent。
let demoDataDir = null;
if (demo) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { prepareDemoDataDir } = require("./demo-data");
    const prepared = prepareDemoDataDir();
    demoDataDir = prepared.dataDir;
    console.log(
      prepared.created
        ? `Demo workspace created at ${prepared.dataDir}`
        : `Using the existing demo workspace at ${prepared.dataDir}`,
    );
    console.log("Demo mode: no agent runs, and your own ~/.worksplice is never touched.");
  } catch (error) {
    console.error(
      `Could not prepare the demo workspace: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

if (!loopbackHostnames.has(hostname)) {
  console.warn(
    `Warning: worksplice is listening on ${hostname} with Basic Auth over HTTP. Use HTTPS or a trusted VPN to protect the password in transit.`,
  );
}

const nextArgs = ["start", "-p", port];
nextArgs.push("-H", hostname);

// Always run next's JS entry with node directly — avoids .bin symlink issues
// and path-with-spaces problems on Windows when shell: true is used.
const child = spawn(process.execPath, [nextBin, ...nextArgs], {
  cwd: pkgDir,
  stdio: ["inherit", "pipe", "inherit"],
  env: {
    ...process.env,
    WORKSPLICE_HOSTNAME: hostname,
    ...(demoDataDir ? { WORKSPLICE_DATA_DIR: demoDataDir, WORKSPLICE_DEMO: "1" } : {}),
  },
});

let browserOpened = false;
const url = `http://${hostname}:${port}`;

child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  if (openBrowser && !browserOpened && text.includes("Ready")) {
    browserOpened = true;
    const isWindows = process.platform === "win32";
    const isMac = process.platform === "darwin";
    const openCmd = isWindows ? "start" : isMac ? "open" : "xdg-open";
    const opener = spawn(openCmd, [url], {
      shell: isWindows,
      stdio: "ignore",
      detached: true,
    });

    opener.on("error", (error) => {
      console.warn(`Could not open browser automatically: ${error.message}`);
    });

    opener.unref();
  }
});

child.on("exit", (code) => process.exit(code ?? 0));
