// 存量内容英文化显式迁移（i18n 内容层 ticket）：把 PR #81 之前的存量内容改成英文硬编码后的新形态。
//
//   node scripts/migrate-i18n-content.mjs [--dry-run] [--apply] [--data-dir <path>] [--json]
//
//   --dry-run    默认。只打印计划，零写入（频道名、MEMORY.md 字节、备份都不落地）。
//   --apply      落盘：频道改名 + MEMORY.md 节名英文化（改前先备份）。
//   --data-dir   数据目录；缺省 WORKSPLICE_DATA_DIR，再缺省 ~/.worksplice。
//   --json       机器可读输出（只打印一个 JSON 对象；错误仍走 stderr 文本）。
//   退出码       0 = 成功（含 0 changes 与冲突跳过）；2 = 用法/环境错误；1 = 运行期失败。
//
// 为什么是脚本而不是启动时迁移（docs/i18n.md 分层规则）：运行时仍不做任何隐式迁移——
// 存量英文化必须是显式、可预演（dry-run）、可回退（备份）的动作，且要能对着临时数据目录
// 先演练。数据访问走既有数据层（lib/data 的 adapter 工厂 + Store 契约），本脚本不新增
// 旁路 SQL；唯一新增的数据层能力是 `Store.renameChannel`（频道名此前没有写路径）。
//
// 幂等：连跑两次第二遍报 0 changes（节名已英文、频道名已是新名）；备份只在「该文件首次
// 被改动」时创建，已存在 `MEMORY.md.bak-*` 则不再创建、不覆盖（见 backupMemoryFile）。
//
// 关于「dry-run 零写入」的口径：业务数据（频道名、MEMORY.md 字节、备份）一个都不写；
// 唯一可能的副作用来自数据层既有的**打开语义**——ensureDataDir 补建 attachments/agents
// 目录与 raft.db 改名、runMigrations 的 schema 前向升级。那些是数据层的既有职责，
// 且数据目录必须先有 worksplice.db 本脚本才开库（绝不制造空库）。持续运行中的实例
// 对这些文件本来就有写权（WAL），迁移前仍建议停服或至少先 dry-run 看计划。
//
// 迁移四类存量内容（全部只在显式运行时发生）：
//   ① 办公室频道改名：旧名「秘书办公室」→ secretary-office（旧名取自 secretary-init.ts 的 LEGACY_OFFICE_CHANNEL_NAMES）；
//   ② 办公室频道描述：旧中文描述 → secretary-init.ts 的 OFFICE_CHANNEL_DESCRIPTION；
//   ③ 秘书描述：旧中文描述 → secretary-init.ts 的 SUSAN_DESCRIPTION；
//   ④ 家目录 MEMORY.md 六个旧节名 → 英文节名（只改节名行，正文一个字不动）。
// 描述类字段只改「与已知旧中文常量**逐字相等**」的值：人写过的描述一律不动（`skip (custom description)`），
// 绝不按「含中文就改」扫；已是英文值的报 `skip (already english)`，空描述不占一行计划。
//
// 范围（刻意不做的事）：消息内容不可变，一个字都不动；会话文件、附件、任务/提醒文案、
// 其它用户自定义频道名都在范围外。
//
// 改写口径的已知边界：按**行**匹配 `## <旧节名>` 整行，不做 Markdown 结构解析——如果
// 旧节名恰好出现在代码围栏或正文里（`## 角色描述` 单独成行），它也会被当成节名行改写。
// 干跑计划会把每一处改动连节名一起打印，跑 `--apply` 前看一眼即可发现。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODE_DRY_RUN = "dry-run";
const MODE_APPLY = "apply";

/** 备份文件名前缀（同目录、同文件名 + 时间戳后缀）。 */
const BACKUP_PREFIX = "MEMORY.md.bak-";

/**
 * 旧 → 新节名映射（ADR-0001 固定大纲的存量侧对照）。
 * 旧名 = PR #81 之前的产线事实；新名与 lib/data/dirs.ts 的 `buildMemoryTemplate` 对齐
 * （migrate-i18n-content.test.mjs 用模板产物交叉校验两侧一致）。
 */
