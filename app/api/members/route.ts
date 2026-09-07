import { NextResponse } from "next/server";
import { listAgents, createAgent, agentHomePath, getOwner, DuplicateAgentNameError } from "@/lib/domain/raft";

export async function GET() {
  try {
    // home_path = 确定性家目录（ADR-0001）：客户端据此区分家目录/项目目录绑定
    // owner = 人类成员（mention 渲染/简介弹窗的数据来源）
    return NextResponse.json({
      agents: listAgents().map((agent) => ({ ...agent, home_path: agentHomePath(agent) })),
      owner: getOwner() ?? null,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      name?: unknown;
      description?: unknown;
      provider?: unknown;
      modelId?: unknown;
      thinkingLevel?: unknown;
    };
    // ADR-0001 创建契约：模型/推理强度必选（创建时不绑定目录，家目录自动生成）
    const provider = typeof body.provider === "string" ? body.provider.trim() : "";
    const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
    const thinkingLevel =
      typeof body.thinkingLevel === "string" ? body.thinkingLevel.trim() : "";
    if (!provider || !modelId || !thinkingLevel) {
      return NextResponse.json(
        { error: "Model provider, model id and thinking level are required when creating an agent" },
        { status: 400 },
      );
    }
    const agent = createAgent({
      name: typeof body.name === "string" ? body.name : "",
      description: typeof body.description === "string" ? body.description : "",
      provider,
      modelId,
      thinkingLevel,
    });
    return NextResponse.json({ agent }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 重名 → 409（对齐 BusyCwdError/TaskAlreadyExistsError → 409 惯例）；其余校验错误维持 400
    if (error instanceof DuplicateAgentNameError) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
