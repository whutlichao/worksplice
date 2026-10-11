import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: 'automatic' },
  tsconfigPaths: true,
});
const {
  AgentTranscriptContent,
  AgentTranscriptViewer,
  AgentTranscriptToggle,
} = await jiti.import('./AgentTranscriptViewer.tsx');
const { AgentAvatarTintPicker, AgentDetailPanel } = await jiti.import('./AgentDetailPanel.tsx');
const { I18nProvider } = await jiti.import('../hooks/useI18n.tsx');

function renderContent(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(AgentTranscriptContent, {
        sessionId: null,
        memberId: null,
        messages: [],
        hasMore: false,
        loadingEarlier: false,
        error: null,
        onRefresh: () => undefined,
        onRetry: () => undefined,
        onLoadEarlier: () => undefined,
        ...props,
      }),
    ),
  );
}

function createHookRenderer(component, props, context = { t: (key) => key }) {
  const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const hooks = [];
  let hookIndex = 0;
  let pendingEffects = [];
  let tree;

  const nextHook = (kind) => {
    const index = hookIndex++;
    let slot = hooks[index];
    if (slot && slot.kind !== kind) {
      throw new Error(`Hook order changed at ${index}: ${slot.kind} -> ${kind}`);
    }
    if (!slot) hooks[index] = slot = { kind };
    return slot;
  };
  const sameDeps = (previous, next) =>
    previous !== undefined && next !== undefined &&
    previous.length === next.length && previous.every((value, index) => Object.is(value, next[index]));
  const dispatcher = {
    useContext: () => context,
    useState(initial) {
      const slot = nextHook('state');
      if (!('value' in slot)) slot.value = typeof initial === 'function' ? initial() : initial;
      return [slot.value, (next) => {
        slot.value = typeof next === 'function' ? next(slot.value) : next;
      }];
    },
    useRef(initial) {
      const slot = nextHook('ref');
      if (!('value' in slot)) slot.value = { current: initial };
      return slot.value;
    },
    useMemo(factory, deps) {
      const slot = nextHook('memo');
      if (!sameDeps(slot.deps, deps)) {
        slot.value = factory();
        slot.deps = deps;
      }
      return slot.value;
    },
    useCallback(callback, deps) {
      const slot = nextHook('callback');
      if (!sameDeps(slot.deps, deps)) {
        slot.value = callback;
        slot.deps = deps;
      }
      return slot.value;
    },
    useEffect(create, deps) {
      const slot = nextHook('effect');
      if (!sameDeps(slot.deps, deps)) {
        slot.deps = deps;
        pendingEffects.push({ slot, create });
      }
    },
  };

  return {
    render() {
      hookIndex = 0;
      const previousDispatcher = internals.H;
      internals.H = dispatcher;
      try {
        tree = component(props);
      } finally {
        internals.H = previousDispatcher;
      }
      return tree;
    },
    flushEffects() {
      const effects = pendingEffects;
      pendingEffects = [];
      for (const { slot, create } of effects) {
        slot.cleanup?.();
        const cleanup = create();
        slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
      }
    },
    unmount() {
      for (const slot of hooks) {
        if (slot.kind === 'effect') slot.cleanup?.();
      }
    },
    get tree() {
      return tree;
    },
  };
}

function findElement(node, type) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type);
      if (found) return found;
    }
    return undefined;
  }
  if (!React.isValidElement(node)) return undefined;
  if (node.type === type) return node;
  return findElement(node.props.children, type);
}

function transcriptItem(entryId, text) {
  return {
    entryId,
    message: { role: 'user', content: text, timestamp: '2026-10-11T00:00:00.000Z' },
  };
}

function transcriptAssistantItem(entryId, text) {
  return {
    entryId,
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
      provider: 'test',
      model: 'model',
    },
  };
}

function transcriptPage(sessionId, messages, { hasMore = false, cursor = null } = {}) {
  return { status: 'ready', sessionId, messages, hasMore, cursor };
}

function transcriptAgent(overrides) {
  return {
    id: 'transcript-agent',
    type: 'agent',
    name: 'Transcript agent',
    description: '',
    role: 'member',
    workspace_path: null,
    pi_session_file: null,
    status: 'offline',
    deleted: 0,
    model_provider: null,
    model_id: null,
    thinking_level: null,
    created_at: '2026-10-11T00:00:00.000Z',
    avatar_tint: null,
    ...overrides,
  };
}

test('transcript loading state is announced and busy', () => {
  const html = renderContent({ status: 'loading' });

  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Loading transcript/);
  assert.match(html, /role="status"/);
});

