import {
  SessionManager,
  buildContextEntries as piBuildContextEntries,
  buildSessionContext as piBuildSessionContext,
  getAgentDir,
  parseSessionEntries,
} from "@earendil-works/pi-coding-agent";
import { constants as fsConstants, closeSync, fstatSync, lstatSync, openSync, readFileSync, readSync } from "fs";
import { isAbsolute, normalize as normalizePath } from "path";
import type { AgentMessage, SessionEntry, SessionHeader, SessionInfo, SessionContext, SessionTranscriptBranch } from "./types";
import type { SessionEntry as PiSessionEntry, SessionInfo as PiSessionInfo } from "@earendil-works/pi-coding-agent";
import { normalizeToolCalls } from "./normalize";
import { sessionPathKey } from "./session-path";
import { resolveProject, type ProjectInfo } from "./worktree";

export { getAgentDir };

async function loadAllSessions(): Promise<SessionInfo[]> {
  const piSessions: PiSessionInfo[] = await SessionManager.listAll();
  const pathToId = new Map<string, string>();
  for (const s of piSessions) pathToId.set(sessionPathKey(s.path), s.id);

  // Resolve each unique cwd to its project root (main repo shared by all
  // worktrees). resolveProject caches per-cwd, so this is cheap after warmup.
  const uniqueCwds = [...new Set(piSessions.map((s) => s.cwd).filter(Boolean))];
  const projectByCwd = new Map<string, ProjectInfo>();
  await Promise.all(uniqueCwds.map(async (cwd) => {
    projectByCwd.set(cwd, await resolveProject(cwd));
  }));

  return piSessions.map((s) => {
    cacheSessionPath(s.id, s.path);
    const project = s.cwd ? projectByCwd.get(s.cwd) : undefined;
    return {
      path: s.path,
      id: s.id,
      cwd: s.cwd,
      name: s.name,
      created: s.created instanceof Date ? s.created.toISOString() : String(s.created),
      modified: s.modified instanceof Date ? s.modified.toISOString() : String(s.modified),
      messageCount: s.messageCount,
      firstMessage: s.firstMessage || "(no messages)",
      parentSessionId: s.parentSessionPath ? pathToId.get(sessionPathKey(s.parentSessionPath)) : undefined,
      projectRoot: project?.projectRoot ?? s.cwd,
      ...(project?.isWorktree && project.branch ? { worktreeBranch: project.branch } : {}),
    };
  });
}

export async function listAllSessions(): Promise<SessionInfo[]> {
  const generation = globalThis.__workspliceSessionListGeneration ?? 0;

  // Return cached result if still fresh (avoids re-scanning session files
  // and re-spawning git processes on every page load).
  if (globalThis.__workspliceSessionListCache && Date.now() - globalThis.__workspliceSessionListCache.ts < SESSION_LIST_CACHE_TTL_MS) {
    return globalThis.__workspliceSessionListCache.data;
  }

  // Coalescing dedup: concurrent callers share the same in-flight promise
  // only while it belongs to the current cache generation.
  if (globalThis.__workspliceSessionListPromise && globalThis.__workspliceSessionListPromiseGeneration === generation) {
    return globalThis.__workspliceSessionListPromise;
  }

  const loadPromise = loadAllSessions().then((data) => {
    // An invalidation may happen while the scan is in flight. Do not let that
    // older result repopulate the cache after a session mutation.
    if ((globalThis.__workspliceSessionListGeneration ?? 0) === generation) {
      globalThis.__workspliceSessionListCache = { data, ts: Date.now() };
    }
    return data;
  });
  const trackedPromise = loadPromise.finally(() => {
    if (globalThis.__workspliceSessionListPromise === trackedPromise) {
      globalThis.__workspliceSessionListPromise = undefined;
      globalThis.__workspliceSessionListPromiseGeneration = undefined;
    }
  });

  globalThis.__workspliceSessionListPromise = trackedPromise;
  globalThis.__workspliceSessionListPromiseGeneration = generation;
  return trackedPromise;
}

