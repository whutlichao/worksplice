// 打包期生成演示库 `demo/raft.db`（`npm pack` / `npm publish` 会经 prepack 触发它）。
//
// 它做的事：在临时目录里跑一遍 scripts/seed-demo.mjs，把产出的 raft.db 拷到 demo/。
// 产物不进版本库（.gitignore 排除 /demo/），但随 npm 包分发——`--demo` 靠它冷启动。
//
// 用法：node scripts/build-demo-db.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "demo");
const outFile = path.join(outDir, "raft.db");
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "worksplice-demo-db-"));

try {
  execFileSync(process.execPath, [path.join(repoRoot, "scripts", "seed-demo.mjs")], {
    cwd: repoRoot,
    env: { ...process.env, WORKSPLICE_DATA_DIR: tmpDir },
    stdio: ["ignore", "ignore", "inherit"],
  });
  const source = path.join(tmpDir, "raft.db");
  if (!fs.existsSync(source)) throw new Error("seed 没有产出 raft.db");
  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(source, outFile);
  const kb = Math.round(fs.statSync(outFile).size / 1024);
  console.log(`demo/raft.db 已生成（${kb} KB）—— 随包分发，不进版本库`);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
