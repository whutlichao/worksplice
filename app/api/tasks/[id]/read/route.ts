import { NextResponse } from "next/server";
import { markTaskThreadRead } from "@/lib/domain/collab";

/** POST /api/tasks/[id]/read: advance only the addressed Task's visible thread position. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || !("throughSeq" in body)) {
    return NextResponse.json(
      { error: "throughSeq must be a non-negative integer" },
      { status: 400 },
    );
  }
  const throughSeq = (body as { throughSeq: unknown }).throughSeq;
  if (
    typeof throughSeq !== "number" ||
    !Number.isSafeInteger(throughSeq) ||
    throughSeq < 0
  ) {
    return NextResponse.json(
      { error: "throughSeq must be a non-negative integer" },
      { status: 400 },
    );
  }

  try {
    const { id } = await params;
    return NextResponse.json(
      markTaskThreadRead({ taskId: id, throughSeq }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "Task not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