// ============================================================================
// Session path caches, stored in globalThis for hot-reload safety.
// ============================================================================
declare global {
  var __workspliceSessionPathCache: Map<string, string> | undefined;
  var __worksplicePathToSessionIdCache: Map<string, string> | undefined;
  var __workspliceSessionListPromise: Promise<SessionInfo[]> | undefined;
  var __workspliceSessionListPromiseGeneration: number | undefined;
  var __workspliceSessionListGeneration: number | undefined;
  var __workspliceSessionListCache: { data: SessionInfo[]; ts: number } | undefined;
}

const SESSION_LIST_CACHE_TTL_MS = 30_000;

export function invalidateSessionListCache(): void {
  globalThis.__workspliceSessionListGeneration = (globalThis.__workspliceSessionListGeneration ?? 0) + 1;
  globalThis.__workspliceSessionListCache = undefined;
}

function getPathCache(): Map<string, string> {
  if (!globalThis.__workspliceSessionPathCache) globalThis.__workspliceSessionPathCache = new Map();
  return globalThis.__workspliceSessionPathCache;
}

function getPathToIdCache(): Map<string, string> {
  if (!globalThis.__worksplicePathToSessionIdCache) globalThis.__worksplicePathToSessionIdCache = new Map();
  return globalThis.__worksplicePathToSessionIdCache;
}

export async function resolveSessionPath(sessionId: string): Promise<string | null> {
  const cached = getPathCache().get(sessionId);
  if (cached) return cached;

  // Cache miss: scan all sessions to populate cache, then retry
  await listAllSessions();
  return getPathCache().get(sessionId) ?? null;
}

export async function resolveSessionIdByPath(filePath: string): Promise<string | undefined> {
  const pathKey = sessionPathKey(filePath);
  const cached = getPathToIdCache().get(pathKey);
  if (cached) return cached;

  await listAllSessions();
  return getPathToIdCache().get(pathKey);
}

export function cacheSessionPath(sessionId: string, filePath: string): void {
  const normalizedPath = normalizePath(filePath);
  const pathKey = sessionPathKey(normalizedPath);
  const pathCache = getPathCache();
  const reverseCache = getPathToIdCache();
  const previousPath = pathCache.get(sessionId);
  const previousPathKey = previousPath ? sessionPathKey(previousPath) : undefined;
  const previousSessionId = reverseCache.get(pathKey);
  const previousOwnerPath = previousSessionId ? pathCache.get(previousSessionId) : undefined;
  if (previousPathKey && previousPathKey !== pathKey && reverseCache.get(previousPathKey) === sessionId) {
    reverseCache.delete(previousPathKey);
  }
  if (
    previousSessionId &&
    previousSessionId !== sessionId &&
    previousOwnerPath &&
    sessionPathKey(previousOwnerPath) === pathKey
  ) {
    pathCache.delete(previousSessionId);
  }
  pathCache.set(sessionId, normalizedPath);
  reverseCache.set(pathKey, sessionId);
}

export function invalidateSessionPathCache(sessionId: string): void {
  const pathCache = getPathCache();
  const reverseCache = getPathToIdCache();
  const filePath = pathCache.get(sessionId);
  pathCache.delete(sessionId);
  const pathKey = filePath ? sessionPathKey(filePath) : undefined;
  if (pathKey && reverseCache.get(pathKey) === sessionId) {
    reverseCache.delete(pathKey);
  }
}

