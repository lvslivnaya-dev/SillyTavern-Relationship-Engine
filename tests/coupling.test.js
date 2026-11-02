import test from 'node:test';
import assert from 'node:assert/strict';
import { coupledDeltas } from '../src/integration/coupling.js';
import { applyAnalysisResult } from '../src/integration/analysis-operations.js';
import { parseAnalysis } from '../src/integration/analyzer.js';
import { applyOperations, createDefaultState, createOperation, rollbackMessage } from '../src/core/index.js';

const ALL = new Set(createDefaultState().config.scales.map(scale => scale.id));

function pair() {
  return applyOperations(createDefaultState(), [
    createOperation('entity.upsert', { id: 'a', name: 'Анна' }),
    createOperation('entity.upsert', { id: 'b', name: 'Леон' }),
  ]);
}

test('growing affection warms friendship and trust by a small share', () => {
  assert.deepEqual(coupledDeltas('affection', 6, ALL), [
    { scaleId: 'friendship', value: 2 },
    { scaleId: 'trust', value: 1 },
  ]);
});

test('declining trust breeds resentment and cools friendship', () => {
  const spills = Object.fromEntries(coupledDeltas('trust', -10, ALL).map(spill => [spill.scaleId, spill.value]));
  assert.equal(spills.resentment, 3);
  assert.equal(spills.friendship, -2);
});

test('small changes, hidden and already evidenced scales do not spill', () => {
  assert.deepEqual(coupledDeltas('affection', 2, ALL), []);
  assert.deepEqual(coupledDeltas('affection', 6, new Set(['affection', 'trust'])), [{ scaleId: 'trust', value: 1 }]);
  assert.deepEqual(coupledDeltas('affection', 6, ALL, new Set(['friendship'])), [{ scaleId: 'trust', value: 1 }]);
});

test('spills are capped and never chain', () => {
  assert.deepEqual(coupledDeltas('love', 25, ALL).find(spill => spill.scaleId === 'affection'), { scaleId: 'affection', value: 4 });
  const result = parseAnalysis(JSON.stringify({ operations: [{ subjectId: 'a', objectId: 'b', metric: 'love', delta: 10, reason: 'Признание' }] }));
  const applied = applyAnalysisResult(pair(), result, { messageId: '3' });
  const relation = Object.values(applied.state.relationships)[0];
  assert.equal(relation.scales.love, 10);
  assert.equal(relation.scales.affection, 4);
  assert.equal(relation.scales.friendship, 0, 'привязанность от любви не тянет дружбу дальше по цепочке');
  assert.ok(applied.operations.slice(1).every(operation => operation.reason.startsWith('Связанная шкала')));
  const rolled = rollbackMessage(applied.state, '3');
  assert.ok(Object.values(Object.values(rolled.relationships)[0].scales).every(value => value === 0), 'откат сообщения убирает и связанные изменения');
});

test('hidden scales on a line are ignored by analysis and spills', () => {
  let state = applyOperations(pair(), [createOperation('relationship.upsert', { from: 'a', to: 'b' })]);
  const id = Object.keys(state.relationships)[0];
  state = applyOperations(state, [createOperation('scales.hide', { relationshipId: id, hiddenScales: ['trust', 'love'] })]);
  const result = parseAnalysis(JSON.stringify({ operations: [
    { subjectId: 'a', objectId: 'b', metric: 'love', delta: 8, reason: 'Скрытая шкала' },
    { subjectId: 'a', objectId: 'b', metric: 'affection', delta: 6, reason: 'Тепло' },
  ] }));
  const relation = applyAnalysisResult(state, result, { messageId: '4' }).state.relationships[id];
  assert.equal(relation.scales.love, 0);
  assert.equal(relation.scales.trust, 0);
  assert.equal(relation.scales.affection, 6);
  assert.equal(relation.scales.friendship, 2);
});

test('analyzer drops zero deltas and low-confidence guesses', () => {
  const result = parseAnalysis(JSON.stringify({ operations: [
    { subjectId: 'a', objectId: 'b', metric: 'trust', delta: 0, reason: 'Ничего' },
    { subjectId: 'a', objectId: 'b', metric: 'love', delta: 5, reason: 'Догадка', confidence: 0.2 },
    { subjectId: 'a', objectId: 'b', metric: 'respect', delta: 3, reason: 'Видно в сцене', confidence: 0.8 },
    { subjectId: 'a', objectId: 'b', metric: 'fear', delta: 2, reason: 'Без уверенности' },
  ] }));
  assert.deepEqual(result.operations.map(operation => operation.metric), ['respect', 'fear']);
});

test('runtime prompt omits hidden scales and never demands feelings in every reply', async () => {
  const { selectRuntimePrompt } = await import('../src/core/index.js');
  const { wrapPrompt } = await import('../src/integration/prompt.js');
  let state = applyOperations(pair(), [createOperation('relationship.upsert', { from: 'a', to: 'b', scales: { trust: 40, hostility: 50 } })]);
  const id = Object.keys(state.relationships)[0];
  state = applyOperations(state, [createOperation('scales.hide', { relationshipId: id, hiddenScales: ['trust'] })]);
  const text = selectRuntimePrompt(state);
  assert.match(text, /hostility=50/);
  assert.doesNotMatch(text, /trust=/);
  const wrapped = wrapPrompt(text);
  assert.doesNotMatch(wrapped, /MANDATORY|is a failure/);
  assert.match(wrapped, /Negative feelings/);
});

test('hiding every scale of a line is refused', () => {
  const state = applyOperations(pair(), [createOperation('relationship.upsert', { from: 'a', to: 'b' })]);
  const id = Object.keys(state.relationships)[0];
  assert.throws(() => applyOperations(state, [createOperation('scales.hide', { relationshipId: id, hiddenScales: [...ALL] })]), /At least one scale/);
});
