export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  configureHttpDispatcher();

  // agent-loop（§5.4）：崩溃恢复补拉 + wake 驱动 + reminder cron（§5.6 逐分钟轮询）；
  // 秘书首次启动自动创建（spec-bootstrap-agent §6.1，ticket 05）：agent-loop 启动之后执行，
  // 幂等（名字全等 + 软删标记，删除后不重建），defaultModel 未配置跳过；两条启动路径均不阻塞、失败不致命
  const { startAgentLoop } = await import("@/lib/agent-loop/index");
  const { autoCreateSecretary } = await import("@/lib/raft/secretary-auto-create");
  void Promise.resolve()
    .then(() => startAgentLoop())
    .catch((error) => {
      console.error(
        "[worksplice] agent loop startup failed:",
        error instanceof Error ? error.message : String(error),
      );
    })
    .then(() => autoCreateSecretary())
    .catch((error) => {
      console.error(
        "[worksplice] secretary auto-create failed:",
        error instanceof Error ? error.message : String(error),
      );
    });
}
