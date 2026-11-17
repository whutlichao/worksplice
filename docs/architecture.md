# Architecture

> 从根目录 `AGENTS.md` 搬出的系统架构与关键数据流。文件级索引见 `docs/file-map.md`，改动前约束见 `docs/traps.md`。

## 核心链路

```
Browser                Next.js Server              AgentSession (in-process)
  │                        │                               │
  ├─ GET /api/sessions ────▶ reads ~/.pi/agent/sessions/   │
  ├─ GET /api/sessions/[id] reads .jsonl file directly     │
  ├─ GET /api/agent/running ───────▶ running id snapshot   │
  │                        │                               │
  ├─ send message ─────────▶ POST /api/agent/[id]          │
  │                        │   startRpcSession() ─────────▶│ createAgentSession()
  │                        │   session.send(cmd) ─────────▶│ session.prompt()
  │                        │                               │
  ├─ SSE connect ──────────▶ GET /api/agent/[id]/events    │
  │                        │   session.onEvent() ◀─────────│ session.subscribe()
  │◀── data: {...} ─────────│                               │
```

- **Session browsing**（只读）：reads `.jsonl` files through SDK `SessionManager` helpers and `lib/session-reader.ts` — no AgentSession created。
- **Sending a message**：`startRpcSession()` in `lib/rpc/` creates an AgentSession in-process。
- **协作写入链路**：`app/api/*/route.ts`（薄封装）→ `lib/domain/collab/*`（唯一事实来源）→ `getDb(): Store` → `SQLiteAdapter`。

## 深入阅读

- 路由与模块职责：`docs/file-map.md`
- 协作域、agent-loop、房间预算等设计约束：`docs/traps.md`
