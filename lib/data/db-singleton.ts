import { openDataDb } from "../data/sqlite.ts";
import type { Store } from "../data/store.ts";
import { SCHEMA_VERSION } from "../data/schema.ts";

declare global {
  var __workspliceDb: Store | undefined;
}

/**
 * 进程级存储单例（契约类型为 `Store`，运行时是 SQLiteAdapter）；globalThis 扛
 * Next.js 热重载（与 lib/rpc 同模式）。openSqliteAdapter 会记录打开时的 schema 版本；
 * 热重载后 SQLiteAdapter 类已变时（版本不同）重建实例，避免拿到旧原型的
 * setMemberPiSessionFile 等新方法缺失报错。
 * 测试直连（globalThis.__workspliceDb = openDataDb(tmp)）同样经过 openSqliteAdapter，
 * 版本戳一致，不会被误重建。
 */
export function getDb(): Store {
  if (
    !globalThis.__workspliceDb ||
    globalThis.__workspliceDbOpenedVersion !== SCHEMA_VERSION
  ) {
    globalThis.__workspliceDb = openDataDb();
  }
  return globalThis.__workspliceDb;
}
