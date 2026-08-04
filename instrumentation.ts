export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  configureHttpDispatcher();

  // agent-loop（§5.4）：崩溃恢复补拉 + wake 驱动；启动路径不阻塞，失败不致命
  const { startAgentLoop } = await import("@/lib/agent-loop/index");
  void Promise.resolve()
    .then(() => startAgentLoop())
    .catch((error) => {
      console.error(
        "[worksplice] agent loop startup failed:",
        error instanceof Error ? error.message : String(error),
      );
    });
}
