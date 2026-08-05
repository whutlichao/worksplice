# 04 — 线程迁入右栏

**What to build:** 线程从 channel 内部侧栏迁入右栏容器的 thread 变体：锚点 + 消息列表 + composer（freshness baseSeq 按线程末条 seq）+ 分页 + 面板局部引用态 + 自带 3s 轮询（后台 tab 暂停、卸载清理）；"在线程中回复"与任务卡片入口改路由到右栏；channel 内线程侧栏状态与渲染删除。

**Blocked by:** 03 — 右栏容器 + 人类资料卡

**Status:** ready-for-agent

- [ ] 消息"在线程中回复" → 线程在右栏打开，中央频道不动
- [ ] 任务卡片点击 → 任务线程在右栏打开
- [ ] agent 在任务线程的回复经面板轮询自动出现（≤3s，后台 tab 暂停、卸载清理）
- [ ] 右栏线程内发消息：freshness 按线程 seq 空间，held 时提示 + 重拉线程
- [ ] 线程打开期间中央频道轮询持续运行，两者并存
- [ ] 切 channel → 面板清空（线程状态随容器销毁）
- [ ] 线程轮询 setInterval 源码断言测试 + tsc + eslint + node --test 通过
