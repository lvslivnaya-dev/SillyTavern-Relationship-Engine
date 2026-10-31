import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultState, createOperation, applyOperations, selectRuntimePrompt } from '../src/core/index.js';
import { applyAnalysisResult } from '../src/integration/analysis-operations.js';
import { parseAnalysis } from '../src/integration/analyzer.js';

function setup(personaId = '') {
  let state = applyOperations(createDefaultState(), [
    createOperation('entity.upsert', { id: 'a', name: 'Анна' }),
    createOperation('entity.upsert', { id: 'b', name: 'Леон' }),
  ]);
  state = applyOperations(state, [
    createOperation('relationship.upsert', { from: 'a', to: 'b' }),
    createOperation('relationship.upsert', { from: 'b', to: 'a' }),
  ]);
  if (personaId) {
    state = structuredClone(state);
    state.ui.personaId = personaId;
  }
  return state;
}

test('prompt hides persona outgoing lines but keeps incoming', () => {
  const state = setup('a');
  const prompt = selectRuntimePrompt(state);
  assert.doesNotMatch(prompt, /Анна>Леон/);
  assert.match(prompt, /Леон>Анна/);
});

test('analysis skips persona-subject operations regardless of model output', () => {
  const state = setup('a');
  const result = parseAnalysis(JSON.stringify({
    operations: [
      { subjectId: 'a', objectId: 'b', metric: 'trust', delta: 5, reason: 'Персона доверяет' },
      { subjectId: 'b', objectId: 'a', metric: 'trust', delta: 4, reason: 'Леон доверяет' },
    ],
  }));
  const applied = applyAnalysisResult(state, result, { messageId: '2' });
  const outgoing = Object.values(applied.state.relationships).find(relation => relation.from === 'a' && relation.to === 'b');
  const incoming = Object.values(applied.state.relationships).find(relation => relation.from === 'b' && relation.to === 'a');
  assert.equal(outgoing.scales.trust, 0);
  assert.equal(incoming.scales.trust, 4);
  assert.equal(applied.operations.length, 1);
});