export const LEGACY_MEMORY_SECTIONS = Object.freeze({
  角色描述: "Role",
  当前工作: "Current work",
  工作流程: "Workflow",
  "Skill 使用": "Skills",
  工具使用: "Tools",
  其他: "Other",
});

/**
 * 旧中文描述（PR #81 之前的产线事实，逐字取自 Owner live 数据）。
 * 英文侧不在这里复写第二份：运行时只读 import `secretary-init.ts` 的 `OFFICE_CHANNEL_DESCRIPTION` /
 * `SUSAN_DESCRIPTION`，产品改文案时脚本自动跟上；测试用自己写的旧字面量交叉校验（常量写错就红）。
 */
const LEGACY_OFFICE_CHANNEL_DESCRIPTION = "秘书的 1:1 沟通场所";
const LEGACY_SECRETARY_DESCRIPTION =
  "worksplice 的秘书：自动加入全部频道，熟悉系统手册，可代办频道/成员创建与查询，越权操作引导 Owner UI";

const USAGE = `用法：node scripts/migrate-i18n-content.mjs [--dry-run] [--apply] [--data-dir <path>] [--json]

  --dry-run        只打印计划，零写入（默认）
  --apply          落盘迁移（频道改名/频道描述/秘书描述 + MEMORY.md 节名英文化，改 MEMORY.md 前先备份）
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

/** 节名行改写：只动 `## <旧节名>` 这一行的节名，行尾换行符与其余字节原样保留。 */
function rewriteLegacySections(content) {
  const sections = [];
  const lines = content.split("\n");
  const next = lines.map((line) => {
    const body = line.endsWith("\r") ? line.slice(0, -1) : line;
    const eol = body === line ? "" : "\r";
    const match = /^(##[ \t]+)(.+?)([ \t]*)$/.exec(body);
    if (!match) return line;
    const target = LEGACY_MEMORY_SECTIONS[match[2]];
    if (!target) return line;
    sections.push({ from: match[2], to: target });
    return `${match[1]}${target}${match[3]}${eol}`;
  });
  return { content: next.join("\n"), sections };
}

/** 备份时间戳（本地时间，`YYYYMMDD-HHmmss`）。 */
function backupStamp(now = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${date}-${time}`;
}

/** 数据目录里所有 `MEMORY.md`（递归；软删 agent 的家目录照样在册）。符号链接不跟随。 */
function findMemoryFiles(dataDir, memoryFileName) {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name === memoryFileName) found.push(full);
    }
  };
  walk(dataDir);
  return found.sort();
}

/**
 * 描述字段的三路判定（频道与成员同规则）：只认「与已知旧中文常量逐字相等」的值——
 * 绝不做「含中文就改」的扫描；人写过的描述一个字都不碰。
 */
function planDescriptions(rows, { legacyDescription, description: currentDescription }) {
  const described = [];
  const skipped = [];
  for (const row of rows) {
    if (row.description === legacyDescription) {
      described.push({
        id: row.id,
        name: row.name,
        from: row.description,
        to: currentDescription,
      });
    } else if (row.description === currentDescription) {
      skipped.push({ id: row.id, name: row.name, reason: "already english" });
    } else if (row.description === "") {
      // 空描述没什么可迁移的，也不值得占一行计划
    } else {
      skipped.push({ id: row.id, name: row.name, reason: "custom description" });
    }
  }
  return { described, skipped };
}

/**
 * 计划：频道改名/频道描述/成员描述 + MEMORY.md 节名改写。纯读，不写任何东西。
 * 冲突安全：目标名 `secretary-office` 已被占用时该行保持现状（跳过，不制造重名）。
 */
function planMigration(db, options) {
  const { dataDir, memoryFileName, vocabulary } = options;
  const channels = db.listChannels();
  const renamed = [];
  const skippedChannels = [];
  let targetTaken = channels.some((channel) => channel.name === vocabulary.office.name);
  for (const channel of channels) {
    if (!vocabulary.office.legacyNames.includes(channel.name)) continue;
    // 目标名只能被一行占用：第一行改名后 targetTaken 即为真，其余同名旧行会撞名，保持现状。
    if (targetTaken) {
      skippedChannels.push({ id: channel.id, name: channel.name, reason: "target exists" });
      continue;
    }
    renamed.push({ id: channel.id, from: channel.name, to: vocabulary.office.name });
    targetTaken = true;
  }

  const channelDescriptions = planDescriptions(channels, vocabulary.office);
  // 软删 agent 也在册（与 MEMORY.md 口径一致：行还在、UI 不显示，但描述仍是产品文案）
  const memberDescriptions = planDescriptions(
    db.listMembers().filter((member) => member.type === "agent"),
    vocabulary.secretary,
  );

  const updated = [];
  const skippedFiles = [];
  for (const filePath of findMemoryFiles(dataDir, memoryFileName)) {
    // 只改节名行 = 其余字节原样同回：先证明这份文件能无損 UTF-8 往返，否则宁可不迁移，不毁字节。
    const buffer = fs.readFileSync(filePath);
    const original = buffer.toString("utf8");
    if (!Buffer.from(original, "utf8").equals(buffer)) {
      throw new Error(`MEMORY.md 不是合法 UTF-8，拒绝改写：${filePath}`);
    }
    const { content, sections } = rewriteLegacySections(original);
    if (sections.length === 0) {
      skippedFiles.push({ path: filePath, reason: "already english" });
      continue;
    }
    updated.push({ path: filePath, sections, original, migrated: content, backup: null });
  }

  return {
    channels: {
      renamed,
      described: channelDescriptions.described,
      skipped: [...skippedChannels, ...channelDescriptions.skipped],
    },
    members: { described: memberDescriptions.described, skipped: memberDescriptions.skipped },
    memoryFiles: { updated, skipped: skippedFiles },
  };
}

/**
 * 备份：只在「该文件首次被改动」时创建。已存在任何 `MEMORY.md.bak-*` 时不再创建、不覆盖
 * （存量迁移是一次性动作，第二遍不会改文件，也就不会再有备份）。
 */
function backupMemoryFile(filePath, original) {
  const dir = path.dirname(filePath);
  const exists = fs
    .readdirSync(dir)
    .some((name) => name.startsWith(BACKUP_PREFIX));
  if (exists) return null;
  const target = path.join(dir, `${BACKUP_PREFIX}${backupStamp()}`);
  fs.writeFileSync(target, original, { encoding: "utf8", flag: "wx" });
  return target;
}

function renderHuman(report) {
  const { mode, dataDir, channels, members, memoryFiles, backups, changes, counts } = report;
  const lines = [`worksplice 存量内容英文化迁移 · ${mode} · 数据目录 ${dataDir}`];
  for (const rename of channels.renamed) {
    lines.push(`  频道改名：「${rename.from}」→「${rename.to}」（${rename.id}）`);
  }
  for (const described of channels.described) {
    lines.push(`  频道描述：「${described.name}」：「${described.from}」→「${described.to}」（${described.id}）`);
  }
  for (const described of members.described) {
    lines.push(`  成员描述：「${described.name}」：「${described.from}」→「${described.to}」（${described.id}）`);
  }
  for (const skip of channels.skipped) {
    lines.push(`  skip (${skip.reason})：频道「${skip.name}」（${skip.id}）保持现状`);
  }
  for (const skip of members.skipped) {
    lines.push(`  skip (${skip.reason})：成员「${skip.name}」（${skip.id}）保持现状`);
  }
  for (const update of memoryFiles.updated) {
    const sections = update.sections.map((s) => `${s.from}→${s.to}`).join(", ");
    lines.push(`  MEMORY.md：${update.path}（${sections}）`);
  }
  for (const skip of memoryFiles.skipped) {
    lines.push(`  skip (${skip.reason})：${skip.path}`);
  }
  for (const backup of backups) lines.push(`  备份：${backup}`);
  const summary = `${mode}: ${changes} changes（频道改名 ${counts.channelsRenamed}, 频道描述 ${counts.channelDescriptions}, 成员描述 ${counts.memberDescriptions}, MEMORY.md ${counts.memoryFiles}, 备份 ${counts.backups}）`;
  lines.push(mode === MODE_APPLY ? summary : `${summary} —— 未写入（加 --apply 落盘）`);
  return `${lines.join("\n")}\n`;
}

function renderJson(report) {
  const { mode, dataDir, channels, members, memoryFiles, backups, changes, counts } = report;
  const strip = ({ id, name, reason }) => ({ id, name, reason });
  return `${JSON.stringify(
    {
      mode,
      dataDir,
      changes,
      counts,
      channels: {
        renamed: channels.renamed,
        described: channels.described,
        skipped: channels.skipped.map(strip),
      },
      members: {
        described: members.described,
        skipped: members.skipped.map(strip),
      },
      memoryFiles: {
        updated: memoryFiles.updated.map(({ path: filePath, sections, backup }) => ({
          path: filePath,
          sections,
          backup,
        })),
        skipped: memoryFiles.skipped,
      },
      backups,
    },
    null,
    2,
  )}\n`;
}

async function migrate(options) {
  const { openDataDb } = await import("../lib/data/sqlite.ts");
  const { DB_FILE_NAME, MEMORY_FILE_NAME, resolveDataDir } = await import("../lib/data/dirs.ts");
  const {
    OFFICE_CHANNEL_NAME,
    OFFICE_CHANNEL_DESCRIPTION,
    SUSAN_DESCRIPTION,
    LEGACY_OFFICE_CHANNEL_NAMES,
  } = await import("../lib/domain/collab/secretary-init.ts");

  const dataDir = path.resolve(options.dataDir ?? resolveDataDir());

  // 数据目录必须先存在且可读：打开数据层会补建目录/库，迁移脚本绝不制造一个「空数据目录」。
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
  let plan;
  try {
    plan = planMigration(db, {
      dataDir,
      memoryFileName: MEMORY_FILE_NAME,
      vocabulary: {
        office: {
          name: OFFICE_CHANNEL_NAME,
          legacyNames: LEGACY_OFFICE_CHANNEL_NAMES,
          description: OFFICE_CHANNEL_DESCRIPTION,
          legacyDescription: LEGACY_OFFICE_CHANNEL_DESCRIPTION,
        },
        secretary: {
          description: SUSAN_DESCRIPTION,
          legacyDescription: LEGACY_SECRETARY_DESCRIPTION,
        },
      },
    });
    if (options.apply) {
      db.withTransaction(() => {
        for (const rename of plan.channels.renamed) db.renameChannel(rename.id, rename.to);
        for (const described of plan.channels.described) {
          db.updateChannelDescription(described.id, described.to);
        }
        for (const described of plan.members.described) {
          db.updateMemberDescription(described.id, described.to);
        }
      });
    }
  } finally {
    db.close();
  }

  const backups = [];
  if (options.apply) {
    for (const update of plan.memoryFiles.updated) {
      update.backup = backupMemoryFile(update.path, update.original);
      if (update.backup) backups.push(update.backup);
      fs.writeFileSync(update.path, update.migrated, "utf8");
    }
  }

  return {
    mode: options.apply ? MODE_APPLY : MODE_DRY_RUN,
    dataDir,
    changes:
      plan.channels.renamed.length +
      plan.channels.described.length +
      plan.members.described.length +
      plan.memoryFiles.updated.length,
    counts: {
      channelsRenamed: plan.channels.renamed.length,
      channelDescriptions: plan.channels.described.length,
      memberDescriptions: plan.members.described.length,
      memoryFiles: plan.memoryFiles.updated.length,
      backups: backups.length,
    },
    channels: plan.channels,
    members: plan.members,
    memoryFiles: plan.memoryFiles,
    backups,
  };
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const report = await migrate(options);
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
      process.stderr.write(`迁移失败：${error?.stack ?? error}\n`);
      process.exitCode = 1;
    }
  }
}
