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