export function readSessionHeader(filePath: string): SessionHeader | null {
  const fd = openSync(filePath, "r");
  try {
    const chunks: Buffer[] = [];
    const maxHeaderBytes = 64 * 1024;
    let position = 0;
    let foundNewline = false;

    while (position < maxHeaderBytes && !foundNewline) {
      const buffer = Buffer.allocUnsafe(Math.min(4096, maxHeaderBytes - position));
      const bytesRead = readSync(fd, buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      const data = buffer.subarray(0, bytesRead);
      const newlineIndex = data.indexOf(0x0a);
      chunks.push(newlineIndex === -1 ? data : data.subarray(0, newlineIndex));
      position += bytesRead;
      foundNewline = newlineIndex !== -1;
    }

    if (!foundNewline && position >= maxHeaderBytes) return null;
    const firstLine = Buffer.concat(chunks).toString("utf8").trimEnd();
    if (!firstLine) return null;
    try {
      const header = JSON.parse(firstLine) as SessionHeader;
      return header.type === "session" ? header : null;
    } catch {
      return null;
    }
  } finally {
    closeSync(fd);
  }
}

export function getSessionEntries(filePath: string): SessionEntry[] {
  const entries = SessionManager.open(filePath).getEntries();
  return entries as unknown as SessionEntry[];
}

/**
 * 只读已登记的 session 文件，不打开持久化 SessionManager。
 * 读取前后校验文件描述符与路径，若文件被替换或变为符号链接则拒绝；SDK 仅在内存中遍历当前分支。
 */
export function readSessionTranscriptBranch(filePath: string): SessionTranscriptBranch | null {
  const normalizedPath = normalizePath(filePath);
  if (!isAbsolute(normalizedPath)) throw new Error("Session path must be absolute");

  let descriptor: number;
  let initialStat: ReturnType<typeof lstatSync>;
  try {
    initialStat = lstatSync(normalizedPath);
    if (!initialStat.isFile() || initialStat.isSymbolicLink()) {
      throw new Error("Session path is not a regular file");
    }
    descriptor = openSync(
      normalizedPath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }

  let contents: string;
  try {
    const openedStat = fstatSync(descriptor);
    if (!openedStat.isFile() || !sameFileIdentity(initialStat, openedStat)) {
      throw new Error("Session file changed while opening");
    }
    contents = readFileSync(descriptor, "utf8");
    const finalStat = lstatSync(normalizedPath);
    if (
      finalStat.isSymbolicLink() ||
      !finalStat.isFile() ||
      !sameFileIdentity(openedStat, finalStat)
    ) {
      throw new Error("Session file changed while reading");
    }
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  } finally {
    closeSync(descriptor);
  }

  const entries = parseSessionEntries(contents);
  const lineCount = contents.split(/\r?\n/).filter((line) => line.trim() !== "").length;
  if (entries.length !== lineCount) {
    throw new Error("Session file contains invalid entries");
  }

  if (entries.length === 0) return null;
  const header = entries[0];
  if (!header || header.type !== "session") {
    throw new Error("Session file header is invalid");
  }

  const manager = SessionManager.inMemory(header.cwd, undefined, entries);
  const branch = manager.getBranch() as unknown as SessionEntry[];
  return {
    sessionId: manager.getSessionId(),
    messages: branch.flatMap((entry) => {
      const message = entryToUiMessage(entry, {});
      return message ? [{ entryId: entry.id, message }] : [];
    }),
  };
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function sameFileIdentity(
  first: { dev: number; ino: number },
  second: { dev: number; ino: number },
): boolean {
  return first.dev === second.dev && first.ino === second.ino;
}

export function buildSessionContext(
  entries: SessionEntry[],
  leafId?: string | null,
  options: { deferThinking?: boolean; deferToolResultImages?: boolean } = {},
): SessionContext {
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) byId.set(e.id, e);

  const piEntries = entries as unknown as PiSessionEntry[];
  const piCtx = piBuildSessionContext(piEntries, leafId, byId as unknown as Map<string, PiSessionEntry>);

  const contextEntries = piBuildContextEntries(
    piEntries,
    leafId,
    byId as unknown as Map<string, PiSessionEntry>,
  );

  // Convert the SDK-selected context entries and their IDs together. This keeps
  // fork/navigation targets aligned while preserving pi's compaction ordering.
  const messages: AgentMessage[] = [];
  const entryIds: string[] = [];
  for (const entry of contextEntries) {
    const localEntry = entry as unknown as SessionEntry;
    const m = entryToUiMessage(localEntry, options);
    if (m) {
      messages.push(m);
      entryIds.push(localEntry.id);
    }
  }

  return {
    messages,
    entryIds,
    thinkingLevel: piCtx.thinkingLevel,
    model: piCtx.model,
  };
}

function parseEntryTimestamp(timestamp: string): number | undefined {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base64ImageInfo(block: unknown): { bytes: number; mime?: string } | null {
  if (!isRecord(block) || block.type !== "image") return null;

  let data: string | undefined;
  let mime: string | undefined;
  if (typeof block.data === "string") {
    data = block.data;
    mime = typeof block.mimeType === "string" ? block.mimeType : undefined;
  } else if (isRecord(block.source) && block.source.type === "base64" && typeof block.source.data === "string") {
    data = block.source.data;
    mime = typeof block.source.media_type === "string" ? block.source.media_type : undefined;
  }
  if (!data) return null;

  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return { bytes: Math.max(0, Math.floor(data.length * 3 / 4) - padding), mime };
}

function omitToolResultBase64Images(message: AgentMessage): AgentMessage {
  if (message.role !== "toolResult") return message;

  let omitted = 0;
  let bytes = 0;
  const mimes = new Set<string>();
  const content = message.content.filter((block) => {
    const image = base64ImageInfo(block);
    if (!image) return true;
    omitted += 1;
    bytes += image.bytes;
    if (image.mime) mimes.add(image.mime);
    return false;
  });
  if (omitted === 0) return message;

  const mimeText = mimes.size > 0 ? `: ${[...mimes].join(", ")}` : "";
  content.push({
    type: "text",
    text: `[${omitted} tool result image${omitted === 1 ? "" : "s"} omitted from initial history payload${mimeText}, ~${bytes} bytes]`,
  });
  return { ...message, content };
}

// Convert a session entry on the active branch into a UI message.
// Returns null for entries that do not map to chat history (metadata, non-message types).
function entryToUiMessage(
  entry: SessionEntry,
  options: { deferThinking?: boolean; deferToolResultImages?: boolean },
): AgentMessage | null {
  // Supported message roles: user, assistant, toolResult, bashExecution.
  // bashExecution messages enter the case "message" branch (entry.type === "message").
  // The early return at line below ("!options.deferThinking || message.role !== "assistant"")
  // passes non-assistant messages — including bashExecution — through unchanged.
  // normalizeToolCalls is a secondary guard (returns non-assistant messages as-is).
  switch (entry.type) {
    case "message": {
      const message = options.deferToolResultImages
        ? omitToolResultBase64Images(normalizeToolCalls(entry.message))
        : normalizeToolCalls(entry.message);
      if (!options.deferThinking || message.role !== "assistant") return message;
      return {
        ...message,
        content: message.content.map((block) => (
          block.type === "thinking" && block.thinking.trim() !== ""
            ? { ...block, thinking: "", deferred: true }
            : block
        )),
      };
    }
    case "compaction":
      return {
        role: "custom",
        customType: "compaction",
        content: entry.summary,
        display: true,
        details: {
          tokensBefore: entry.tokensBefore,
          firstKeptEntryId: entry.firstKeptEntryId,
        },
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    case "branch_summary":
      if (!entry.summary) return null;
      return {
        role: "user",
        content: `*The conversation briefly explored another branch and returned with this summary:*\n\n${entry.summary}`,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    case "custom_message":
      return {
        role: "custom",
        customType: entry.customType,
        content: entry.content,
        display: entry.display,
        details: entry.details,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    // Bookkeeping for how pi trims/replaces model context, not something either party
    // said. Deliberately not rendered: the transcript stays a record of the conversation.
    case "context_edit":
      return null;
    // Pure billing accounting; the cost dashboard reads it from session-stats, not here.
    case "usage":
      return null;
    default:
      return null;
  }
}
