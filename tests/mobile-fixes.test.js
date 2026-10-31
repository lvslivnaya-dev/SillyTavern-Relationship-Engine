import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleHistory } from '../src/integration/history.js';
import { extractBookText } from '../src/integration/lorebooks.js';
import { discoverHistoryCharacters } from '../src/integration/analyzer.js';

test('sampleHistory covers the whole chat, not only the beginning', () => {
  const messages = Array.from({ length: 200 }, (_, index) => ({ mes: `${index === 180 ? 'Диего появляется. ' : ''}${'x'.repeat(3000)}` }));
  const sample = sampleHistory(messages, 24000);
  const total = sample.reduce((sum, message) => sum + message.mes.length, 0);
  assert.ok(total <= 24000, `budget respected (${total})`);
  assert.equal(sample.at(-1).mes.slice(-10), messages.at(-1).mes.slice(-10), 'last message included');
  assert.ok(sample.length >= 30, 'many messages sampled across the chat');
  assert.ok(sample.some(message => messages.indexOf(message) === -1 && message.mes.includes('…')), 'long posts are excerpted');
});

test('extractBookText keeps every entry title and keys in a large book', () => {
  const entries = {};
  for (let index = 0; index < 150; index += 1) entries[index] = { comment: `Запись ${index}`, key: [`ключ${index}`], content: 'y'.repeat(500) };
  entries[149] = { comment: 'Диего', key: ['Диего', 'Diego'], content: 'Второй главный герой. ' + 'z'.repeat(800) };
  const text = extractBookText({ entries }, 16000);
  assert.match(text, /## Диего \[ключи: Диего, Diego\]/);
  assert.match(text, /Запись 0/);
});

test('discoverHistoryCharacters sends the character card to the model', async () => {
  let sent = '';
  const context = { generateRaw: async ({ prompt }) => { sent = prompt.at(-1).content; return '{"characters":[{"name":"Диего","aliases":[]}],"knownAliases":[]}'; } };
  const result = await discoverHistoryCharacters(context, [{ mes: 'Джейсон спал.' }], { analysisMaxCharacters: 500 }, [], '### Карточка «Джейсон»\nДиего — сосед по комнате.');
  assert.match(sent, /Диего — сосед по комнате/);
  assert.match(sent, /"spellings from this chat"\]\}\]\}/);
  assert.equal(result.characters[0].name, 'Диего');
});
