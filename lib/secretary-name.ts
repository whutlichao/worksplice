/**
 * 引导期默认秘书名字的**唯一字面来源**（评审 finding：曾有三份 `"Susan"`）。
 *
 * 名字**不参与任何身份判定**——秘书 = 全局首席（`lib/domain/collab/secretary-identity.ts`，
 * 票 #248）。它只剩三处「必须字面一致」的用途：
 * ① v19 迁移把现存存活的同名身份标为全局首席（`lib/data/schema.ts` 的
 * `LEGACY_CHIEF_MEMBER_NAME`）；② 升级前的存量身份接续（`SUSAN_MEMBER_NAME`）；
 * ③ UI 侧「启动助手」入口的存活判定与新建身份时的默认名（`lib/secretary-bootstrap.ts`）。
 *
 * **零依赖、client-safe**：这三个位置各自保留既有导出名（大量测试与调用点不变），只在
 * 本模块改一次字面值。UI 组件会经 `lib/secretary-bootstrap.ts` 导入本模块，所以这里
 * 不许出现任何 import——尤其是会把 better-sqlite3 拖进浏览器包的服务端模块。
 */
export const SECRETARY_DEFAULT_NAME = "Susan";
