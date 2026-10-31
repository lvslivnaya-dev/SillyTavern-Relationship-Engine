import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryBatches, rebuildWithoutAutomaticHistory, historyFingerprint } from '../src/integration/history.js';
import { createDefaultState, applyOperations, createOperation, importState } from '../src/core/index.js';

test('history batching includes the tail of oversized messages and bounds every request', () => {
  const batches = createHistoryBatches([{ mes: 'a'.repeat(1700) + 'UNIQUE_END' }, { mes: 'LAST_MESSAGE', is_user: true }], 512);
  assert.ok(batches.every(batch => batch.length <= 512));
  assert.match(batches.join(''), /UNIQUE_END/);
  assert.match(batches.join(''), /LAST_MESSAGE/);
  assert.equal((batches.join('').match(/a/g) || []).length, 1700 + (batches.join('').match(/message/g) || []).length);
});

test('repeated history rebuild retains discovered registry and structural relationships', () => {
  let state = createDefaultState();
  state = applyOperations(state, [
    createOperation('entity.upsert', { id: 'a', name: 'Анна' }, { id: 'a', transactionId: 'history-import' }),
    createOperation('entity.upsert', { id: 'b', name: 'Леон' }, { id: 'b' }),
    createOperation('relationship.upsert', { from: 'a', to: 'b', id: 'pair' }, { id: 'pair' }),
    createOperation('scale.delta', { relationshipId: 'pair', scaleId: 'trust', value: 8 }, { id: 'old-import', transactionId: 'history-import' }),
    createOperation('scale.set', { relationshipId: 'pair', scaleId: 'respect', value: 22 }, { id: 'manual' }),
  ]);
  const rebuilt = rebuildWithoutAutomaticHistory(state);
  assert.equal(rebuilt.relationships.pair.scales.trust, 0);
  assert.equal(rebuilt.relationships.pair.scales.respect, 22);
  assert.equal(rebuilt.entities.a.name, 'Анна');
  assert.doesNotThrow(() => importState(rebuilt));
});

test('history fingerprint ignores metadata but detects edits and ordering', () => {
  const chat = [{ mes: 'First' }, { mes: 'Second', is_user: true }];
  assert.equal(historyFingerprint(chat), historyFingerprint(chat.map(message => ({ ...message, extra: { analysis: true } }))));
  assert.notEqual(historyFingerprint(chat), historyFingerprint([...chat].reverse()));
});
