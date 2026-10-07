// 一次性存量清洗（reply-json-leak）：把 bob 在 2026-10-07 前后落库的「JSON 碎片当正文」消息还原成真回复。
//
//   node scripts/fix-reply-json-leak.mjs [--dry-run] [--apply] [--data-dir <path>] [--json]
//
//   --dry-run    默认。只打印计划，零写入（备份、UPDATE 一个都不发生）。
//   --apply      落盘：先备份整库，再单事务内逐条回填（改前必备份）。
//   --data-dir   数据目录；缺省 WORKSPLICE_DATA_DIR，再缺省 ~/.worksplice。
//   --json       机器可读输出（只打印一个 JSON 对象；错误仍走 stderr 文本）。
//   退出码       0 = 成功（含 0 changes）；2 = 用法/环境错误；1 = 运行期失败。
//
// 存量形态：模型偶发把结构化回复的开头 `{"` 输出成 `","` / `,"`，围栏剥掉后剩下的文本没有 `{`，
// `parseAgentAction` 的两档解析（直接 parse / extractJsonObject）都救不回来 → 整段碎片当正文落库，
// 顺带把本该是换行的 `\n` 变成字面反斜杠 n 糊在一行里。原始输出逐字形如：
//   `","action":"reply","content":"睡前最后一次核对：\n\n2026-10-07 10:41 CST","onConflict":"resend"}`
//
// 为什么是脚本而不是「在读取侧兼容」（同 migrate-i18n-content 的理由）：这是**一次性**脏数据，
// 修完就不再需要兼容分支。修完的库里没有一条消息命中形态，兼容分支成了纯负债。
//
// 判定与防未来修复**同源**：候选生成 + parse + 协议形状校验全部来自
// `lib/agent-loop/json-prologue.ts`（loop.ts 的 parseAgentAction 用的是同一个函数）。
// 两侧判定若各写一份，脚本就会悄悄修出「防未来代码不认」的形状——所以只认一个实现。
//
// 只有校验通过才修：形状不合法（parse 失败 / action 不是 reply|ignore / content 不是字符串）
// 的候选一律跳过并进报告，绝不按「看起来像」硬改。跳过项带 id 与原因，JSON 输出里逐条列出。
//
// 回填值 = 候选 JSON.parse 后的 `content` 字段（字面 `\n` 在这一步还原为真实换行）——
// 这正是当初应该落库、且 parseAgentAction 修复后会落库的那个值。
//
// **旁路数据层写路径的理由**：`Store` 契约刻意没有消息写路径（messages 表不可变，有 BEFORE
// UPDATE/DELETE 触发器护着），而本脚本要做的正是**一次性例外**。因此这里直接用数据层实例
// 暴露的底层连接走 DDL + UPDATE，而不是把「改消息」开成 Store 的产品能力（那样任何调用方
// 都能改消息了）。这是 owner 授权的离线修复工具，不是运行时路径。
//
// 事务边界：`--apply` 先 `VACUUM INTO` 备份（一致性快照，含 WAL 内容），**再**开一个事务：
// DROP TRIGGER messages_no_update → 逐条 UPDATE → 重建触发器 → 提交。SQLite 的 DDL 是事务性的，
// 中途任何一条失败整个事务回滚、触发器跟着回来（不会出现「触发器丢了」的半修状态）。
// FTS 由既有的 messages_fts_update 触发器自动同步，本脚本不碰 messages_fts。
//
// 幂等：回填后的 content 是真回复正文，不再命中形态，第二遍报 0 changes（也不建新备份——
// 备份在有改动时才做）。备份文件名带时间戳，`VACUUM INTO` 遇到已存在文件会直接失败，
// 既不覆盖也不静默改名。
//
// 并发：数据层开着 WAL 与 foreign_keys，脚本照现状开库即可；运行中的实例建议先 --dry-run 看
// 计划、再挑低频时段 --apply（写入要拿写锁，长事务会让 UI 的读延迟变差）。
//
// 范围：只改 messages.content。频道、成员、任务、提醒、会话文件、附件一律不碰。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODE_DRY_RUN = "dry-run";
const MODE_APPLY = "apply";

/** 备份文件名前缀（数据目录下，与 worksplice.db 同级 + 时间戳后缀）。 */
const BACKUP_PREFIX = "worksplice.db.bak-";

/**
 * 重建用的 messages_no_update 定义 —— 与 lib/data/schema.ts 的 SCHEMA_STATEMENTS 里那条
 * **逐字一致**（修复脚本改了触发器就必须原样建回来；schema.ts 那侧本票一个字没改）。
 * 交叉校验由 lib/agent-loop/fix-reply-json-leak.test.mjs 盯住（读 sqlite_master 里的建表 sql 对照）。
 */
