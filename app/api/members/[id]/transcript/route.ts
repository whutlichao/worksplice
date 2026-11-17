import { NextResponse } from 'next/server';
import { getAgentTranscriptPage, TranscriptCursorError } from '@/lib/session-transcript';
import { isDomainError, jsonError } from '@/lib/domain/errors';

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
    if (error instanceof TranscriptCursorError) {
      return NextResponse.json(
        { error: error.message, code: 'transcript_cursor_expired' },
        { status: 409 },
      );
    }
    if (isDomainError(error)) return jsonError(error);
    return NextResponse.json(
      { error: 'Unable to read agent transcript' },
      { status: 500 },
    );
  }
}
