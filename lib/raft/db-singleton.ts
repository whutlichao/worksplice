import { openDataDb, type RaftStore } from "../data/db.ts";

declare global {
  var __workspliceDb: RaftStore | undefined;
}

/** 进程级 raft.db 单例；globalThis 扛 Next.js 热重载（与 rpc-manager 同模式）。 */
export function getDb(): RaftStore {
  if (!globalThis.__workspliceDb) {
    globalThis.__workspliceDb = openDataDb();
  }
  return globalThis.__workspliceDb;
}
