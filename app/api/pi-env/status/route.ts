import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readPiEnvStatus } from "@/lib/pi-env-status";
import { createPiEnvProbes } from "@/lib/pi-env-probe";

export const dynamic = "force-dynamic";

/**
 * 两档结论的**查询**入口（issue #226）：薄封装 —— 取配置根、现算一次、JSON 编码。
 * 判定逻辑在 `lib/pi-env-status.ts`（纯逻辑），真实探测在 `lib/pi-env-probe.ts`。
 *
 * 不缓存、不落库：环境会在外部被改变（装个 CLI、改个环境变量），每次请求现算。
 */
export async function GET() {
  try {
    const agentDir = getAgentDir();
    const status = await readPiEnvStatus(agentDir, createPiEnvProbes());
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
