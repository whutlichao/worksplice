import { NextResponse } from "next/server";
import { listAgents, createAgent } from "@/lib/raft/members";

export async function GET() {
  try {
    return NextResponse.json({ agents: listAgents() });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      name?: unknown;
      description?: unknown;
      workspacePath?: unknown;
    };
    const agent = createAgent({
      name: typeof body.name === "string" ? body.name : "",
      description: typeof body.description === "string" ? body.description : "",
      workspacePath: typeof body.workspacePath === "string" ? body.workspacePath : null,
    });
    return NextResponse.json({ agent }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
