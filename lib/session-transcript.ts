import { randomUUID } from 'node:crypto';
import { isAbsolute, normalize as normalizePath } from 'node:path';
import { getAgent } from '@/lib/domain/collab';
import { readSessionTranscriptBranch } from './session-reader';
import { sessionPathKey } from './session-path';
import type { AgentTranscriptPage, SessionTranscriptItem } from './types';

const PAGE_SIZE = 100;
const SNAPSHOT_IDLE_TTL_MS = 10 * 60_000;

interface TranscriptSnapshot {
  memberId: string;
  filePathKey: string;
  createdAt: number;
  /** Optional only for hot-reloaded snapshots created before this lease field existed. */
  lastAccessedAt?: number;
  sessionId: string;
  messages: SessionTranscriptItem[];
}

interface TranscriptCursor {
  snapshotId: string;
  memberId: string;
  endIndex: number;
}

interface TranscriptRegistry {
  snapshots: Map<string, TranscriptSnapshot>;
  cursors: Map<string, TranscriptCursor>;
}

declare global {
  var __workspliceTranscriptRegistry: TranscriptRegistry | undefined;
}

export class TranscriptCursorError extends Error {
  constructor() {
    super('Transcript snapshot expired; refresh to load the current session');
    this.name = 'TranscriptCursorError';
  }
}

/** 只读成员当前精确登记的 session；游标绑定该成员与该文件。 */
export function getAgentTranscriptPage(memberId: string, cursor?: string | null): AgentTranscriptPage {
  const agent = getAgent(memberId);
  const registry = getTranscriptRegistry();
  pruneSnapshots(registry);

  if (cursor) {
    const pageCursor = registry.cursors.get(cursor);
    const snapshot = pageCursor
      ? registry.snapshots.get(pageCursor.snapshotId)
      : undefined;
    const currentPath = agent.pi_session_file
      ? normalizedSessionPath(agent.pi_session_file).key
      : null;
    if (
      !pageCursor ||
      !snapshot ||
      pageCursor.memberId !== memberId ||
      snapshot.memberId !== memberId ||
      currentPath !== snapshot.filePathKey
    ) {
      throw new TranscriptCursorError();
    }
    snapshot.lastAccessedAt = Date.now();
    return pageFromSnapshot(registry, pageCursor.snapshotId, snapshot, pageCursor.endIndex);
  }

  if (!agent.pi_session_file) return emptyTranscriptPage();
  const registeredPath = normalizedSessionPath(agent.pi_session_file);
  const branch = readSessionTranscriptBranch(registeredPath.path);
  if (!branch || branch.messages.length === 0) return emptyTranscriptPage();

  const snapshotId = randomUUID();
  const now = Date.now();
  const snapshot: TranscriptSnapshot = {
    memberId,
    filePathKey: registeredPath.key,
    createdAt: now,
    lastAccessedAt: now,
    sessionId: branch.sessionId,
    messages: branch.messages,
  };
  registry.snapshots.set(snapshotId, snapshot);
  return pageFromSnapshot(registry, snapshotId, snapshot, branch.messages.length);
}

function normalizedSessionPath(filePath: string): { path: string; key: string } {
  const normalized = normalizePath(filePath);
  if (!isAbsolute(normalized)) throw new Error('Registered session path must be absolute');
  return { path: normalized, key: sessionPathKey(normalized) };
}

function emptyTranscriptPage(): AgentTranscriptPage {
  return { status: 'empty', sessionId: null, messages: [], hasMore: false, cursor: null };
}

function pageFromSnapshot(
  registry: TranscriptRegistry,
  snapshotId: string,
  snapshot: TranscriptSnapshot,
  endIndex: number,
): AgentTranscriptPage {
  const startIndex = Math.max(0, endIndex - PAGE_SIZE);
  const hasMore = startIndex > 0;
  const cursor = hasMore ? randomUUID() : null;
  if (cursor) {
    registry.cursors.set(cursor, {
      snapshotId,
      memberId: snapshot.memberId,
      endIndex: startIndex,
    });
  }
  return {
    status: 'ready',
    sessionId: snapshot.sessionId,
    messages: snapshot.messages.slice(startIndex, endIndex),
    hasMore,
    cursor,
  };
}

function getTranscriptRegistry(): TranscriptRegistry {
  if (!globalThis.__workspliceTranscriptRegistry) {
    globalThis.__workspliceTranscriptRegistry = {
      snapshots: new Map(),
      cursors: new Map(),
    };
  }
  return globalThis.__workspliceTranscriptRegistry;
}

function pruneSnapshots(registry: TranscriptRegistry): void {
  const cutoff = Date.now() - SNAPSHOT_IDLE_TTL_MS;
  for (const [id, snapshot] of registry.snapshots) {
    if ((snapshot.lastAccessedAt ?? snapshot.createdAt) < cutoff) removeSnapshot(registry, id);
  }
}

function removeSnapshot(registry: TranscriptRegistry, snapshotId: string): void {
  registry.snapshots.delete(snapshotId);
  for (const [cursor, value] of registry.cursors) {
    if (value.snapshotId === snapshotId) registry.cursors.delete(cursor);
  }
}
