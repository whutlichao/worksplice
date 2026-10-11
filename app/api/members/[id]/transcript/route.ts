import { NextResponse } from 'next/server';
import { AgentNotFoundError } from '@/lib/domain/collab';
import { getAgentTranscriptPage, TranscriptCursorError } from '@/lib/session-transcript';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const cursor = new URL(request.url).searchParams.get('cursor');
    return NextResponse.json(getAgentTranscriptPage(id, cursor), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof AgentNotFoundError) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }
    if (error instanceof TranscriptCursorError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: 'Unable to read agent transcript' },
      { status: 500 },
    );
  }
}
