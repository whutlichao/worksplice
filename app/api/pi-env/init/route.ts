import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { initializePiAgentDir } from "@/lib/pi-env-skeleton";

export const dynamic = "force-dynamic";

/**
 * 初始化骨架的**执行**入口（issue #226）：薄封装 —— 校验入参、动作、错误映射、JSON 编码。
 * 写盘逻辑在 `lib/pi-env-skeleton.ts`（只补缺、不覆盖、幂等）。
 *
 * 目标目录固定取 `getAgentDir()`（尊重 `PI_CODING_AGENT_DIR`）：**不允许**经 HTTP 指定，
 * 否则一个网页请求就获得了「在任意路径下建目录写文件」的能力。
 */
const TARGET_FIELDS = ["agentDir", "dir", "path", "directory"] as const;

type BodyCheck = { ok: true } | { ok: false; error: string };

function checkRequestBody(raw: string): BodyCheck {
  if (raw.trim() === "") return { ok: true };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "request body must be JSON (or omitted)" };
  }
  if (parsed === null || typeof parsed !== "object") {
    return { ok: false, error: "request body must be a JSON object (or omitted)" };
  }
  const requested = TARGET_FIELDS.filter(
    (field) => (parsed as Record<string, unknown>)[field] !== undefined,
  );
  if (requested.length > 0) {
    return {
      ok: false,
      error:
        `the pi agent dir is fixed by configuration (PI_CODING_AGENT_DIR); `
        + `it cannot be chosen over HTTP (got ${requested.join(", ")})`,
    };
  }
  return { ok: true };
}

/** 错误映射：权限 ⇒ 403，路径形态冲突 ⇒ 409，其余 ⇒ 500。一律带可读正文。 */
function failureStatus(code: string | undefined): number {
  switch (code) {
    case "EACCES":
    case "EPERM":
    case "EROFS":
      return 403;
    case "EEXIST":
    case "ENOTDIR":
    case "EISDIR":
    case "ENOTEMPTY":
      return 409;
    default:
      return 500;
  }
}

export async function POST(req: Request) {
  let raw = "";
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ error: "cannot read request body" }, { status: 400 });
  }
  const check = checkRequestBody(raw);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  try {
    const result = initializePiAgentDir(getAgentDir());
    return NextResponse.json(result);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: failureStatus(code) },
    );
  }
}
