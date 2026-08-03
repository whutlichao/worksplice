import {
  getAgentStatusSnapshot,
  startAgentStatusSweeper,
  subscribeAgentStatuses,
} from "@/lib/agent-status";

export const dynamic = "force-dynamic";

// GET /api/members/events — agent 状态点（§3.6 四态）实时流。
// 推送整张 { memberId: status } 快照；成员状态变化时即推，另由低频扫掠兜底
// （idle shutdown / 进程外变化导致的状态漂移）。
export async function GET(req: Request) {
  startAgentStatusSweeper();
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const encode = (data: unknown) => {
        const text = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(text));
      };

      const unsubscribe = subscribeAgentStatuses((statuses) => {
        try {
          encode({ type: "statuses", statuses });
        } catch {
          // controller already closed
        }
      });

      encode({ type: "statuses", statuses: getAgentStatusSnapshot() });

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(":\n\n"));
        } catch {
          // controller already closed
        }
      }, 30_000);

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      req.signal?.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
