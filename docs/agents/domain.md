# 领域文档

这些工程 skill 在探索代码库时，应如何消费本仓库的领域文档。

## 探索前先阅读

- 仓库根目录下的 **`CONTEXT.md`**，或
- 若存在 **`CONTEXT-MAP.md`** 则以它为准——它指向每个上下文对应的 `CONTEXT.md`。阅读所有与你主题相关的文件
- **`docs/adr/`** — 阅读与你即将工作的区域相关的 ADR。在多上下文仓库中，还需检查 `src/<context>/docs/adr/` 中上下文级别的决策

如果这些文件不存在，**静默继续**。不要指出它们的缺失，也不要主动建议创建它们。`/domain-modeling` skill（通过 `/grill-with-docs` 和 `/improve-codebase-architecture` 触达）会在术语或决策实际确定时惰性创建它们。

## 文件结构

单上下文仓库（大多数仓库）：

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

多上下文仓库（根目录存在 `CONTEXT-MAP.md` 时）：

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← 系统级决策
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← 上下文特定决策
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## 使用术语表词汇

当你的输出命名某个领域概念时（如 issue 标题、重构提案、假设、测试名称），使用 `CONTEXT.md` 中定义的术语。不要偏离到术语表明确回避的同义词。

如果你需要的概念还不在术语表中，这是一个信号——要么你在发明项目未使用的语言（重新考虑），要么存在真实缺口（记录下来供 `/domain-modeling` 处理）。

## 标记 ADR 冲突

如果你的输出与现有 ADR 矛盾，显式指出而不是静默覆盖：

> _与 ADR-0007（event-sourced orders）矛盾——但值得重新讨论，因为…_
