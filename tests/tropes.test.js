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
