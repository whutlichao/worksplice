"use strict";

// 演示模式（`worksplice --demo`）的数据准备：把随包分发的演示库复制到目标目录，
// 并把库里记录的原机器路径重写成「这台机器」的路径。
//
// 为什么随包带一份预置数据库、而不是在用户机器上跑 seed 脚本：
//   1. `scripts/` 不在 npm 包的 files 白名单里（它是开发期工具）；
//   2. seed 脚本 import 仓库里的 .ts 模块，依赖 Node 的 TS strip，在 Node 22.19 上不稳。
// 演示库由 scripts/build-demo-db.mjs 在打包期生成，本身不进版本库。
//
// 用法：
//   const { prepareDemoDataDir } = require("./demo-data");
//   const { dataDir } = prepareDemoDataDir();   // 幂等：已存在则原样复用

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const os = require("node:os");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path");

const DEMO_DB_NAME = "raft.db";
const DEMO_DB_RELATIVE = path.join("demo", DEMO_DB_NAME);
const AGENTS_DIR_NAME = "agents";
const ATTACHMENTS_DIR_NAME = "attachments";

/** 演示数据目录：`WORKSPLICE_DEMO_DIR` 可覆盖，默认 `~/.worksplice-demo`。 */
function resolveDemoDataDir(env = process.env) {
  const override = env.WORKSPLICE_DEMO_DIR;
  return override && override.trim()
    ? path.resolve(override)
    : path.join(os.homedir(), ".worksplice-demo");
}

/**
 * 把演示库里 agent 的家目录重写到本机：种子数据是在打包那台机器上生成的，
 * 路径写死在 `<打包机数据目录>/agents/<slug>-<id8>`。同时清空 `pi_session_file`
 * （那些会话文件只存在于打包机上），并按新路径建出目录，免得界面显示不存在的路径。
 */
function rewriteAgentPaths(dbFile, dataDir) {
  // 延迟 require：better-sqlite3 是原生依赖，只有真要用演示库时才拉它。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3");
  const db = new Database(dbFile);
  try {
    const rows = db
      .prepare(
        "SELECT id, workspace_path FROM members WHERE workspace_path IS NOT NULL AND workspace_path LIKE '%agents%'",
      )
      .all();
    const update = db.prepare(
      "UPDATE members SET workspace_path = ?, pi_session_file = NULL WHERE id = ?",
    );
    const dirs = [];
    const apply = db.transaction((list) => {
      for (const row of list) {
        const next = path.join(dataDir, AGENTS_DIR_NAME, path.basename(String(row.workspace_path)));
        update.run(next, row.id);
        dirs.push(next);
      }
    });
    apply(rows);
    for (const dir of dirs) fs.mkdirSync(dir, { recursive: true });
    return dirs;
  } finally {
    db.close();
  }
}

/**
 * 准备演示数据目录并返回路径。
 * 幂等：目录里已经有 `raft.db` 时不再覆盖（用户可能在演示里发过消息，重跑不该抹掉）。
 */
function prepareDemoDataDir(options = {}) {
  const pkgDir = options.pkgDir ?? path.join(__dirname, "..");
  const dataDir = path.resolve(options.dataDir ?? resolveDemoDataDir(options.env));
  const source = path.join(pkgDir, DEMO_DB_RELATIVE);
  if (!fs.existsSync(source)) {
    // 报错必须给出下一步命令：已发布的包里演示库是现成的，只有源码 checkout 才会缺它，
    // 而"缺了"这件事光看路径猜不出该怎么办。
    throw new Error(
      `Demo database not found at ${source}. Published packages already include it; ` +
        `in a source checkout run \`npm run build:demo-db\` once to generate it.`,
    );
  }

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, AGENTS_DIR_NAME), { recursive: true });
  fs.mkdirSync(path.join(dataDir, ATTACHMENTS_DIR_NAME), { recursive: true });

  const dbFile = path.join(dataDir, DEMO_DB_NAME);
  if (fs.existsSync(dbFile)) {
    return { dataDir, dbFile, created: false, agentDirs: [] };
  }
  fs.copyFileSync(source, dbFile);
  const agentDirs = rewriteAgentPaths(dbFile, dataDir);
  return { dataDir, dbFile, created: true, agentDirs };
}

module.exports = {
  DEMO_DB_NAME,
  DEMO_DB_RELATIVE,
  prepareDemoDataDir,
  resolveDemoDataDir,
  rewriteAgentPaths,
};