export const MESSAGES_NO_UPDATE_SQL = `CREATE TRIGGER messages_no_update BEFORE UPDATE ON messages BEGIN
    SELECT RAISE(ABORT, 'messages are immutable');
  END`;

/**
 * 候选行扫描：`content` 以 `","` 或 `,"` 开头的消息。
 * 判据用 LIKE 前缀收窄成两张表（避免全表捞；两个模式全是字面量，`"` 在 LIKE 里无特殊含义），
 * 真实形态判定仍由 `json-prologue.ts` 的 LEAK_PROLOGUE_PATTERN 在 JS 侧做——
 * SQL 只负责「把候选捞出来」，形态规则不在这写第二份。
 *
 * 排序按 rowid（= 消息实际插入序）而不是 created_at：同毫秒落库的两条消息 created_at 会相等，
 * 按 id 兜底等于按随机 UUID 排序，报告顺序会随机飘（seq 只在单个 target 内有序，跨 target 不可比）。
 */
const CANDIDATE_SQL = `SELECT id, target_id, seq, author_id, content, created_at
  FROM messages
  WHERE content LIKE '","%' OR content LIKE ',"%'
  ORDER BY rowid`;

const USAGE = `用法：node scripts/fix-reply-json-leak.mjs [--dry-run] [--apply] [--data-dir <path>] [--json]

  --dry-run        只打印计划，零写入（默认）
  --apply          落盘修复（改前先备份整库；备份 + 触发器重建都在事务口径内）
  --data-dir PATH  数据目录（默认 WORKSPLICE_DATA_DIR，再默认 ~/.worksplice）
  --json           输出机器可读的 JSON 计划/结果
  -h, --help       打印本说明
`;

class UsageError extends Error {}

function parseArgs(argv) {
  const options = { apply: false, dryRun: false, dataDir: null, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--data-dir" || arg.startsWith("--data-dir=")) {
      const value = arg.startsWith("--data-dir=") ? arg.slice("--data-dir=".length) : argv[++i];
      if (!value || value.startsWith("--")) throw new UsageError("--data-dir 需要一个路径");
      options.dataDir = value;
    } else throw new UsageError(`未知参数：${arg}`);
  }
  if (options.apply && options.dryRun) {
    throw new UsageError("--dry-run 与 --apply 互斥，只能选一个");
  }
  return options;
}

/** 备份时间戳（本地时间，`YYYYMMDD-HHmmss`）。 */
function backupStamp(now = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${date}-${time}`;
}

/** VACUUM INTO 的目标必须是 SQL 字面量：单引号按 SQL 规则双写防注入。 */
function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * 整库一致性快照。VACUUM INTO 产出的文件与源库逐页一致（含 WAL 里已提交的内容），
 * 且目标文件已存在时直接失败——天然满足「不覆盖已有备份」。时间戳到秒，同一秒内对同一
 * 数据目录跑第二次 --apply 会撞名；这里先探一次，把 SQLite 的报错换成一句人话（两个备份
 * 都是完整的，不存在「哪个更新」的问题，但既然不覆盖，就不覆盖）。
 */
function backupDatabase(conn, dataDir) {
  const target = path.join(dataDir, `${BACKUP_PREFIX}${backupStamp()}`);
  if (fs.existsSync(target)) {
    throw new Error(`备份文件已存在，不覆盖：${target}（等一帧再跑，或手动把旧备份挪走）`);
  }
  conn.exec(`VACUUM INTO ${sqlLiteral(target)}`);
  return target;
}

/**
 * 计划：把候选行分成「可修」与「跳过」两档。纯读，不写任何东西。
 * 判定全部走 json-prologue.ts（与 parseAgentAction 同源），本函数不重写形态规则。
 */
function planRepair(conn, parseRepairedReply) {
  const rows = conn.prepare(CANDIDATE_SQL).all();
  const repaired = [];
  const skipped = [];
  for (const row of rows) {
    const parsed = parseRepairedReply(row.content);
    if (!parsed) {
      skipped.push({ ...summarize(row), reason: "形态命中但候选 JSON.parse 失败或形状不合协议" });
      continue;
    }
    if (parsed.content === null) {
      skipped.push({ ...summarize(row), reason: "形状合协议但 content 不是字符串，无从回填" });
      continue;
    }
    repaired.push({ ...summarize(row), to: parsed.content });
  }
  return { repaired, skipped };
}

function summarize(row) {
  return {
    id: row.id,
    targetId: row.target_id,
    seq: row.seq,
    authorId: row.author_id,
    createdAt: row.created_at,
    from: row.content,
  };
}

/** 落盘：单事务内 DROP 触发器 → 逐条回填 → 原样重建触发器。DDL 与 UPDATE 同事务，中途失败整体回滚。 */
function applyRepair(conn, plan) {
  const update = conn.prepare("UPDATE messages SET content = ? WHERE id = ?");
  conn.transaction(() => {
    conn.exec("DROP TRIGGER messages_no_update");
    for (const row of plan.repaired) update.run(row.to, row.id);
    conn.exec(MESSAGES_NO_UPDATE_SQL);
  })();
}

function renderHuman(report) {
  const { mode, dataDir, repaired, skipped, backups, changes } = report;
  const lines = [`worksplice 回复 JSON 碎片清洗 · ${mode} · 数据目录 ${dataDir}`];
  for (const row of repaired) {
    lines.push(`  修复 ${row.id}（#${row.seq} ${row.targetId}，${row.createdAt}）：${row.to.length} 字符`);
  }
  for (const row of skipped) {
    lines.push(`  skip (${row.reason})：${row.id}（#${row.seq} ${row.targetId}）保持现状`);
  }
  for (const backup of backups) lines.push(`  备份：${backup}`);
  const summary = `${mode}: ${changes} changes（修复 ${repaired.length}，跳过 ${skipped.length}，备份 ${backups.length}）`;
  lines.push(mode === MODE_APPLY ? summary : `${summary} —— 未写入（加 --apply 落盘）`);
  return `${lines.join("\n")}\n`;
}

