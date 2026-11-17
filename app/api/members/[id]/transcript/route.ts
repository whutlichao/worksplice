import { NextResponse } from 'next/server';
import { getAgentTranscriptPage, TranscriptCursorError } from '@/lib/session-transcript';
import { DomainError, jsonError } from '@/lib/domain/errors';

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
      return jsonError(
        new DomainError(409, 'transcript_cursor_expired', error.message),
      );
    }
    return jsonError(error, 500, {
      fallbackMessage: 'Unable to read agent transcript',
    });
  }
}