test('empty transcript has an explicit empty state', () => {
  const html = renderContent({ status: 'empty' });

  assert.match(html, /No transcript messages/);
  assert.match(html, /role="status"/);
});

test('a tool result at the first-page boundary remains visible until its earlier call is loaded', () => {
  const html = renderContent({
    status: 'ready',
    messages: [
      {
        entryId: 'tool-result-entry',
        message: {
          role: 'toolResult',
          toolCallId: 'tool-call-on-earlier-page',
          toolName: 'read',
          content: [{ type: 'text', text: 'visible page-boundary output' }],
        },
      },
    ],
  });

  assert.match(html, /Tool result · read/);
  assert.match(html, /visible page-boundary output/);
});

test('transcript failures expose an alert and retry action', () => {
  const html = renderContent({ status: 'error', error: 'Unable to read transcript' });

  assert.match(html, /role="alert"/);
  assert.match(html, /Unable to read transcript/);
  assert.match(html, /Retry/);
});

test('ready transcript is a bounded read-only message view with refresh and pagination', () => {
  const html = renderContent({
    status: 'ready',
    messages: [
      {
        entryId: 'entry-1',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'A read-only transcript message' }],
          provider: 'test',
          model: 'model',
          timestamp: 1,
        },
      },
    ],
    hasMore: true,
  });

  assert.match(html, /aria-label="Current branch · read only"/);
  assert.match(html, /overflow-y:auto/);
  assert.match(html, /max-height:min\(50vh,/);
  assert.match(html, /A read-only transcript message/);
  assert.match(html, /Refresh transcript/);
  assert.match(html, /Load earlier/);
  assert.doesNotMatch(html, /<textarea|>Fork<|>Edit<|>Reply</);
});