function renderJson(report) {
  const { mode, dataDir, repaired, skipped, backups, changes } = report;
  const strip = ({ id, targetId, seq, authorId, createdAt }) => ({ id, targetId, seq, authorId, createdAt });
  return `${JSON.stringify(
    {
      mode,
      dataDir,
      changes,
      counts: { repaired: repaired.length, skipped: skipped.length, backups: backups.length },
      repaired: repaired.map(({ to, ...rest }) => ({ ...strip(rest), to })),
      skipped,
      backups,
    },
    null,
    2,
  )}\n`;
}

async function repair(options) {
  const { openDataDb } = await import("../lib/data/sqlite.ts");
  const { DB_FILE_NAME, resolveDataDir } = await import("../lib/data/dirs.ts");
  const { parseRepairedReply } = await import("../lib/agent-loop/json-prologue.ts");

  const dataDir = path.resolve(options.dataDir ?? resolveDataDir());

  // 数据目录必须先存在且可读：打开数据层会补建目录/库，脚本绝不制造一个「空数据目录」。
  if (!fs.existsSync(dataDir) || !fs.statSync(dataDir).isDirectory()) {
    throw new UsageError(`数据目录不存在或不是目录：${dataDir}`);
  }
  try {
    fs.accessSync(dataDir, fs.constants.R_OK | fs.constants.X_OK);
  } catch {
    throw new UsageError(`数据目录不可读：${dataDir}`);
  }
  if (!fs.existsSync(path.join(dataDir, DB_FILE_NAME))) {
    throw new UsageError(`数据目录里没有 ${DB_FILE_NAME}（先让 worksplice 打开过它）：${dataDir}`);
  }

  const db = openDataDb(dataDir);
  const backups = [];
  try {
    // 旁路写路径（见头部注释）：Store 契约刻意没有消息写路径，本脚本是 owner 授权的
    // 一次性例外，直接用 adapter 实例暴露的底层连接。
    const conn = db.db;
    const plan = planRepair(conn, parseRepairedReply);
    if (options.apply && plan.repaired.length > 0) {
      // 先备份（有改动才备份），再单事务回填
      backups.push(backupDatabase(conn, dataDir));
      applyRepair(conn, plan);
    }
    return {
      mode: options.apply ? MODE_APPLY : MODE_DRY_RUN,
      dataDir,
      // dry-run 的 changes 是「计划条数」（与 migrate-i18n-content 同一口径）：
      // 报告的是「若 --apply 会改几条」，未写入这件事由人类可读那行的「未写入」讲清楚。
      changes: plan.repaired.length,
      repaired: plan.repaired,
      skipped: plan.skipped,
      backups,
    };
  } finally {
    db.close();
  }
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const report = await repair(options);
  process.stdout.write(options.json ? renderJson(report) : renderHuman(report));
  return 0;
}

const isDirectRun =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n\n${USAGE}`);
      process.exitCode = 2;
    } else {
      process.stderr.write(`清洗失败：${error?.stack ?? error}\n`);
      process.exitCode = 1;
    }
  }
}