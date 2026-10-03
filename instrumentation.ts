export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  configureHttpDispatcher();

  // 演示模式（`worksplice --demo`）：只让人看一遍协作现场，不启动 agent-loop、
  // 也不自动创建秘书——否则会在访客自己的机器上真的跑起 agent（改掉演示现场，
  // 还烧掉他的 token）。演示库里的消息都是 wake:false 写进去的，本来就不会唤醒谁。
  if (process.env.WORKSPLICE_DEMO === "1") return;

  // agent-loop（§5.4）：崩溃恢复补拉 + wake 驱动 + reminder cron（§5.6 逐分钟轮询）；
  // 秘书首次启动自动创建（spec-bootstrap-agent §6.1，ticket 05）：agent-loop 启动之后执行，
  // 幂等（名字全等 + 软删标记，删除后不重建），defaultModel 未配置跳过；两条启动路径均不阻塞、失败不致命
  const { createAgentLoop } = await import("@/lib/agent-loop/index");
  const { autoCreateSecretary } = await import("@/lib/domain/raft");
  void Promise.resolve()
    .then(() => createAgentLoop().start())
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
