// lib/rpc — RPC 会话管理公共出口（原 lib/rpc-manager.ts 拆分的四个窄模块）。
//
// 公共 API 面与原 rpc-manager.ts 完全一致：
//   AgentSessionWrapper / AgentEvent / RpcSessionStartOptions（session.ts）
//   getRpcSession / hasBusyRpcSessionForCwd / findBusyRpcSessionForCwd
//     / destroyRpcSessionsForCwd（registry.ts）
//   startRpcSession（caller.ts）
//   subscribeRunningSessions（subscriber.ts）
//   notifyRunningChange / getRunningRpcSessionIds（broadcaster.ts）
// 既有调用方只需把 import 路径从 "@/lib/rpc-manager" 改为 "@/lib/rpc"。

export {
  AgentSessionWrapper,
} from "./session.ts";
export type {
  AgentEvent,
  RpcSessionStartOptions,
} from "./session.ts";
export {
  RpcRegistry,
  getRpcSession,
  hasBusyRpcSessionForCwd,
  findBusyRpcSessionForCwd,
  destroyRpcSessionsForCwd,
} from "./registry.ts";
export {
  RpcCaller,
  startRpcSession,
} from "./caller.ts";
export {
  RpcSubscriber,
  subscribeRunningSessions,
} from "./subscriber.ts";
export {
  RpcBroadcaster,
  notifyRunningChange,
  getRunningRpcSessionIds,
} from "./broadcaster.ts";
