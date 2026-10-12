/**
 * session 归档副本与检索索引（上下文治理票 06；spec.md B1/B2/B3/B6）。
 *
 * 重置路径的归档副作用：会话重置（Session Reset / Full Reset）执行既有删除逻辑之前，
 * 先把该 agent 的原始会话记录（session 原文，含 compact summary）以**逐字节副本**落入
 * 数据目录（`session-archives/<agent id>/<内容哈希>.jsonl`，D1 的 A+C 分层：文件侧持久，
 * SQLite 侧只建索引），并进可检索索引。本模块只负责「复制 + 索引」侧；调用方（
 * `lib/agent-lifecycle.ts`）负责判定哪些文件可确认归属该 agent。
 *
 * 不变量：
 * - 只复制、不删除、不改写原始记录（副本与原文逐字节一致）；
 * - 内容寻址命名（sha256）⇒ 同一内容重复重置不产生重复副本；
 * - 无文件可归档时静默跳过，不造空档、不报错；
 * - 归档只发生在重置路径；只有显式永久删除 agent 会清除其私有归档（deleteAgentSessionArchives）。
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "./data/db-singleton.ts";
import type { SessionArchiveEntryInput, SessionArchiveSearchHit } from "./data/types.ts";

/**
 * 归档该 agent 的一批 session 文件（调用方已按归属判定筛过：绑定文件 + 家目录 cwd 下的
 * session 文件）。逐文件内容寻址：副本名 = 源文件内容的 sha256，重复重置命中同一副本、
 * 不产生重复落盘；索引按「先清旧行再写当前投影」收敛（重复重置/提取规则升级都幂等）。
 * 只读源文件（副本失败不删原文），源文件已消失/为空则跳过。
 */
export function archiveAgentSessionFiles(agentId: string, sourcePaths: string[]): void {
  const seen = new Set<string>();
  for (const sourcePath of sourcePaths) {
    if (!sourcePath || seen.has(sourcePath)) continue;
    seen.add(sourcePath);
    archiveOneSessionFile(agentId, sourcePath);
  }
}

/** 单文件归档：内容哈希 → 数据目录内落副本（已存在则跳过复制）→ 收敛检索索引。 */
function archiveOneSessionFile(agentId: string, sourcePath: string): void {
  if (!existsSync(sourcePath)) return;
  const buffer = readFileSync(sourcePath);
  if (buffer.length === 0) return;
  const db = getDb();
  const hash = createHash("sha256").update(buffer).digest("hex");
  const archiveId = `${agentId}/${hash}`;
  const archiveDir = join(db.paths.sessionArchivesDir, agentId);
  const archivePath = join(archiveDir, `${hash}.jsonl`);
  if (!existsSync(archivePath)) {
    mkdirSync(archiveDir, { recursive: true });
    // 写入的是刚读到的同一份 buffer：副本与读取时刻的原文逐字节一致；
    // "wx" = 独占创建，并发重复归档时后到者命中已存在文件、静默跳过。
    try {
      writeFileSync(archivePath, buffer, { flag: "wx" });
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
  }
  db.replaceSessionArchiveEntries(
    archiveId,
    extractSessionArchiveEntries(buffer, { archiveId, agentId, sourcePath }),
  );
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "EEXIST"
  );
}

/**
 * 清除该 agent 的私有归档副本与检索索引（票 09 B7：显式永久删除 agent 时调用）。
 * 目录布局与索引联动是本模块私有知识：先删索引行、再删副本目录——
 * 索引先删 ⇒ 即使目录删除中途失败，也不会留下「检索可见但副本已删」的悬空命中
 * （副本若残留只是占盘，不构成检索可见）。
 * 只作用于 `deleteAgentIdentity`；Session Reset / Full Reset **不得**调用它
 * （B6：重置保留原始记录，归档只增不删）。
 */
