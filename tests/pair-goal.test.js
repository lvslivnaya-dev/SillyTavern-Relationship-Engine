import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOperations, createDefaultState, createEntity, createOperation, importState, relationshipId, selectRuntimePrompt,
} from '../src/core/index.js';

const ran = createEntity('Ран');
const suzu = createEntity('Судзу');
const toSuzu = relationshipId(ran.id, suzu.id);
const toRan = relationshipId(suzu.id, ran.id);

function lines() {
  return applyOperations(createDefaultState(), [
    createOperation('entity.upsert', ran),
    createOperation('entity.upsert', suzu),
    createOperation('relationship.upsert', { from: ran.id, to: suzu.id }),
    createOperation('relationship.upsert', { from: suzu.id, to: ran.id }),
    createOperation('scale.set', { relationshipId: toSuzu, scaleId: 'trust', value: 20 }),
    createOperation('scale.set', { relationshipId: toRan, scaleId: 'trust', value: 20 }),
  ]);
}

test('each direction keeps its own end point', () => {
  const state = applyOperations(lines(), [
    createOperation('factors.set', { relationshipId: toSuzu, factors: [], goal: 'Ран признаёт её равной' }),
    createOperation('factors.set', { relationshipId: toRan, factors: [], goal: 'Судзу перестаёт его бояться' }),
  ]);
  assert.equal(toSuzu === toRan, false, 'two separate lines');
  assert.equal(state.relationships[toSuzu].goal, 'Ран признаёт её равной');
  assert.equal(state.relationships[toRan].goal, 'Судзу перестаёт его бояться');
});

test('saving factors without a goal (a triangle, an older operation) leaves the goal alone; empty clears it', () => {
  let state = applyOperations(lines(), [createOperation('factors.set', { relationshipId: toSuzu, factors: [], goal: 'Цель' })]);
  state = applyOperations(state, [createOperation('factors.set', { relationshipId: toSuzu, factors: [{ scaleId: 'trust', direction: 'up', text: 'Держит слово' }] })]);
  assert.equal(state.relationships[toSuzu].goal, 'Цель');
  state = applyOperations(state, [createOperation('factors.set', { relationshipId: toSuzu, factors: [], goal: '   ' })]);
  assert.equal(state.relationships[toSuzu].goal, undefined);
});

test('the prompt puts each end point on its own line only', () => {
  const state = applyOperations(lines(), [
    createOperation('factors.set', { relationshipId: toSuzu, factors: [], goal: 'Ран признаёт её равной' }),
  ]);
  const text = selectRuntimePrompt(state).text ?? String(selectRuntimePrompt(state));
  const ranLine = text.split('\n').find(line => line.startsWith('Ран>Судзу'));
  const suzuLine = text.split('\n').find(line => line.startsWith('Судзу>Ран'));
  assert.match(ranLine, /endpoint=Ран признаёт её равной/);
  assert.doesNotMatch(suzuLine ?? '', /endpoint=/);
});

test('a goal survives export and import', () => {
  const state = applyOperations(lines(), [createOperation('factors.set', { relationshipId: toRan, factors: [], goal: 'Доверяет без оглядки' })]);
  assert.equal(importState(JSON.stringify(state)).relationships[toRan].goal, 'Доверяет без оглядки');
});