test('only assistant messages in the member-scoped transcript show the current agent avatar', () => {
  const agent = transcriptAgent({ id: 'transcript-agent', avatar_tint: 2 });
  const html = renderContent({
    status: 'ready',
    memberId: agent.id,
    agent,
    messages: [
      transcriptAssistantItem('assistant-entry', 'assistant history'),
      {
        entryId: 'user-entry',
        message: { role: 'user', content: 'user message' },
      },
      {
        entryId: 'tool-entry',
        message: {
          role: 'toolResult',
          toolCallId: 'tool-1',
          toolName: 'read',
          content: [{ type: 'text', text: 'tool output' }],
        },
      },
      {
        entryId: 'custom-entry',
        message: {
          role: 'custom',
          customType: 'transcript-test',
          content: 'custom message',
          display: true,
        },
      },
      {
        entryId: 'bash-entry',
        message: {
          role: 'bashExecution',
          command: 'pwd',
          output: '/workspace',
          truncated: false,
        },
      },
    ],
  });

  assert.match(html, /class="avatar sm av-2" role="img" aria-label="Transcript agent"/);
  assert.equal((html.match(/class="avatar\b/g) ?? []).length, 1);
  assert.match(html, /assistant history/);
  assert.match(html, /user message/);
  assert.match(html, /tool output/);
  assert.match(html, /custom message/);
  assert.match(html, /pwd/);
});

test('the same assistant history uses the current tint and unassociated transcripts have no agent avatar', () => {
  const assistant = transcriptAssistantItem('assistant-history', 'stable assistant history');
  const renderWithTint = (avatar_tint) => renderContent({
    status: 'ready',
    memberId: 'transcript-agent',
    agent: transcriptAgent({ avatar_tint }),
    messages: [assistant],
  });

  const beforeTintChange = renderWithTint(1);
  const afterTintChange = renderWithTint(3);
  const restoredAutomaticTint = renderWithTint(null);
  assert.match(beforeTintChange, /class="avatar sm av-1"/);
  assert.match(afterTintChange, /class="avatar sm av-3"/);
  assert.match(restoredAutomaticTint, /class="avatar sm av-3"/);
  assert.match(afterTintChange, /stable assistant history/);

  const mismatchedMember = renderContent({
    status: 'ready',
    memberId: 'another-agent',
    agent: transcriptAgent({ avatar_tint: 3 }),
    messages: [assistant],
  });
  assert.doesNotMatch(mismatchedMember, /class="avatar\b/);
});

test('human transcript messages without an agent association have no agent avatar', () => {
  const html = renderContent({
    status: 'ready',
    memberId: null,
    agent: null,
    messages: [transcriptAssistantItem('human-session-entry', 'human session assistant reply')],
  });

  assert.match(html, /human session assistant reply/);
  assert.doesNotMatch(html, /class="avatar\b/);
});

test('transcript controls have copy in both supported language packs', async () => {
  const { enLocale } = await import('../lib/i18n/messages/en.ts');
  const { zhCNLocale } = await import('../lib/i18n/messages/zh-CN.ts');
  const keys = [
    'observability.transcriptOpen',
    'observability.transcriptHide',
    'observability.transcriptViewer',
    'observability.transcriptReadOnly',
    'observability.transcriptLoading',
    'observability.transcriptRefreshing',
    'observability.transcriptRefresh',
    'observability.transcriptEmpty',
    'observability.transcriptError',
    'observability.transcriptRetry',
    'observability.transcriptLoadEarlier',
    'observability.transcriptLoadingEarlier',
    'observability.transcriptToolResult',
  ];

  for (const key of keys) {
    assert.ok(enLocale.messages[key], `en missing ${key}`);
    assert.ok(zhCNLocale.messages[key], `zh-CN missing ${key}`);
  }
});

test('agent detail keeps the transcript control available when no session is registered', () => {
  const agent = transcriptAgent({
    id: 'agent-without-session',
    name: 'Agent without session',
  });
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(AgentDetailPanel, {
        agent,
        onClose: () => undefined,
        onChanged: () => undefined,
        onOpenDM: () => undefined,
      }),
    ),
  );

  assert.match(html, /aria-controls="agent-transcript-viewer"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /No session data/);
});

test('transcript toggle invokes the panel handler and reflects open/close state', () => {
  let isOpen = false;
  const onToggle = () => {
    isOpen = !isOpen;
  };
  const props = {
    openLabel: 'Open transcript',
    closeLabel: 'Close transcript',
    controlsId: 'agent-transcript-viewer',
    onToggle,
  };

  const closedButton = AgentTranscriptToggle({ ...props, isOpen });
  assert.equal(closedButton.props['aria-expanded'], false);
  assert.equal(closedButton.props.children, 'Open transcript');
  closedButton.props.onClick();

  const openButton = AgentTranscriptToggle({ ...props, isOpen });
  assert.equal(openButton.props['aria-expanded'], true);
  assert.equal(openButton.props['aria-controls'], 'agent-transcript-viewer');
  assert.equal(openButton.props.children, 'Close transcript');
  openButton.props.onClick();
  assert.equal(isOpen, false);
});

test('AgentDetailPanel expands, refreshes, paginates, and reopens a fresh transcript snapshot', async () => {
  const agent = transcriptAgent({
    id: 'transcript-agent',
    name: 'Transcript agent',
    pi_session_file: '/sessions/transcript-agent.jsonl',
    avatar_tint: 2,
  });
  const responses = [
    transcriptPage('session-1', [transcriptAssistantItem('initial', 'initial snapshot')]),
    transcriptPage('session-1', [transcriptItem('refreshed', 'refreshed snapshot')], {
      hasMore: true,
      cursor: 'cursor-1',
    }),
    transcriptPage('session-1', [
      transcriptItem('earlier', 'earlier page'),
      transcriptItem('refreshed', 'overlap is deduplicated'),
    ]),
    transcriptPage('session-1', [transcriptItem('reopened', 'reopened snapshot')]),
  ];
  const requestUrls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (init?.method === 'PATCH') {
      return { ok: true, status: 200, json: async () => ({ agent: { avatar_tint: 3 } }) };
    }
    requestUrls.push(String(url));
    const page = responses.shift();
    assert.ok(page, `unexpected transcript request: ${url}`);
    return { ok: true, status: 200, json: async () => page };
  };

  const settleRequest = () => new Promise((resolve) => setImmediate(resolve));
  const panel = createHookRenderer(AgentDetailPanel, {
    agent,
    onClose: () => undefined,
    onChanged: () => undefined,
    onOpenDM: () => undefined,
  });
  let viewer;

  function clickTranscriptToggle() {
    const toggle = findElement(panel.tree, AgentTranscriptToggle);
    assert.ok(toggle, 'the panel renders its transcript toggle');
    const button = AgentTranscriptToggle(toggle.props);
    button.props.onClick();
  }

  function mountTranscriptViewer() {
    const element = findElement(panel.tree, AgentTranscriptViewer);
    assert.ok(element, 'the expanded panel mounts its transcript viewer');
    viewer = createHookRenderer(element.type, element.props);
    viewer.render();
    viewer.flushEffects();
  }

  function currentTranscript() {
    const content = findElement(viewer.tree, AgentTranscriptContent);
    assert.ok(content, 'the viewer exposes its current transcript controls');
    return content.props;
  }

  try {
    panel.render();
    assert.equal(findElement(panel.tree, AgentTranscriptViewer), undefined);

    clickTranscriptToggle();
    panel.render();
    assert.equal(findElement(panel.tree, AgentTranscriptToggle).props.isOpen, true);
    mountTranscriptViewer();
    await settleRequest();
    viewer.render();
    assert.deepEqual(currentTranscript().messages.map((item) => item.entryId), ['initial']);
    assert.equal(currentTranscript().memberId, agent.id);
    assert.equal(currentTranscript().agent.avatar_tint, 2);
    assert.match(renderContent(currentTranscript()), /class="avatar sm av-2"/);

    const tintPicker = findElement(panel.tree, AgentAvatarTintPicker);
    assert.ok(tintPicker, 'the agent detail panel exposes its current avatar tint picker');
    await tintPicker.props.onSelect(3);
    panel.render();
    const updatedViewer = findElement(panel.tree, AgentTranscriptViewer);
    assert.equal(updatedViewer.props.agent.avatar_tint, 3);
    assert.match(
      renderContent({ ...currentTranscript(), agent: updatedViewer.props.agent }),
      /class="avatar sm av-3"/,
    );

    currentTranscript().onRefresh();
    await settleRequest();
    viewer.render();
    assert.deepEqual(currentTranscript().messages.map((item) => item.entryId), ['refreshed']);

    currentTranscript().onLoadEarlier();
    await settleRequest();
    viewer.render();
    assert.deepEqual(currentTranscript().messages.map((item) => item.entryId), ['earlier', 'refreshed']);
    assert.equal(currentTranscript().hasMore, false);

    clickTranscriptToggle();
    panel.render();
    assert.equal(findElement(panel.tree, AgentTranscriptViewer), undefined);
    viewer.unmount();

    clickTranscriptToggle();
    panel.render();
    mountTranscriptViewer();
    await settleRequest();
    viewer.render();
    assert.deepEqual(currentTranscript().messages.map((item) => item.entryId), ['reopened']);
    assert.deepEqual(requestUrls, [
      '/api/members/transcript-agent/transcript',
      '/api/members/transcript-agent/transcript',
      '/api/members/transcript-agent/transcript?cursor=cursor-1',
      '/api/members/transcript-agent/transcript',
    ]);
  } finally {
    viewer?.unmount();
    globalThis.fetch = originalFetch;
  }
});

test('tool results already paired with a loaded call are not rendered twice', () => {
  const html = renderContent({
    status: 'ready',
    messages: [
      {
        entryId: 'tool-call-entry',
        message: {
          role: 'assistant',
          content: [{
            type: 'toolCall',
            toolCallId: 'tool-call-1',
            toolName: 'read',
            input: { path: 'notes.txt' },
          }],
          provider: 'test',
          model: 'model',
        },
      },
      {
        entryId: 'tool-result-entry',
        message: {
          role: 'toolResult',
          toolCallId: 'tool-call-1',
          content: [{ type: 'text', text: 'result paired with its call' }],
        },
      },
    ],
  });

  assert.match(html, />read</);
  assert.doesNotMatch(html, /Tool result · read/);
});

test('paired tool-result images remain visible in the transcript', () => {
  const html = renderContent({
    status: 'ready',
    messages: [
      {
        entryId: 'image-call-entry',
        message: {
          role: 'assistant',
          content: [{
            type: 'toolCall',
            toolCallId: 'image-tool-call',
            toolName: 'inspect_image',
            input: {},
          }],
          provider: 'test',
          model: 'model',
        },
      },
      {
        entryId: 'image-result-entry',
        message: {
          role: 'toolResult',
          toolCallId: 'image-tool-call',
          toolName: 'inspect_image',
          content: [{
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' },
          }],
        },
      },
    ],
  });

  assert.match(html, /src="data:image\/png;base64,aGVsbG8="/);
  assert.equal((html.match(/<img\b/g) ?? []).length, 1);
});

test('transcript bash messages receive their session id so truncated output can be opened', () => {
  const html = renderContent({
    status: 'ready',
    sessionId: 'registered-session-id',
    messages: [
      {
        entryId: 'bash-entry',
        message: {
          role: 'bashExecution',
          command: 'cat large.log',
          output: 'preview only',
          truncated: true,
          fullOutputPath: '/tmp/worksplice-bash-output.log',
        },
      },
    ],
  });

  assert.match(html, /full output/i);
});
