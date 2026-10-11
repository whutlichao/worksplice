'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentTranscriptPage, ImageContent, SessionTranscriptItem, ToolResultMessage } from '@/lib/types';
import { useI18n } from '@/hooks/useI18n';
import type { MemberRow } from '@/lib/data/types';
import { imageSource, MessageView } from './MessageView';
import { Avatar } from './Avatar';

type TranscriptStatus = 'loading' | 'empty' | 'ready' | 'error';
type TranscriptAgent = Pick<MemberRow, 'id' | 'name' | 'avatar_tint'>;

interface TranscriptContentProps {
  status: TranscriptStatus;
  sessionId: string | null;
  memberId?: string | null;
  agent?: TranscriptAgent | null;
  messages: SessionTranscriptItem[];
  hasMore: boolean;
  loadingEarlier: boolean;
  error: string | null;
  onRefresh: () => void;
  onRetry: () => void;
  onLoadEarlier: () => void;
}

export function AgentTranscriptToggle({
  isOpen,
  openLabel,
  closeLabel,
  controlsId,
  onToggle,
}: {
  isOpen: boolean;
  openLabel: string;
  closeLabel: string;
  controlsId: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="btn btn-sm"
      aria-expanded={isOpen}
      aria-controls={controlsId}
      onClick={onToggle}
    >
      {isOpen ? closeLabel : openLabel}
    </button>
  );
}

function mergeTranscriptMessages(
  current: SessionTranscriptItem[],
  earlier: SessionTranscriptItem[],
): SessionTranscriptItem[] {
  const currentIds = new Set(current.map((item) => item.entryId));
  return [...earlier.filter((item) => !currentIds.has(item.entryId)), ...current];
}

function indexTranscriptToolResults(
  messages: SessionTranscriptItem[],
): Map<string, ToolResultMessage> {
  const results = new Map<string, ToolResultMessage>();
  for (const { message } of messages) {
    if (message.role === 'toolResult') results.set(message.toolCallId, message);
  }
  return results;
}

function indexTranscriptToolCallIds(messages: SessionTranscriptItem[]): Set<string> {
  const ids = new Set<string>();
  for (const { message } of messages) {
    if (message.role !== 'assistant') continue;
    for (const block of message.content) {
      if (block.type === 'toolCall') ids.add(block.toolCallId);
    }
  }
  return ids;
}

