import { NextResponse } from "next/server";
import { listChannels, createChannel } from "@/lib/raft/channels";

export async function GET() {
  try {
    return NextResponse.json({ channels: listChannels() });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      name?: unknown;
      type?: unknown;
      description?: unknown;
    };
    const channel = createChannel({
      name: typeof body.name === "string" ? body.name : "",
      type: body.type === "private" ? "private" : "public",
      description: typeof body.description === "string" ? body.description : "",
    });
    return NextResponse.json({ channel }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
