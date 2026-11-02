import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperations, createDefaultState, createOperation, importState, rollbackMessage } from '../src/core/index.js';

function setup() {
  return applyOperations(createDefaultState(), [
    createOperation('entity.upsert', { id: 'a', name: 'Анна' }),
    createOperation('entity.upsert', { id: 'b', name: 'Леон' }),
    createOperation('entity.upsert', { id: 'c', name: 'Мира' }),
    createOperation('memory.add', { shared: true, item: { id: 'm1', text: 'Поцелуй под дождём', intensity: 3, participantIds: ['a', 'b'], knownBy: ['a', 'b'] } }, { messageId: '7' }),
  ]);
}

test('record.update edits text, intensity, participants and who knows', () => {
  const state = applyOperations(setup(), [createOperation('record.update', {
    kind: 'memory', shared: true, itemId: 'm1',
    changes: { text: 'Поцелуй под дождём у вокзала', intensity: 5, participantIds: ['a', 'b'], knownBy: ['c'] },
  })]);
  const item = state.records.memories[0];
  assert.equal(item.text, 'Поцелуй под дождём у вокзала');
  assert.equal(item.intensity, 5);
  assert.deepEqual(item.knownBy, ['a', 'b', 'c'], 'участники всегда знают о своём событии');
  assert.doesNotThrow(() => importState(state), 'правка проходит проверку журнала');
});

test('record.update after its record was rolled back is a harmless no-op', () => {
  const edited = applyOperations(setup(), [createOperation('record.update', { kind: 'memory', shared: true, itemId: 'm1', changes: { text: 'Новый текст' } })]);
  const rolled = rollbackMessage(edited, '7');
  assert.equal(rolled.records.memories.length, 0);
  assert.doesNotThrow(() => importState(rolled));
});

test('record.update rejects empty text and unknown characters', () => {
  assert.throws(() => applyOperations(setup(), [createOperation('record.update', { kind: 'memory', shared: true, itemId: 'm1', changes: { text: '   ' } })]), /text is required/);
  assert.throws(() => applyOperations(setup(), [createOperation('record.update', { kind: 'memory', shared: true, itemId: 'm1', changes: { knownBy: ['ghost'] } })]), /Unknown record participant/);
});
