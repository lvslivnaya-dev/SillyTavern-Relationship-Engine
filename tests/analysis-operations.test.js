import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAnalysisResult } from '../src/integration/analysis-operations.js';
import { createDefaultState, createOperation, applyOperations, rollbackMessage, importState } from '../src/core/index.js';
import { parseAnalysis } from '../src/integration/analyzer.js';

function setup() {
  return applyOperations(createDefaultState(), [
    createOperation('entity.upsert', { id: 'a', name: 'Анна' }),
    createOperation('entity.upsert', { id: 'b', name: 'Леон' }),
    createOperation('entity.upsert', { id: 'c', name: 'Мира' }),
  ]);
}

test('analysis records friendship, memories and tensions with message rollback', () => {
  const result = parseAnalysis(JSON.stringify({
    operations: [{ subjectId: 'a', objectId: 'b', metric: 'friendship', delta: 3, reason: 'Помогла' }],
    memories: [{ subjectId: 'b', objectId: 'a', text: 'Анна помогла', intensity: 4 }],
    tensions: [{ subjectId: 'c', objectId: 'a', text: 'Боится остаться в стороне', intensity: 3 }],
  }));
  const applied = applyAnalysisResult(setup(), result, { messageId: '1' });
  assert.equal(applied.operations.length, 3);
  assert.equal(Object.values(applied.state.relationships).length, 3);
  assert.ok(Object.values(applied.state.relationships).some(relation => relation.memories.length === 1));
  const rolled = rollbackMessage(applied.state, '1');
  assert.ok(Object.values(rolled.relationships).every(relation => relation.memories.length === 0 && relation.tensions.length === 0));
  assert.doesNotThrow(() => importState(applied.state));
});

test('legacy scale config is expanded on import without losing existing values', () => {
  let state = createDefaultState({ scales: [{ id: 'affection', label: 'Привязанность', default: 0 }] });
  state = applyOperations(state, [
    createOperation('entity.upsert', { id: 'a', name: 'Анна' }),
    createOperation('entity.upsert', { id: 'b', name: 'Леон' }),
    createOperation('relationship.upsert', { from: 'a', to: 'b' }),
  ]);
  const imported = importState(state);
  assert.equal(imported.config.scales.length, 11);
  assert.equal(Object.values(imported.relationships)[0].scales.friendship, 0);
  assert.equal(Object.values(imported.relationships)[0].scales.love, 0);
});

test('confirmed scene characters are registered and referenced by scene name', () => {
  const state = applyOperations(createDefaultState(), [
    createOperation('entity.upsert', { id: 'a', name: 'Анна' }),
  ]);
  const result = parseAnalysis(JSON.stringify({
    newCharacters: [{ name: 'Марк', aliases: ['Mark'], note: 'Странствующий торговец' }],
    operations: [{ subjectId: 'Марк', objectId: 'Анна', metric: 'trust', delta: 2, reason: 'Поделился картой' }],
  }));
  const accepted = result.newCharacters;
  const applied = applyAnalysisResult(state, result, { messageId: '3' }, accepted);
  const markEntity = Object.values(applied.state.entities).find(entity => entity.name === 'Марк');
  assert.ok(markEntity, 'Марк должен быть зарегистрирован');
  const relation = Object.values(applied.state.relationships)
    .find(item => item.from === markEntity.id && item.to === 'a');
  assert.ok(relation, 'линия Марк → Анна должна существовать');
  assert.equal(relation.scales.trust, 2);
  assert.doesNotThrow(() => importState(applied.state));
});

test('unconfirmed scene characters are ignored and their operations dropped', () => {
  const state = applyOperations(createDefaultState(), [
    createOperation('entity.upsert', { id: 'a', name: 'Анна' }),
  ]);
  const result = parseAnalysis(JSON.stringify({
    newCharacters: [{ name: 'Марк', aliases: [], note: '' }],
    operations: [{ subjectId: 'Марк', objectId: 'Анна', metric: 'trust', delta: 5, reason: 'Test' }],
  }));
  const applied = applyAnalysisResult(state, result, { messageId: '4' }, []);
  assert.equal(Object.keys(applied.state.relationships).length, 0);
  assert.equal(Object.values(applied.state.entities).length, 1);
});

test('love and attraction feed each other with a capped coupled delta', () => {
  const state = applyOperations(createDefaultState(), [
    createOperation('entity.upsert', { id: 'a', name: 'Анна' }),
    createOperation('entity.upsert', { id: 'b', name: 'Леон' }),
  ]);
  const strong = parseAnalysis(JSON.stringify({
    operations: [{ subjectId: 'a', objectId: 'b', metric: 'attraction', delta: 20, reason: 'Ночь вместе' }],
  }));
  const appliedStrong = applyAnalysisResult(state, strong, { messageId: '5' });
  const relation = Object.values(appliedStrong.state.relationships)[0];
  assert.equal(relation.scales.attraction, 20);
  assert.equal(relation.scales.love, 3, 'крупное влечение подталкивает любовь, но не на четверть из-за потолка');
  assert.equal(appliedStrong.operations.length, 2, 'связанная дельта журналируется отдельно');

  const weak = parseAnalysis(JSON.stringify({
    operations: [{ subjectId: 'a', objectId: 'b', metric: 'love', delta: 2, reason: 'Тихий вечер' }],
  }));
  const appliedWeak = applyAnalysisResult(state, weak, { messageId: '6' });
  const weakRelation = Object.values(appliedWeak.state.relationships)[0];
  assert.equal(weakRelation.scales.attraction, 0, 'малые дельты не создают связанного изменения');
  assert.equal(appliedWeak.operations.length, 1);
});