export function deleteAgentSessionArchives(agentId: string): void {
  if (!agentId) return;
  const db = getDb();
  db.deleteSessionArchiveEntriesForAgent(agentId);
  rmSync(join(db.paths.sessionArchivesDir, agentId), { recursive: true, force: true });
}

/**
 * 逐行解析归档副本，产出带定位的索引行（spec B2/B3 的索引投影）：
 * - 坏行/半行跳过（与 session-stats 的容错一致）——副本原文不受影响，仍是逐字节原文；
 * - 无可检索文本的条目（session 头行、usage 等）不进索引，不造空行；
 * - entryIndex = 源文件内的 1 基行号，命中可定位到具体条目。
 */
function extractSessionArchiveEntries(
  buffer: Buffer,
  locator: { archiveId: string; agentId: string; sourcePath: string },
): SessionArchiveEntryInput[] {
  const entries: SessionArchiveEntryInput[] = [];
  const lines = buffer.toString("utf8").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    const content = entrySearchText(parsed);
    if (!content.trim()) continue;
    entries.push({
      ...locator,
      entryIndex: index + 1,
      entryType: typeof parsed.type === "string" ? parsed.type : "",
      content,
    });
  }
  return entries;
}

/**
 * 条目的文本投影：message 取消息正文（字符串原样；块数组取文本/思考/工具调用参数，
 * bashExecution 取 command + output），compaction / branch_summary 取 summary
 * （compact summary 因此与正文同索引），custom_message 取其 content；
 * 其余类型无非结构化文本、不进索引。工具结果的 details 是工具私有结构，不投影。
 */
function entrySearchText(entry: Record<string, unknown>): string {
  switch (entry.type) {
    case "message": {
      const message = isRecord(entry.message) ? entry.message : {};
      if (message.role === "bashExecution") {
        const command = typeof message.command === "string" ? message.command : "";
        const output = typeof message.output === "string" ? message.output : "";
        return [command, output].filter(Boolean).join("\n");
      }
      return contentSearchText(message.content);
    }
    case "compaction":
    case "branch_summary":
      return typeof entry.summary === "string" ? entry.summary : "";
    case "custom_message":
      return contentSearchText(entry.content);
    default:
      return "";
  }
}

/** content 字段（string | 内容块数组）的文本投影。 */
function contentSearchText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    } else if (block.type === "thinking" && typeof block.thinking === "string") {
      parts.push(block.thinking);
    } else if (block.type === "toolCall") {
      const name =
        typeof block.name === "string"
          ? block.name
          : typeof block.toolName === "string"
            ? block.toolName
            : "";
      const args = block.arguments ?? block.input;
      const argsText = typeof args === "string" ? args : JSON.stringify(args) ?? "";
      const combined = [name, argsText].filter((part) => part && part !== "undefined").join(" ");
      if (combined) parts.push(combined);
    }
  }
  return parts.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 归档检索的服务层上限/默认条数（与既有检索面同量级；预算常量留票 05/07 按基线调）。 */
export const MAX_ARCHIVE_SEARCH_LIMIT = 50;
const DEFAULT_ARCHIVE_SEARCH_LIMIT = 20;

/**
 * 归档检索的服务层入口（B2/B3 的「索引存在且可查」层）：检索归档会话原文与其 compact
 * summary 文本，命中带定位列（agent/归档/源文件/条目行号），可定位到具体归档会话。
 * 消费面接线（成员面 `search` op / 人类搜索 UI）是票 07 的范围，本票不接线。
 */
export function searchArchivedSessionEntries(
  query: string,
  opts: { limit?: number } = {},
): SessionArchiveSearchHit[] {
  const raw = opts.limit ?? DEFAULT_ARCHIVE_SEARCH_LIMIT;
  const limit = Number.isFinite(raw)
    ? Math.min(Math.max(1, Math.floor(raw)), MAX_ARCHIVE_SEARCH_LIMIT)
    : DEFAULT_ARCHIVE_SEARCH_LIMIT;
  return getDb().searchSessionArchives(query, limit);
}