function TranscriptToolResult({ message, imagesOnly = false }: {
  message: ToolResultMessage;
  imagesOnly?: boolean;
}) {
  const { t } = useI18n();
  const text = imagesOnly ? '' : message.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  const images = message.content.filter((block): block is ImageContent => block.type === 'image');
  const color = message.isError ? 'var(--error)' : 'var(--muted)';

  return (
    <div
      aria-label={t('observability.transcriptToolResult')}
      style={{
        marginBottom: 'var(--sp-3)',
        border: `1px solid color-mix(in oklch, ${message.isError ? 'var(--error)' : 'var(--online)'} 25%, transparent)`,
        borderRadius: 'var(--r-md)',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '6px 10px', background: 'var(--panel)', color, fontSize: 'var(--fs-caption)' }}>
        {t('observability.transcriptToolResult')}
        {message.toolName ? ` · ${message.toolName}` : ''}
      </div>
      {text && (
        <pre style={{ margin: 0, padding: '8px 10px', background: 'var(--bg)', color, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {text}
        </pre>
      )}
      {images.map((image, index) => {
        const src = imageSource(image);
        return src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={index} src={src} alt="" style={{ display: 'block', maxWidth: '100%', maxHeight: 300, objectFit: 'contain' }} />
        ) : null;
      })}
      {!text && images.length === 0 && (
        <div style={{ padding: '8px 10px', color: 'var(--faint)', fontSize: 'var(--fs-sm)' }}>
          {t('i18n.noOutput')}
        </div>
      )}
    </div>
  );
}

function TranscriptRetryAlert({ error, onRetry }: { error: string; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div role="alert" style={{ color: 'var(--error)', fontSize: 'var(--fs-sm)' }}>
      {error}
      <button type="button" className="btn btn-sm" onClick={onRetry} style={{ marginLeft: 'var(--sp-3)' }}>
        {t('observability.transcriptRetry')}
      </button>
    </div>
  );
}

/** 只读 transcript 标记，与加载逻辑分离，以便在无 DOM 的测试中覆盖各可见状态。 */
export function AgentTranscriptContent({
  status,
  sessionId,
  memberId = null,
  agent = null,
  messages,
  hasMore,
  loadingEarlier,
  error,
  onRefresh,
  onRetry,
  onLoadEarlier,
}: TranscriptContentProps) {
  const { t } = useI18n();
  const toolResults = useMemo(() => indexTranscriptToolResults(messages), [messages]);
  const toolCallIds = useMemo(() => indexTranscriptToolCallIds(messages), [messages]);
  const associatedAgent = agent?.id === memberId ? agent : null;

  return (
    <section
      aria-label={t('observability.transcriptReadOnly')}
      aria-busy={status === 'loading'}
      style={{
        marginTop: 'var(--sp-4)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--sp-3)',
          padding: 'var(--sp-3) var(--sp-4)',
          background: 'var(--panel)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span style={{ color: 'var(--muted)', fontSize: 'var(--fs-caption)' }}>
          {t('observability.transcriptReadOnly')}
        </span>
        <button
          type="button"
          className="btn btn-sm"
          onClick={onRefresh}
          disabled={status === 'loading'}
        >
          {status === 'loading'
            ? t('observability.transcriptRefreshing')
            : t('observability.transcriptRefresh')}
        </button>
      </div>

      <div
        aria-label={t('observability.transcriptReadOnly')}
        role="region"
        style={{ maxHeight: 'min(50vh, 420px)', overflowY: 'auto', padding: 'var(--sp-3)' }}
      >
        {status === 'loading' ? (
          <div role="status" aria-busy="true" style={{ color: 'var(--faint)', fontSize: 'var(--fs-sm)' }}>
            {t('observability.transcriptLoading')}
          </div>
        ) : status === 'empty' ? (
          <div role="status" style={{ color: 'var(--faint)', fontSize: 'var(--fs-sm)' }}>
            {t('observability.transcriptEmpty')}
          </div>
        ) : status === 'error' ? (
          <TranscriptRetryAlert
            error={error ?? t('observability.transcriptError')}
            onRetry={onRetry}
          />
        ) : (
          <>
            {error && (
              <div style={{ marginBottom: 'var(--sp-3)' }}>
                <TranscriptRetryAlert error={error} onRetry={onRetry} />
              </div>
            )}
            {hasMore && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--sp-3)' }}>
                <button type="button" className="btn btn-sm" onClick={onLoadEarlier} disabled={loadingEarlier}>
                  {loadingEarlier
                    ? t('observability.transcriptLoadingEarlier')
                    : t('observability.transcriptLoadEarlier')}
                </button>
              </div>
            )}
            {messages.map(({ entryId, message }) => {
              if (message.role === 'toolResult' && !toolCallIds.has(message.toolCallId)) {
                return <TranscriptToolResult key={entryId} message={message} />;
              }

              const pairedImageResults: ToolResultMessage[] = [];
              if (message.role === 'assistant') {
                for (const block of message.content) {
                  if (block.type !== 'toolCall') continue;
                  const result = toolResults.get(block.toolCallId);
                  if (result?.content.some((content) => content.type === 'image')) {
                    pairedImageResults.push(result);
                  }
                }
              }

              const messageView = (
                <>
                  <MessageView
                    message={message}
                    toolResults={toolResults}
                    sessionId={sessionId ?? undefined}
                    showTimestamp
                  />
                  {pairedImageResults.map((result) => (
                    <TranscriptToolResult
                      key={`${entryId}-${result.toolCallId}-images`}
                      message={result}
                      imagesOnly
                    />
                  ))}
                </>
              );

              return (
                <Fragment key={entryId}>
                  {message.role === 'assistant' && associatedAgent ? (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-3)' }}>
                      <Avatar
                        name={associatedAgent.name}
                        type="agent"
                        size="sm"
                        colorKey={associatedAgent.id}
                        agentTint={associatedAgent.avatar_tint}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>{messageView}</div>
                    </div>
                  ) : messageView}
                </Fragment>
              );
            })}
            {loadingEarlier && (
              <div role="status" style={{ color: 'var(--faint)', fontSize: 'var(--fs-sm)' }}>
                {t('observability.transcriptLoadingEarlier')}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** 加载成员范围内的单次快照；卸载后重新挂载（关闭再打开）会重新读取。 */
export function AgentTranscriptViewer({ memberId, agent = null }: {
  memberId: string;
  agent?: TranscriptAgent | null;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<TranscriptStatus>('loading');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SessionTranscriptItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const loadingEarlierRef = useRef(false);
  const failedCursorRef = useRef<string | null>(null);

  const requestPage = useCallback(async (pageCursor: string | null, generation: number) => {
    const controller = new AbortController();
    controllerRef.current = controller;
    const query = pageCursor ? `?cursor=${encodeURIComponent(pageCursor)}` : '';
    try {
      const response = await fetch(
        `/api/members/${encodeURIComponent(memberId)}/transcript${query}`,
        { signal: controller.signal },
      );
      const body = (await response.json().catch(() => ({}))) as Partial<AgentTranscriptPage> & { error?: string };
      if (!response.ok || (body as { error?: string }).error) {
        throw new Error((body as { error?: string }).error ?? `HTTP ${response.status}`);
      }
      if (
        (body.status !== 'empty' && body.status !== 'ready') ||
        !Array.isArray(body.messages) ||
        typeof body.hasMore !== 'boolean' ||
        (body.cursor !== null && typeof body.cursor !== 'string') ||
        (body.sessionId !== null && typeof body.sessionId !== 'string')
      ) {
        throw new Error(t('observability.transcriptError'));
      }
      if (generation !== generationRef.current) return;

      if (pageCursor) {
        setMessages((current) => mergeTranscriptMessages(current, body.messages!));
      } else {
        setMessages(body.messages);
      }
      setStatus(body.status);
      setSessionId(body.sessionId ?? null);
      setHasMore(body.hasMore);
      setCursor(body.cursor ?? null);
      setError(null);
      failedCursorRef.current = null;
    } catch (cause) {
      if (controller.signal.aborted || generation !== generationRef.current) return;
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message || t('observability.transcriptError'));
      failedCursorRef.current = pageCursor;
      if (!pageCursor) setStatus('error');
    } finally {
      if (generation === generationRef.current) {
        if (pageCursor) {
          loadingEarlierRef.current = false;
          setLoadingEarlier(false);
        }
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    }
  }, [memberId, t]);

  const refresh = useCallback(() => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    loadingEarlierRef.current = false;
    setLoadingEarlier(false);
    setStatus('loading');
    setSessionId(null);
    setMessages([]);
    setHasMore(false);
    setCursor(null);
    setError(null);
    failedCursorRef.current = null;
    void requestPage(null, generationRef.current);
  }, [requestPage]);

  const loadEarlier = useCallback(() => {
    if (!cursor || loadingEarlierRef.current) return;
    loadingEarlierRef.current = true;
    setLoadingEarlier(true);
    setError(null);
    void requestPage(cursor, generationRef.current);
  }, [cursor, requestPage]);

  const retry = useCallback(() => {
    if (failedCursorRef.current) {
      loadingEarlierRef.current = true;
      setLoadingEarlier(true);
      setError(null);
      void requestPage(failedCursorRef.current, generationRef.current);
      return;
    }
    refresh();
  }, [refresh, requestPage]);

  useEffect(() => {
    refresh();
    return () => {
      generationRef.current += 1;
      controllerRef.current?.abort();
    };
  }, [refresh]);

  return (
    <div aria-label={t('observability.transcriptViewer')}>
      <AgentTranscriptContent
        status={status}
        sessionId={sessionId}
        memberId={memberId}
        agent={agent}
        messages={messages}
        hasMore={hasMore}
        loadingEarlier={loadingEarlier}
        error={error}
        onRefresh={refresh}
        onRetry={retry}
        onLoadEarlier={loadEarlier}
      />
    </div>
  );
}
