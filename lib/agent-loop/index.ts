/**
 * agent-loop 公共 API 面（Ticket 02 窄化）：只 re-export AgentLoop 公共接口。
 * 内部编排（round / driver / backfill / reminder-cron / wake 订阅）全部收在 loop.ts 单文件；
 * wake 发布/订阅原语已下沉 lib/domain/raft/wake.ts（raft 服务层发、本模块订阅）。
 * 内部函数的测试面直接从 ./loop.ts 导入（不经过本公共面）。
 */
export { createAgentLoop, type AgentLoop } from "./loop.ts";
