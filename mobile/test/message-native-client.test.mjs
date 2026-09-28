import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

class ApiError extends Error { constructor(status) { super('API error'); this.status = status; } }
function harness(handler = async () => ({ ok: true })) {
  const requests = [];
  const source = fs.readFileSync(new URL('../src/lib/messages-client.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function('require', 'exports', compiled)(id => {
    if (id === 'expo-crypto') return { randomUUID: () => 'stable-message-request-id' };
    if (id === '@/lib/api') return { ApiError, apiRequest: async (path, init) => { requests.push({ path, init }); return handler(path, init); } };
    throw new Error(`Unexpected dependency ${id}`);
  }, exports);
  return { api: exports, requests };
}

test('empty inbox is a successful workspace, while failed API results stay errors', async () => {
  const workspace = { ok: true, memberId: 'member-1', threads: [], members: [], hasMore: false, canUseSms: false };
  assert.deepEqual(await harness(async () => workspace).api.messagesOverview('', 1), workspace);
  await assert.rejects(harness(async () => ({ ok: false })).api.messagesOverview('', 1), /could not be loaded/);
});
test('customer history and send are bound to the returned authorised job, never raw number', async () => {
  const h = harness();
  const customer = { customerId: 'customer-1', workOrderId: 'job-2', name: 'Customer', phone: '0400000000' };
  await h.api.smsHistory(customer);
  await h.api.smsAction(customer, { action: 'send', body: 'On my way', requestId: 'request-123456789', customerId: 'other', workOrderId: 'other' });
  assert.equal(h.requests[0].path, '/api/trade-sms?customerId=customer-1&workOrderId=job-2');
  assert.deepEqual(JSON.parse(h.requests[1].init.body), { action: 'send', body: 'On my way', requestId: 'request-123456789', customerId: 'customer-1', workOrderId: 'job-2' });
});
test('uncertain sends keep request identity, text and attachments immutable on retry', () => {
  const { api } = harness();
  const first = api.pendingMessage({ body: ' hello ', attachments: [{ id: 'b' }, { id: 'a' }], pending: null });
  assert.deepEqual(first, { requestId: 'stable-message-request-id', body: 'hello', attachmentIds: ['a', 'b'] });
  assert.equal(api.pendingMessage({ body: 'edited', attachments: [], pending: first }), first);
  for (const status of [408, 500, 503]) assert.equal(api.definitiveMessageFailure(new ApiError(status)), false);
  for (const status of [400, 401, 403, 409]) assert.equal(api.definitiveMessageFailure(new ApiError(status)), true);
  assert.equal(api.definitiveMessageFailure(new Error('network')), false);
});
test('draft keys separate a customer across two different authorised jobs', () => {
  const { api } = harness();
  assert.notEqual(api.selectionKey({ kind: 'customer', customer: { customerId: 'one', workOrderId: 'job-a' } }), api.selectionKey({ kind: 'customer', customer: { customerId: 'one', workOrderId: 'job-b' } }));
});
test('live history merges pages and acknowledgements without duplicate messages', () => {
  const { api } = harness();
  const result = api.mergeTeamMessages([{ id: 'two', sequence: 2, body: 'old' }, { id: 'one', sequence: 1 }], [{ id: 'two', sequence: 2, body: 'new' }, { id: 'three', sequence: 3 }]);
  assert.deepEqual(result.map(value => value.id), ['one', 'two', 'three']);
  assert.equal(result[1].body, 'new');
});
test('SMS composer requires connection, mobile and consent and respects opt out', () => {
  const { api } = harness();
  const allowed = { connection: { status: 'connected' }, customerPhone: '+61400000000', consent: 'allowed' };
  assert.equal(api.smsSendBlock(allowed), '');
  assert.match(api.smsSendBlock({ ...allowed, connection: null }), /shared SMS number/);
  assert.match(api.smsSendBlock({ ...allowed, connection: { status: 'connecting' } }), /check the SMS/);
  assert.match(api.smsSendBlock({ ...allowed, customerPhone: '' }), /mobile number/);
  assert.match(api.smsSendBlock({ ...allowed, consent: 'required' }), /permission/);
  assert.match(api.smsSendBlock({ ...allowed, consent: 'opted_out' }), /opted out/);
});
test('notification lookup loads a specific thread beyond the first page with cancellation', async () => {
  const h = harness(); const controller = new AbortController();
  await h.api.messageThread('thread-99', controller.signal);
  assert.equal(h.requests[0].path, '/api/trade-messages?view=thread&threadId=thread-99');
  assert.equal(h.requests[0].init.signal, controller.signal);
});
test('native upload normalises audio MIME without RN Blob construction or File.slice', async () => {
  const { api } = harness();
  const bytes = new Uint8Array([1, 2, 3]);
  const file = { size: 3, type: 'audio/x-m4a', bytes: async () => bytes, arrayBuffer: () => { throw new Error('RN Blob path is forbidden'); }, slice: () => { throw new Error('File.slice constructs unsupported Blob'); }, text: async () => '', stream: () => null };
  const part = api.nativeMessageUploadPart(file, 'voice-note.m4a', 'audio/mp4');
  assert.equal(part.type, 'audio/mp4'); assert.equal(part.name, 'voice-note.m4a'); assert.equal(part.size, 3);
  assert.equal(await part.bytes(), bytes);
});
test('DM names exclude self and group labels remain the explicit group name', () => {
  const { api } = harness();
  const thread = { kind: 'dm', members: [{ id: 'self', name: 'Me' }, { id: 'other', name: 'John' }] };
  assert.equal(api.teamThreadName(thread, 'self'), 'John');
  assert.equal(api.teamThreadName({ ...thread, kind: 'group', subject: 'Installers' }, 'self'), 'Installers');
});
