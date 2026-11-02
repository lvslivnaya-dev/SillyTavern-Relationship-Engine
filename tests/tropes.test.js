import test from 'node:test';
import assert from 'node:assert/strict';
import { pairTropeFactors, pairTropes, triangleTropeFactors, triangleTropes } from '../src/integration/tropes.js';
import { applyOperations, createDefaultState, createOperation, selectRuntimePrompt } from '../src/core/index.js';

const SCALES = createDefaultState().config.scales.map(scale => scale.id);
const TRIANGLE = { id: 't', name: 'Тест', centerId: 'c', firstId: 'a', secondId: 'b' };

test('every pair trope yields valid factors on the default scales', () => {
  assert.ok(pairTropes().length >= 8);
  for (const trope of pairTropes()) {
    const factors = pairTropeFactors(trope.id, SCALES);
    assert.ok(factors.length >= 4, trope.id);
    assert.ok(factors.every(factor => SCALES.includes(factor.scaleId) && ['up', 'down'].includes(factor.direction) && factor.text.length <= 200));
    assert.ok(factors.some(factor => factor.direction === 'down'), `${trope.id}: есть и рост, и падение`);
  }
});

test('pair trope skips scales the chat does not have', () => {
  const factors = pairTropeFactors('slowburn', ['trust', 'love']);
  assert.ok(factors.every(factor => ['trust', 'love'].includes(factor.scaleId)));
  assert.ok(factors.length > 0);
});

test('triangle trope expands roles to both sides symmetrically and suggests a goal', () => {
  const result = triangleTropeFactors('love-triangle', TRIANGLE, SCALES);
  assert.ok(result.goal.length > 20);
  const lines = new Set(result.factors.map(factor => `${factor.from}>${factor.to}`));
  for (const line of ['a>c', 'b>c', 'a>b', 'b>a', 'c>a', 'c>b']) assert.ok(lines.has(line), line);
  assert.ok(result.factors.every(factor => factor.from !== factor.to));
});

test('triangle trope never writes factors for the persona\'s own feelings', () => {
  const result = triangleTropeFactors('love-triangle', { ...TRIANGLE, centerId: 'p' }, SCALES, 'p');
  assert.ok(result.factors.length > 0);
  assert.ok(result.factors.every(factor => factor.from !== 'p'));
  assert.ok(triangleTropes().every(trope => trope.goal));
});

test('triangle goal reaches the runtime prompt with a do-not-rush rule', () => {
  const state = applyOperations(createDefaultState(), ['c', 'a', 'b'].map(id => createOperation('entity.upsert', { id, name: id.toUpperCase() })));
  state.ui.triangles = [{ ...TRIANGLE, goal: 'C выбирает A' }];
  const text = selectRuntimePrompt(state, { maxCharacters: 4000 });
  assert.match(text, /long-term end point: C выбирает A — a distant direction/);
  assert.match(text, /never rush/);
});

test('new tropes: united front, fast passion, body first, both sides of violence', async () => {
  const { pairTropePace } = await import('../src/integration/tropes.js');
  const ids = pairTropes().map(trope => trope.id);
  for (const id of ['fast-passion', 'body-first', 'violence-victim', 'violence-aggressor']) assert.ok(ids.includes(id), id);
  assert.deepEqual(pairTropePace('body-first', SCALES), { attraction: 'fast', love: 'slow', trust: 'slow', affection: 'slow' });
  assert.equal(pairTropePace('fast-passion', SCALES).love, 'fast');
  assert.ok(pairTropes().every(trope => trope.description.length > 20), 'у каждого тропа есть описание');
  const united = triangleTropeFactors('united-front', TRIANGLE, SCALES).factors;
  assert.ok(united.some(factor => factor.from === 'a' && factor.to === 'b' && factor.scaleId === 'jealousy' && factor.direction === 'down'));
  assert.ok(!united.some(factor => factor.scaleId === 'jealousy' && factor.direction === 'up'), 'никакой ревности между сторонами');
});

test('pace: slow caps, fast amplifies, spills respect slow scales, rollback undoes it', async () => {
  const { applyAnalysisResult, pacedDelta } = await import('../src/integration/analysis-operations.js');
  const { parseAnalysis } = await import('../src/integration/analyzer.js');
  const { rollbackMessage } = await import('../src/core/index.js');
  assert.equal(pacedDelta(7, 'slow'), 2);
  assert.equal(pacedDelta(-7, 'slow'), -2);
  assert.equal(pacedDelta(6, 'fast'), 9);
  assert.equal(pacedDelta(20, 'fast'), 25);
  assert.equal(pacedDelta(5, undefined), 5);
  let state = applyOperations(createDefaultState(), [
    createOperation('entity.upsert', { id: 'a', name: 'A' }),
    createOperation('entity.upsert', { id: 'b', name: 'B' }),
    createOperation('relationship.upsert', { from: 'a', to: 'b' }),
  ]);
  const id = Object.keys(state.relationships)[0];
  state = applyOperations(state, [createOperation('factors.set', { relationshipId: id, factors: [], pace: { attraction: 'fast', love: 'slow', affection: 'slow' } })]);
  const result = parseAnalysis(JSON.stringify({ operations: [
    { subjectId: 'a', objectId: 'b', metric: 'attraction', delta: 6, reason: 'Близость' },
    { subjectId: 'a', objectId: 'b', metric: 'love', delta: 8, reason: 'Признание' },
  ] }));
  const applied = applyAnalysisResult(state, result, { messageId: '9' }).state;
  const scales = applied.relationships[id].scales;
  assert.equal(scales.attraction, 9, 'быстро: 6 × 1,5');
  assert.equal(scales.love, 2, 'медленно: не больше 2');
  assert.ok(Math.abs(scales.affection) <= 2, 'связанная шкала с медленным темпом тоже ограничена');
  assert.equal(rollbackMessage(applied, '9').relationships[id].scales.attraction, 0);
});

test('factor origin and pace survive the journal; an unknown origin is dropped', () => {
  let state = applyOperations(createDefaultState(), [
    createOperation('entity.upsert', { id: 'a', name: 'A' }),
    createOperation('entity.upsert', { id: 'b', name: 'B' }),
    createOperation('relationship.upsert', { from: 'a', to: 'b' }),
  ]);
  const id = Object.keys(state.relationships)[0];
  state = applyOperations(state, [createOperation('factors.set', { relationshipId: id, pace: { love: 'slow', ghost: 'fast' }, factors: [
    { scaleId: 'trust', direction: 'up', text: 'Тропный', origin: 'pair-trope:slowburn' },
    { scaleId: 'trust', direction: 'down', text: 'Странный', origin: '<script>' },
  ] })]);
  const relation = state.relationships[id];
  assert.equal(relation.factors[0].origin, 'pair-trope:slowburn');
  assert.equal(relation.factors[1].origin, undefined);
  assert.deepEqual(relation.pace, { love: 'slow' });
  state = applyOperations(state, [createOperation('factors.set', { relationshipId: id, factors: relation.factors })]);
  assert.deepEqual(state.relationships[id].pace, { love: 'slow' }, 'без pace в операции темп не сбрасывается');
});
