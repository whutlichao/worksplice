import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { createJiti } from 'jiti';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worksplice-agent-transcript-'));
const { openDataDb } = await import('../../../../../lib/data/sqlite.ts');
globalThis.__workspliceDb = openDataDb(root);
test.after(() => {
  globalThis.__workspliceDb?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET } = await jiti.import('./route.ts');

function createSessionManager(prefix) {
  const sessionDir = fs.mkdtempSync(path.join(root, prefix));
  return SessionManager.create(sessionDir, sessionDir);
}

function createSession(messageCount) {
  const manager = createSessionManager('session-');
  for (let index = 0; index < messageCount; index += 1) {
    manager.appendMessage({ role: 'user', content: `message-${String(index).padStart(3, '0')}` });
  }
  return manager.getSessionFile();
}

function insertAgent(sessionFile) {
  const agent = globalThis.__workspliceDb.insertMember({ type: 'agent', name: 'transcript-agent' });
  if (sessionFile) globalThis.__workspliceDb.setMemberPiSessionFile(agent.id, sessionFile);
  return agent;
}

function createBranchedSession() {
  const manager = createSessionManager('session-branch-');
  manager.appendMessage({ role: 'user', content: 'branch-root' });
  const branchPoint = manager.getLeafId();
  manager.appendMessage({ role: 'user', content: 'abandoned-branch' });
  manager.branch(branchPoint);
  manager.appendMessage({ role: 'user', content: 'active-branch' });
  return manager.getSessionFile();
}

function createTypedSession() {
  const manager = createSessionManager('session-typed-');
  const userEntryId = manager.appendMessage({ role: 'user', content: 'typed-user-message' });
  manager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'typed-assistant-message' }],
    provider: 'test-provider',
    model: 'test-model',
    timestamp: Date.now(),
  });
  manager.appendMessage({
    role: 'toolResult',
    toolCallId: 'typed-tool-call',
    toolName: 'test-tool',
    content: [{ type: 'text', text: 'typed-tool-result' }],
    timestamp: Date.now(),
  });
  manager.appendCustomMessageEntry('transcript-test', 'typed-custom-message', true);
  manager.appendCompaction('typed-compaction-summary', userEntryId, 123);
  return manager.getSessionFile();
}

function getTranscript(agentId, query = '') {
  return GET(
    new Request(`http://localhost/api/members/${agentId}/transcript${query}`),
    { params: Promise.resolve({ id: agentId }) },
  );
}

test('member transcript reads only the registered session and returns its latest 100 branch messages', async () => {
  const sessionFile = createSession(105);
  const original = fs.readFileSync(sessionFile);
  const agent = insertAgent(sessionFile);

  const response = await getTranscript(
    agent.id,
    `?path=${encodeURIComponent(path.join(root, 'other.jsonl'))}&sessionId=not-this-session`,
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, 'ready');
  assert.equal(body.sessionId, SessionManager.open(sessionFile).getSessionId());
  assert.equal(body.messages.length, 100);
  assert.equal(body.messages[0].message.content, 'message-005');
  assert.equal(body.messages.at(-1).message.content, 'message-104');
  assert.equal(body.hasMore, true);
  assert.equal(typeof body.cursor, 'string');
  assert.equal(JSON.stringify(body).includes(sessionFile), false);
  assert.deepEqual(fs.readFileSync(sessionFile), original, 'reading a transcript must not modify Pi jsonl');
});

test('pagination walks the same snapshot without gaps or duplicates after the session changes', async () => {
  const sessionFile = createSession(205);
  const agent = insertAgent(sessionFile);
  const firstResponse = await getTranscript(agent.id);
  const first = await firstResponse.json();
  assert.equal(first.messages.length, 100);
  assert.equal(first.messages[0].message.content, 'message-105');
  assert.equal(first.messages.at(-1).message.content, 'message-204');

  const manager = SessionManager.open(sessionFile, path.dirname(sessionFile));
  manager.appendMessage({ role: 'user', content: 'after-snapshot' });

  const secondResponse = await getTranscript(agent.id, `?cursor=${encodeURIComponent(first.cursor)}`);
  const second = await secondResponse.json();
  const thirdResponse = await getTranscript(agent.id, `?cursor=${encodeURIComponent(second.cursor)}`);
  const third = await thirdResponse.json();
  const contents = [...third.messages, ...second.messages, ...first.messages]
    .map((item) => item.message.content);

  assert.equal(second.messages.length, 100);
  assert.equal(second.messages[0].message.content, 'message-005');
  assert.equal(second.messages.at(-1).message.content, 'message-104');
  assert.deepEqual(third.messages.map((item) => item.message.content), [
    'message-000', 'message-001', 'message-002', 'message-003', 'message-004',
  ]);
  assert.equal(third.hasMore, false);
  assert.equal(new Set(contents).size, 205);
  assert.equal(contents.includes('after-snapshot'), false);
});

