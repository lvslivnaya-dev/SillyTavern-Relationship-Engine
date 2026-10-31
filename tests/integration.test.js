import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMessage, parseAnalysis, parseCharacters, parseModelObject, discoverHistoryCharacters } from '../src/integration/analyzer.js';
import { mergeMissing } from '../src/integration/settings.js';

test('parseAnalysis accepts fenced JSON and filters unsafe operations', () => {
  const result = parseAnalysis(`\n\`\`\`json\n{
    "participants": ["anna", "leon"],
    "operations": [
      {"subjectId":"leon","objectId":"anna","metric":"trust","delta":3,"reason":"Shared a secret"},
      {"subjectId":"leon","objectId":"anna","metric":"trust","delta":200,"reason":"Invalid jump"}
    ]
  }\n\`\`\``);

  assert.deepEqual(result.participants, ['anna', 'leon']);
  assert.equal(result.operations.length, 1);
  assert.equal(result.operations[0].delta, 3);
});

test('parseAnalysis merges duplicate metric changes deterministically', () => {
  const result = parseAnalysis(JSON.stringify({
    participants: ['anna', 'leon'],
    operations: [
      { subjectId: 'leon', objectId: 'anna', metric: 'trust', delta: 2, reason: 'First', confidence: 0.9 },
      { subjectId: 'leon', objectId: 'anna', metric: 'trust', delta: 3, reason: 'Second', confidence: 0.7 },
    ],
  }));
  assert.equal(result.operations.length, 1);
  assert.equal(result.operations[0].delta, 5);
  assert.match(result.operations[0].reason, /First; Second/);
});

test('mergeMissing preserves user values and fills nested defaults', () => {
  const settings = { enabled: false, widget: { x: 10 } };
  mergeMissing(settings, { enabled: true, widget: { x: null, y: 20 } });
  assert.deepEqual(settings, { enabled: false, widget: { x: 10, y: 20 } });
});

test('parseCharacters normalizes and deduplicates discovered roster', () => {
  const characters = parseCharacters('```json\n{"characters":[{"name":" Леон ","aliases":["Лео","Лео",""]},{"name":"леон","aliases":[]},{"name":"Анна","aliases":["Аня"]}]}\n```');
  assert.deepEqual(characters, [
    { name: 'Леон', aliases: ['Лео'] },
    { name: 'Анна', aliases: ['Аня'] },
  ]);
});

test('history discovery receives the registry and separates new characters from known aliases', async () => {
  const requests = [];
  const context = { async generateRaw(request) {
    requests.push(request);
    return JSON.stringify({
      characters: [{ name: 'Марко', aliases: ['Marco'] }],
      knownAliases: [{ id: 'entity:zoro', aliases: ['Зоро', 'Ророноа'] }, { id: 'ghost', aliases: [] }],
    });
  } };
  const result = await discoverHistoryCharacters(context, [{ mes: 'Зоро и Марко дрались.' }], { analysisMaxCharacters: 500 }, [
    { id: 'entity:zoro', name: 'Zoro', aliases: ['Roronoa'] },
  ]);
  assert.equal(requests.length, 1);
  const prompt = requests[0].prompt.map(part => part.content).join('\n');
  assert.match(prompt, /KNOWN REGISTRY/);
  assert.match(prompt, /entity:zoro = Zoro \(Roronoa\)/);
  assert.deepEqual(result.characters, [{ name: 'Марко', aliases: ['Marco'] }]);
  assert.deepEqual(result.knownAliases, [{ id: 'entity:zoro', aliases: ['Зоро', 'Ророноа'] }], 'несуществующие ID и пустые алиасы отбрасываются');
});

test('parser ignores reasoning and respects braces inside JSON strings', () => {
  const parsed = parseModelObject('<think>Example {broken}</think>\n```json\n{"operations":[],"note":"a } and \\\"quote\\\""}\n```\nComment {bad}');
  assert.deepEqual(parsed.operations, []);
  assert.match(parsed.note, /a }/);
});

test('analyzer retries malformed arrays once and never overrides global response length', async () => {
  const requests = [];
  const context = { async generateRaw(request) {
    requests.push(request);
    return requests.length === 1
      ? '{"participants":["a" "b"],"operations":[]}'
      : '{"participants":["a","b"],"operations":[]}';
  } };
  const result = await analyzeMessage(context, { entities: {} }, { mes: 'Scene' }, { analysisMaxCharacters: 100 });
  assert.equal(requests.length, 2);
  // TempResponseLength in SillyTavern mutates the global max tokens setting;
  // the analyzer must never pass responseLength to avoid corrupting parallel generations.
  assert.ok(requests.every(request => request.responseLength === undefined));
  assert.match(requests[1].prompt.at(-1).content, /valid for the requested JSON schema/);
  assert.deepEqual(result.participants, ['a', 'b']);
});

test('analyzer rejects two malformed answers without unbounded retries', async () => {
  let requests = 0;
  const context = { async generateRaw() { requests += 1; return '{"operations":['; } };
  await assert.rejects(analyzeMessage(context, { entities: {} }, { mes: 'Scene' }, { analysisMaxCharacters: 100 }), /дважды/);
  assert.equal(requests, 2);
});
