import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperations, createDefaultState, createOperation, selectRuntimePrompt } from '../src/core/index.js';
import { applyAnalysisResult } from '../src/integration/analysis-operations.js';
import { parseAnalysis } from '../src/integration/analyzer.js';

function setup() {
  const state = applyOperations(createDefaultState(), [
    createOperation('entity.upsert', { id: 'a', name: 'Анна' }),
    createOperation('entity.upsert', { id: 'b', name: 'Леон' }),
    createOperation('entity.upsert', { id: 'p', name: 'Ева' }),
    createOperation('relationship.upsert', { from: 'b', to: 'a', scales: { trust: 30 }, factors: [{ scaleId: 'trust', direction: 'up', text: 'Держит слово' }] }),
    createOperation('memory.add', { shared: true, item: { id: 'm1', text: 'Ночь у костра', participantIds: ['a', 'b'], knownBy: ['a', 'b'] } }),
    createOperation('tension.add', { shared: true, item: { id: 't1', text: 'Спор о долге', participantIds: ['a', 'b'], knownBy: ['a', 'b'] } }),
  ]);
  state.ui.personaId = 'p';
  return state;
}

test('runtime prompt respects the memories / tensions / factors switches', () => {
  const full = selectRuntimePrompt(setup());
  assert.match(full, /Ночь у костра/);
  assert.match(full, /Спор о долге/);
  assert.match(full, /grow\[/);
  const trimmed = selectRuntimePrompt(setup(), { includeMemories: false, includeTensions: false, includeFactors: false });
  assert.doesNotMatch(trimmed, /Ночь у костра|Спор о долге|grow\[/);
  assert.match(trimmed, /trust=30/, 'шкалы остаются');
});

test('strangers flag adds a mutual "not introduced" line', () => {
  const state = setup();
  state.ui.strangerPairs = ['a|p'];
  const text = selectRuntimePrompt(state);
  assert.match(text, /strangers\[Анна & Ева\]: not introduced yet/);
});

test('allowNewPair blocks new lines but keeps changes on existing ones', () => {
  const result = parseAnalysis(JSON.stringify({ operations: [
    { subjectId: 'b', objectId: 'a', metric: 'trust', delta: 2, reason: 'Помог' },
    { subjectId: 'a', objectId: 'b', metric: 'respect', delta: 2, reason: 'Новая линия' },
    { subjectId: 'a', objectId: 'p', metric: 'trust', delta: 2, reason: 'Линия к персоне' },
  ] }));
  const applied = applyAnalysisResult(setup(), result, { messageId: '1' }, [], {
    allowNewPair: (subjectId, objectId) => objectId === 'p',
  });
  const lines = Object.values(applied.state.relationships).map(relation => `${relation.from}>${relation.to}`).sort();
  assert.deepEqual(lines, ['a>p', 'b>a']);
  assert.equal(Object.values(applied.state.relationships).find(relation => relation.from === 'b').scales.trust, 32);
});

test('budget keeps rules, the strongest lines and recent records instead of cutting the tail', () => {
  const operations = [createOperation('entity.upsert', { id: 'p', name: 'Ева' })];
  for (let index = 0; index < 12; index += 1) {
    operations.push(createOperation('entity.upsert', { id: `c${index}`, name: `Герой${index}` }));
    operations.push(createOperation('relationship.upsert', { from: `c${index}`, to: 'p', scales: { affection: index * 5 }, factors: [{ scaleId: 'trust', direction: 'up', text: 'x'.repeat(150) }] }));
  }
  for (let index = 0; index < 20; index += 1) {
    operations.push(createOperation('memory.add', { shared: true, item: { id: `m${index}`, text: `Память ${index} ${'y'.repeat(150)}`, participantIds: ['c0', 'p'], createdAt: new Date(2026, 0, 1, 0, index).toISOString() } }));
  }
  const state = applyOperations(createDefaultState(), operations);
  state.ui.personaId = 'p';
  state.ui.strangerPairs = ['c11|p'];
  const text = selectRuntimePrompt(state, { maxCharacters: 3000 });
  assert.ok(text.length <= 3000, `бюджет соблюдён (${text.length})`);
  assert.match(text, /^strangers\[Герой11 & Ева\]/, 'правила идут первыми и не обрезаются');
  assert.match(text, /Герой11>Ева/, 'самая сильная линия на месте');
  assert.doesNotMatch(text, /Герой0>Ева/, 'отбрасывается самая слабая');
  assert.match(text, /Память 19/, 'свежая запись на месте');
  assert.doesNotMatch(text, /Память 0 /, 'старая запись уступила место');
});

test('a deleted line can be created again by analysis', () => {
  const result = parseAnalysis(JSON.stringify({ operations: [{ subjectId: 'a', objectId: 'p', metric: 'trust', delta: 3, reason: 'Помогла' }] }));
  const first = applyAnalysisResult(setup(), result, { messageId: '1' }).state;
  const line = Object.values(first.relationships).find(relation => relation.from === 'a' && relation.to === 'p');
  const removed = applyOperations(first, [createOperation('relationship.remove', { relationshipId: line.id })]);
  const again = applyAnalysisResult(removed, result, { messageId: '2' }).state;
  assert.equal(Object.values(again.relationships).find(relation => relation.from === 'a' && relation.to === 'p')?.scales.trust, 3);
});
