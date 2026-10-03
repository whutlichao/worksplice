import { NextResponse } from "next/server";
import { initSecretaryFlow } from "@/lib/domain/collab";

/**
 * 启动助手入口（spec-bootstrap-agent.md §6.3，构建 effort ticket 06）：
 * POST /api/secretary/init —— CreateAgentModal「创建启动助手」按钮的创建路径，
 * 薄封装共享服务层 initSecretaryFlow（§6.2 完整初始化流程：身份 + 手册 + 频道覆盖 +
 * 办公室频道 + 欢迎事件，幂等可重跑），复用 04 不重复实现。
 * provider/modelId/thinkingLevel 为可选项：客户端只在模型已配置时传 defaultModel 对；
 * 缺省 = null 继承全局默认（04 契约）。软删语义在 initSecretaryFlow 内（无存活即重建）。
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      provider?: unknown;
      modelId?: unknown;
      thinkingLevel?: unknown;
    };
    const agent = initSecretaryFlow({
      provider: typeof body.provider === "string" ? body.provider.trim() : null,
      modelId: typeof body.modelId === "string" ? body.modelId.trim() : null,
      thinkingLevel: typeof body.thinkingLevel === "string" ? body.thinkingLevel.trim() : null,
    });
    return NextResponse.json({ agent }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
