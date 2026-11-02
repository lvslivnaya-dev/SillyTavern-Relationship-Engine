import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAuxModels, routedContext } from '../src/integration/llm.js';

const mainContext = () => ({ chat: [1, 2], generateRaw: async () => 'основной API', getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 't' }) });
const custom = (extra = {}) => ({ aux: { mode: 'custom', url: 'https://example.test/v1/', key: 'sk-1', model: 'cheap', purposes: {}, ...extra } });
const json = data => ({ ok: true, status: 200, text: async () => JSON.stringify(data) });

async function withFetch(fake, run) {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await run(); } finally { globalThis.fetch = original; }
}

test('aux off or purpose disabled keeps the main connection', async () => {
  const context = mainContext();
  assert.equal(routedContext(context, { aux: { mode: 'off' } }, 'analysis'), context);
  assert.equal(routedContext(context, custom({ purposes: { analysis: false } }), 'analysis'), context);
});

test('custom mode goes through the SillyTavern custom backend with the key as a header', async () => {
  const calls = [];
  const reply = await withFetch(async (url, init) => {
    calls.push({ url, init });
    return json({ choices: [{ message: { content: '{"ok":true}' } }] });
  }, () => routedContext(mainContext(), custom(), 'analysis').generateRaw({ prompt: [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }] }));
  assert.equal(reply, '{"ok":true}');
  assert.equal(calls[0].url, '/api/backends/chat-completions/generate');
  assert.equal(calls[0].init.headers['X-CSRF-Token'], 't', 'заголовки таверны (CSRF) передаются');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.chat_completion_source, 'custom');
  assert.equal(body.custom_url, 'https://example.test/v1');
  assert.deepEqual(JSON.parse(body.custom_include_headers), { Authorization: 'Bearer sk-1' });
  assert.equal(body.model, 'cheap');
  assert.deepEqual(body.messages.map(message => message.role), ['system', 'user']);
  assert.deepEqual(routedContext(mainContext(), custom(), 'analysis').chat, [1, 2], 'остальной контекст не тронут');
});

test('provider error is reported; fallback goes to the main API when allowed', async () => {
  const failing = async () => json({ error: { message: 'Unauthorized' } });
  await withFetch(failing, async () => {
    await assert.rejects(() => routedContext(mainContext(), custom(), 'analysis').generateRaw({ prompt: 'x' }), /Unauthorized/);
    assert.equal(await routedContext(mainContext(), custom({ fallbackToMain: true }), 'analysis').generateRaw({ prompt: 'x' }), 'основной API');
  });
});

test('profile mode uses the Connection Manager service', async () => {
  const context = { ...mainContext(), ConnectionManagerRequestService: { sendRequest: async (id, messages) => ({ content: `${id}:${messages[0].content}` }) } };
  const reply = await routedContext(context, { aux: { mode: 'profile', profileId: 'p1', purposes: {} } }, 'generation').generateRaw({ prompt: 'привет' });
  assert.equal(reply, 'p1:привет');
});

test('model list is read through the SillyTavern status endpoint', async () => {
  const models = await withFetch(async (url, init) => {
    assert.equal(url, '/api/backends/chat-completions/status');
    assert.equal(JSON.parse(init.body).custom_url, 'https://example.test/v1');
    return json({ data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }] });
  }, () => fetchAuxModels(mainContext(), 'https://example.test/v1/chat/completions', 'k'));
  assert.deepEqual(models, ['a', 'b']);
});