test('active transcript snapshots survive long pagination and more than 32 concurrent snapshots', async () => {
  const sessionFile = createSession(205);
  const firstAgent = insertAgent(sessionFile);
  const originalNow = Date.now;
  const previousRegistry = globalThis.__workspliceTranscriptRegistry;
  let now = 1_800_000_000_000;

  try {
    globalThis.__workspliceTranscriptRegistry = {
      snapshots: new Map(),
      cursors: new Map(),
    };
    Date.now = () => now;
    const first = await (await getTranscript(firstAgent.id)).json();
    for (let index = 0; index < 32; index += 1) {
      const otherAgent = insertAgent(sessionFile);
      const otherPage = await (await getTranscript(otherAgent.id)).json();
      assert.equal(otherPage.status, 'ready');
    }

    now += 9 * 60_000;
    const secondResponse = await getTranscript(
      firstAgent.id,
      `?cursor=${encodeURIComponent(first.cursor)}`,
    );
    const second = await secondResponse.json();
    assert.equal(secondResponse.status, 200);
    assert.equal(second.messages[0].message.content, 'message-005');

    now += 9 * 60_000;
    const thirdResponse = await getTranscript(
      firstAgent.id,
      `?cursor=${encodeURIComponent(second.cursor)}`,
    );
    const third = await thirdResponse.json();
    assert.equal(thirdResponse.status, 200);
    assert.deepEqual(third.messages.map((item) => item.message.content), [
      'message-000', 'message-001', 'message-002', 'message-003', 'message-004',
    ]);
    assert.equal(third.hasMore, false);
  } finally {
    Date.now = originalNow;
    globalThis.__workspliceTranscriptRegistry = previousRegistry;
  }
});

test('member transcript shows only the current branch', async () => {
  const agent = insertAgent(createBranchedSession());
  const response = await getTranscript(agent.id);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.messages.map((item) => item.message.content), [
    'branch-root', 'active-branch',
  ]);
  assert.equal(JSON.stringify(body).includes('abandoned-branch'), false);
});

test('member transcript maps assistant, tool, custom, and compaction entries', async () => {
  const agent = insertAgent(createTypedSession());
  const response = await getTranscript(agent.id);
  const body = await response.json();
  const messages = body.messages.map((item) => item.message);

  assert.equal(response.status, 200);
  assert.deepEqual(messages.map((message) => message.role), [
    'user', 'assistant', 'toolResult', 'custom', 'custom',
  ]);
  assert.deepEqual(messages[1].content, [{ type: 'text', text: 'typed-assistant-message' }]);
  assert.equal(messages[2].toolCallId, 'typed-tool-call');
  assert.deepEqual(messages[2].content, [{ type: 'text', text: 'typed-tool-result' }]);
  assert.equal(messages[3].customType, 'transcript-test');
  assert.equal(messages[3].content, 'typed-custom-message');
  assert.equal(messages[4].customType, 'compaction');
  assert.equal(messages[4].content, 'typed-compaction-summary');
  assert.equal(messages[4].details.tokensBefore, 123);
});

test('an unregistered or missing session is an explicit empty transcript', async () => {
  const agentWithoutSession = insertAgent(null);
  const emptyResponse = await getTranscript(agentWithoutSession.id);
  assert.equal(emptyResponse.status, 200);
  assert.deepEqual(await emptyResponse.json(), {
    status: 'empty',
    sessionId: null,
    messages: [],
    hasMore: false,
    cursor: null,
  });

  const missingFile = path.join(root, 'missing-session.jsonl');
  const agentWithMissingFile = insertAgent(missingFile);
  const missingResponse = await getTranscript(agentWithMissingFile.id);
  assert.equal(missingResponse.status, 200);
  assert.equal((await missingResponse.json()).status, 'empty');

  const emptySessionFile = path.join(root, 'empty-session.jsonl');
  fs.writeFileSync(emptySessionFile, `${JSON.stringify({
    type: 'session',
    version: 3,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    cwd: root,
  })}\n`);
  const agentWithEmptySession = insertAgent(emptySessionFile);
  const emptyFileResponse = await getTranscript(agentWithEmptySession.id);
  assert.equal(emptyFileResponse.status, 200);
  assert.equal((await emptyFileResponse.json()).status, 'empty');
});

test('corrupt session files return a retryable server error without leaking file paths', async () => {
  const corruptFile = path.join(root, 'corrupt-session.jsonl');
  fs.writeFileSync(corruptFile, '{not-json}\n');
  const agent = insertAgent(corruptFile);
  const response = await getTranscript(agent.id);
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.equal(body.error, 'Unable to read agent transcript');
  assert.equal(JSON.stringify(body).includes(corruptFile), false);
});

test('transcript cursors are bound to the member and its currently registered session', async () => {
  const firstAgent = insertAgent(createSession(105));
  const firstPage = await (await getTranscript(firstAgent.id)).json();
  const otherAgent = insertAgent(createSession(105));
  const crossMemberResponse = await getTranscript(
    otherAgent.id,
    `?cursor=${encodeURIComponent(firstPage.cursor)}`,
  );
  assert.equal(crossMemberResponse.status, 409);

  globalThis.__workspliceDb.setMemberPiSessionFile(firstAgent.id, createSession(106));
  const staleSessionResponse = await getTranscript(
    firstAgent.id,
    `?cursor=${encodeURIComponent(firstPage.cursor)}`,
  );
  assert.equal(staleSessionResponse.status, 409);
});

test('unknown members return not found', async () => {
  const response = await getTranscript('missing-member');
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Agent not found' });
});
