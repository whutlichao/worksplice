# Pi Session File Format

Location: `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`

```jsonl
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path","parentSession":"/abs/path/to/parent.jsonl"}
{"type":"model_change","id":"<8hex>","parentId":null,"provider":"zenmux","modelId":"claude-sonnet-4-6","timestamp":"..."}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"user","content":"..."}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"assistant","content":[...],...}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"toolResult","toolCallId":"...","content":[...]}}
{"type":"compaction","id":"<8hex>","parentId":"<8hex>","summary":"...","firstKeptEntryId":"<8hex>","tokensBefore":N}
{"type":"context_edit","id":"<8hex>","parentId":"<8hex>","targetId":"<8hex>","replacement":null}
{"type":"usage","id":"<8hex>","parentId":null,"kind":"cache_warm","provider":"...","model":"...","usage":{...},"note":null}
{"type":"session_info","id":"...","parentId":"...","name":"user-defined name"}
```

`context_edit` 的 `replacement: null` 表示**把该 target 从模型上下文里移除**（非空则只替换它的内容）；它是 pi 裁剪/替换上下文的记账，会话记录**刻意不渲染**这一类条目。`usage` 是独立计费条目，不挂在某个 message 上（故 `parentId` 为 `null`），费用在 `session-stats` 侧计入、不计入 token 桶。

`entryIds[]` in `SessionContext` is a parallel array to `messages[]` — maps each displayed message back to its `.jsonl` entry id, used for fork and navigate_tree calls.
