import { openDataDb, type RaftStore } from "../data/db.ts";
import { SCHEMA_VERSION } from "../data/schema.ts";

declare global {
  var __workspliceDb: RaftStore | undefined;
}

/**
 * 进程级 raft.db 单例；globalThis 扛 Next.js 热重载（与 lib/rpc 同模式）。
 * openDataDb 会记录打开时的 schema 版本；热重载后 db.ts 的类已变时（版本不同）
 * 重建实例，避免拿到旧原型的 setMemberPiSessionFile 等新方法缺失报错。
 * 测试直连（globalThis.__workspliceDb = openDataDb(tmp)）同样经过 openDataDb，
 * 版本戳一致，不会被误重建。
 */
export function getDb(): RaftStore {
  if (
    !globalThis.__workspliceDb ||
    globalThis.__workspliceDbOpenedVersion !== SCHEMA_VERSION
  ) {
    globalThis.__workspliceDb = openDataDb();
  }
  return globalThis.__workspliceDb;
}
