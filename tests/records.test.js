import test from 'node:test';
import assert from 'node:assert/strict';
import { collectRecords, filterRecords, triangleEdges } from '../src/core/records.js';
import { createDefaultState, createOperation, applyOperations, applyOperation, rollbackMessage, importState, selectRuntimePrompt, relationshipId } from '../src/core/index.js';
import { applyAnalysisResult } from '../src/integration/analysis-operations.js';
import { parseAnalysis } from '../src/integration/analyzer.js';

test('common personal pair and company records filter without copies', () => {
  const items = [
    { id: 'all', participantIds: [] }, { id: 'a', participantIds: ['a'] },
    { id: 'ab', participantIds: ['a', 'b'] }, { id: 'abc', participantIds: ['a', 'b', 'c'] },
  ];
  assert.equal(filterRecords(items, { characterId: 'b' }).length, 3);
  assert.equal(filterRecords(items, { relationshipId: 'ab', pairIds: ['a', 'b'] }).length, 3);
  assert.equal(filterRecords(items).length, 4);
});

test('shared analyzer records survive import and roll back with their source message', () => {
  const state = applyOperations(createDefaultState(), ['a', 'b', 'c'].map(id => createOperation('entity.upsert', { id, name: id })));
  const result = parseAnalysis(JSON.stringify({ operations: [], memories: [{ participantIds: ['a', 'b', 'c'], text: 'Совместная поездка', intensity: 4 }], tensions: [{ participantIds: ['a'], text: 'Боится потерять друзей', intensity: 3 }] }));
  const applied = applyAnalysisResult(state, result, { messageId: '1' }).state;
  assert.equal(collectRecords(importState(applied), 'memories').length, 1);
  assert.equal(Object.keys(applied.relationships).length, 0);
  const rolled = rollbackMessage(applied, '1');
  assert.equal(collectRecords(rolled, 'memories').length, 0);
});

test('triangle produces three undirected edges around explicit center', () => {
  assert.deepEqual(triangleEdges('center', 'a', 'b'), [['a', 'center'], ['b', 'center'], ['a', 'b']]);
  assert.throws(() => triangleEdges('a', 'a', 'b'), /разных/);
});

test('relationship.remove deletes the line with its records and survives replay validation', () => {
  let state = applyOperations(createDefaultState(), [
    createOperation('entity.upsert', { id: 'a', name: 'Анна' }),
    createOperation('entity.upsert', { id: 'b', name: 'Леон' }),
    createOperation('relationship.upsert', { from: 'a', to: 'b' }),
    createOperation('scale.set', { relationshipId: relationshipId('a', 'b'), scaleId: 'trust', value: 50 }, { id: 'set' }),
  ]);
  state = structuredClone(state);
  state.ui.activeRelationshipId = relationshipId('a', 'b');
  const removed = applyOperation(state, createOperation('relationship.remove', {
    relationshipId: relationshipId('a', 'b'),
  }, { id: 'remove-line', reason: 'Ручное удаление' }));
  assert.equal(Object.keys(removed.relationships).length, 0);
  assert.equal(removed.ui.activeRelationshipId, '');
  assert.equal(removed.entities.a.name, 'Анна');
  assert.doesNotThrow(() => importState(removed));
});

test('record.toggle excludes a record from the runtime prompt without deleting it', () => {
  let state = applyOperations(createDefaultState(), ['a', 'b'].map(id => createOperation('entity.upsert', { id, name: id })));
  state = applyOperations(state, [
    createOperation('relationship.upsert', { from: 'a', to: 'b' }),
    createOperation('memory.add', { relationshipId: relationshipId('a', 'b'), item: { id: 'm1', text: 'Тихий вечер' } }, { id: 'add-m1' }),
  ]);
  assert.match(selectRuntimePrompt(state, {}), /Тихий вечер/);
  const toggled = applyOperation(state, createOperation('record.toggle', {
    kind: 'memory', relationshipId: relationshipId('a', 'b'), itemId: 'm1', disabled: true,
  }, { id: 'toggle-m1', reason: 'Отключено' }));
  assert.doesNotMatch(selectRuntimePrompt(toggled, {}), /Тихий вечер/, 'отключённая запись не попадает в промпт');
  assert.equal(toggled.relationships[relationshipId('a', 'b')].memories.length, 1, 'запись остаётся в данных');
  assert.doesNotThrow(() => importState(toggled));
  const reenabled = applyOperation(toggled, createOperation('record.toggle', {
    kind: 'memory', relationshipId: relationshipId('a', 'b'), itemId: 'm1', disabled: false,
  }, { id: 'toggle-m1-on' }));
  assert.match(selectRuntimePrompt(reenabled, {}), /Тихий вечер/);
});

test('entity.remove drops the character, its lines and shared-record mentions', () => {
  let state = applyOperations(createDefaultState(), [
    createOperation('entity.upsert', { id: 'a', name: 'Анна' }),
    createOperation('entity.upsert', { id: 'b', name: 'Леон' }),
    createOperation('entity.upsert', { id: 'c', name: 'Мира' }),
    createOperation('relationship.upsert', { from: 'a', to: 'b' }),
    createOperation('relationship.upsert', { from: 'b', to: 'c' }),
    createOperation('memory.add', { shared: true, item: { id: 'm1', text: 'Ужин втроём', participantIds: ['a', 'b', 'c'] } }, { id: 'mem' }),
  ]);
  state = structuredClone(state);
  state.ui.triangles = [{ id: 't1', centerId: 'c', firstId: 'a', secondId: 'b' }];
  const removed = applyOperation(state, createOperation('entity.remove', { entityId: 'c' }, { id: 'remove-c', reason: 'Дубль' }));
  assert.equal(removed.entities.c, undefined);
  assert.equal(Object.keys(removed.relationships).length, 1, 'остаётся только линия Анна-Леон');
  assert.deepEqual(removed.records.memories[0].participantIds, ['a', 'b']);
  assert.deepEqual(removed.ui.triangles, [], 'треугольник с удалённым персонажем исчезает');
  assert.doesNotThrow(() => importState(removed));
});

test('knownBy defaults to participants and narrows prompt disclosure', () => {
  const state = applyOperations(createDefaultState(), ['a', 'b', 'c'].map(id => createOperation('entity.upsert', { id, name: id })));
  state.entities.a.name = 'Анна'; state.entities.b.name = 'Леон'; state.entities.c.name = 'Мира';
  const shared = { id: 'secret', text: 'Тайна семьи', participantIds: ['a'], knownBy: ['a', 'b'] };
  const normalized = collectRecords({ ...state, records: { memories: [shared], tensions: [] } }, 'memories')[0];
  assert.deepEqual(normalized.knownBy, ['a', 'b']);
  const prompt = selectRuntimePrompt({ ...state, records: { memories: [shared], tensions: [] }, relationships: {} });
  assert.match(prompt, /shared-memories\[Анна\]=Тайна семьи \[known only to: Анна,Леон\]/);
  assert.match(prompt, /secret from Мира/);
  const fallback = collectRecords({ ...state, records: { memories: [{ id: 'open', text: 'x', participantIds: ['a','b'] }], tensions: [] } }, 'memories')[0];
  assert.deepEqual(fallback.knownBy, ['a', 'b']);
});
