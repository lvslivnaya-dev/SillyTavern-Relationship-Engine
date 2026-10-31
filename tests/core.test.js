import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCHEMA_VERSION,
  applyOperation,
  applyOperations,
  clamp,
  createDefaultState,
  createEntity,
  createOperation,
  createRelationship,
  createSnapshot,
  exportState,
  importState,
  migrateState,
  normalizeAlias,
  reapplyMessage,
  relationshipId,
  resolveEntityId,
  restoreSnapshot,
  rollbackMessage,
  rollbackTransaction,
  selectRuntimePrompt,
  stableId,
  uniqueId,
  validateState,
} from '../src/core/index.js';

function setupState(scales) {
  let state = createDefaultState(scales ? { scales } : undefined);
  const alice = createEntity('Alice', { aliases: ['Ally'] });
  const bob = createEntity('Bob');
  state = applyOperations(state, [
    createOperation('entity.upsert', alice, { id: 'setup:alice' }),
    createOperation('entity.upsert', bob, { id: 'setup:bob' }),
    createOperation('relationship.upsert', { from: alice.id, to: bob.id }, { id: 'setup:rel' }),
  ]);
  return { state, alice, bob, relationId: relationshipId(alice.id, bob.id) };
}

test('default state is valid schema v1 with independent scale defaults', () => {
  const first = createDefaultState();
  const second = createDefaultState();
  assert.equal(first.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(first.entities, {});
  assert.equal(validateState(first).valid, true);
  first.config.scales[0].default = 25;
  assert.equal(second.config.scales[0].default, 0);
});

test('stable IDs, directed relationship IDs, aliases, and unique operation IDs', () => {
  assert.equal(stableId(' Alice '), stableId('alice'));
  assert.equal(normalizeAlias('  ALICE   Smith '), 'alice smith');
  assert.notEqual(relationshipId('a', 'b'), relationshipId('b', 'a'));
  assert.notEqual(uniqueId('op'), uniqueId('op'));

  const { state, alice } = setupState();
  assert.equal(resolveEntityId(state, 'ALLY'), alice.id);
  assert.equal(resolveEntityId(state, alice.id), alice.id);
  assert.equal(resolveEntityId(state, 'unknown'), null);
});

test('configurable scales clamp deltas and reject unknown scales', () => {
  const scales = [{ id: 'bond', label: 'Bond', default: 10 }];
  const { state, relationId } = setupState(scales);
  const raised = applyOperation(state, createOperation('scale.delta', {
    relationshipId: relationId,
    scaleId: 'bond',
    value: 500,
  }, { id: 'delta:high' }));
  assert.equal(raised.relationships[relationId].scales.bond, 100);
  assert.equal(createRelationship(raised, 'a', 'b', { scales: { bond: -500 } }).scales.bond, -100);
  assert.throws(() => createRelationship(raised, 'a', 'b', { scales: { missing: 1 } }), /Unknown scale/);
  assert.equal(clamp(-500), -100);
  assert.throws(() => clamp(Number.NaN), /finite number/);
  assert.throws(() => applyOperation(raised, createOperation('scale.delta', {
    relationshipId: relationId,
    scaleId: 'missing',
    value: 1,
  })), /Unknown scale/);
});

test('directed relationships remain independent', () => {
  let { state, alice, bob, relationId } = setupState();
  state = applyOperation(state, createOperation('relationship.upsert', {
    from: bob.id,
    to: alice.id,
  }, { id: 'reverse:rel' }));
  const reverseId = relationshipId(bob.id, alice.id);
  state = applyOperation(state, createOperation('scale.set', {
    relationshipId: reverseId,
    scaleId: 'trust',
    value: -30,
  }, { id: 'reverse:trust' }));
  assert.equal(state.relationships[relationId].scales.trust, 0);
  assert.equal(state.relationships[reverseId].scales.trust, -30);
});

test('operations are immutable, idempotent, and batch application is atomic', () => {
  const { state, relationId } = setupState();
  const operation = createOperation('scale.delta', {
    relationshipId: relationId,
    scaleId: 'trust',
    value: 12,
  }, { id: 'same-op' });
  const once = applyOperation(state, operation);
  const twice = applyOperation(once, operation);
  assert.equal(state.relationships[relationId].scales.trust, 0);
  assert.equal(once.relationships[relationId].scales.trust, 12);
  assert.equal(twice, once);
  assert.equal(once.operations.filter(({ id }) => id === 'same-op').length, 1);

  assert.throws(() => applyOperations(state, [operation, createOperation('scale.delta', {
    relationshipId: relationId,
    scaleId: 'unknown',
    value: 1,
  })]), /Unknown scale/);
  assert.equal(state.relationships[relationId].scales.trust, 0);
});

test('memories, tensions, and relationship stages are journaled', () => {
  const { state, relationId } = setupState();
  const changed = applyOperations(state, [
    createOperation('memory.add', { relationshipId: relationId, item: { id: 'm1', text: 'Shared secret' } }, { id: 'memory:add' }),
    createOperation('tension.add', { relationshipId: relationId, item: { id: 't1', text: 'Broken promise' } }, { id: 'tension:add' }),
    createOperation('stage.set', { relationshipId: relationId, stage: 'confidants' }, { id: 'stage:set' }),
  ]);
  assert.equal(changed.relationships[relationId].memories[0].text, 'Shared secret');
  assert.equal(changed.relationships[relationId].tensions[0].text, 'Broken promise');
  assert.equal(changed.relationships[relationId].stage, 'confidants');

  const removed = applyOperation(changed, createOperation('memory.remove', {
    relationshipId: relationId,
    itemId: 'm1',
  }, { id: 'memory:remove' }));
  assert.deepEqual(removed.relationships[relationId].memories, []);
});

test('generated collection item IDs stay stable across rollback replay', () => {
  const { state, relationId } = setupState();
  const memory = createOperation('memory.add', {
    relationshipId: relationId,
    item: 'Remembered promise',
  }, { id: 'memory:string' });
  const changed = applyOperations(state, [
    memory,
    createOperation('scale.delta', { relationshipId: relationId, scaleId: 'trust', value: 1 }, {
      id: 'temporary', transactionId: 'temporary-transaction',
    }),
  ]);
  const before = changed.relationships[relationId].memories[0].id;
  const replayed = rollbackTransaction(changed, 'temporary-transaction');
  assert.equal(replayed.relationships[relationId].memories[0].id, before);
});

test('rollback by transaction and message replays remaining operations', () => {
  const { state, relationId } = setupState();
  const changed = applyOperations(state, [
    createOperation('scale.delta', { relationshipId: relationId, scaleId: 'trust', value: 20 }, { id: 'tx:1', transactionId: 'tx-a' }),
    createOperation('scale.delta', { relationshipId: relationId, scaleId: 'trust', value: 5 }, { id: 'msg:1', messageId: 'message-a' }),
    createOperation('stage.set', { relationshipId: relationId, stage: 'allies' }, { id: 'tx:2', transactionId: 'tx-a' }),
  ]);
  const withoutTransaction = rollbackTransaction(changed, 'tx-a');
  assert.equal(withoutTransaction.relationships[relationId].scales.trust, 5);
  assert.equal(withoutTransaction.relationships[relationId].stage, null);
  const withoutMessage = rollbackMessage(changed, 'message-a');
  assert.equal(withoutMessage.relationships[relationId].scales.trust, 20);
});

test('reapplyMessage replaces swipe/edit effects without duplicating prior deltas', () => {
  const { state, relationId } = setupState();
  const initial = applyOperation(state, createOperation('scale.delta', {
    relationshipId: relationId,
    scaleId: 'affection',
    value: 40,
  }, { id: 'old-swipe', messageId: 'message-7' }));
  const replacement = createOperation('scale.delta', {
    relationshipId: relationId,
    scaleId: 'affection',
    value: -15,
  }, { id: 'new-swipe' });
  const reapplied = reapplyMessage(initial, 'message-7', [replacement]);
  assert.equal(reapplied.relationships[relationId].scales.affection, -15);
  assert.equal(reapplied.operations.some(({ id }) => id === 'old-swipe'), false);
  assert.equal(reapplied.operations.find(({ id }) => id === 'new-swipe').messageId, 'message-7');
});

test('snapshots capture and restore materialized state and journal', () => {
  const { state, relationId } = setupState();
  const captured = createSnapshot(state, { id: 'snapshot:one', createdAt: '2026-01-01T00:00:00.000Z' });
  const changed = applyOperation(captured.state, createOperation('scale.set', {
    relationshipId: relationId,
    scaleId: 'attraction',
    value: 80,
  }, { id: 'after-snapshot' }));
  const restored = restoreSnapshot(changed, 'snapshot:one');
  assert.equal(restored.relationships[relationId].scales.attraction, 0);
  assert.equal(restored.operations.some(({ id }) => id === 'after-snapshot'), false);
  assert.equal(restored.snapshots.length, 1);
});

test('JSON export/import validates v1 and reports parse failures with cause', () => {
  const { state } = setupState();
  const imported = importState(exportState(state));
  assert.deepEqual(imported, state);
  assert.throws(() => importState('{bad json'), /Invalid relationship state JSON/);
  assert.throws(() => importState({ ...state, schemaVersion: 99 }), /Unsupported schemaVersion/);
  assert.throws(() => exportState({ ...state, entities: [] }), /Cannot export invalid state/);
  assert.throws(() => importState({
    ...state,
    operations: [...state.operations, { id: 'evil', type: 'evil', payload: {} }],
    appliedOperationIds: [...state.appliedOperationIds, 'evil'],
  }), /Unsupported operation type/);
});

test('legacy state migrates to v1 with a replay baseline', () => {
  const migrated = migrateState({
    scales: [{ id: 'respect', default: 5 }],
    characters: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    relations: [{ from: 'a', to: 'b', scales: { respect: 150 }, stage: 'rivals' }],
  });
  const id = relationshipId('a', 'b');
  assert.equal(migrated.schemaVersion, 1);
  assert.equal(migrated.relationships[id].scales.respect, 100);
  assert.deepEqual(migrated.baseline.relationships, migrated.relationships);
  assert.equal(validateState(migrated).valid, true);
});

test('runtime prompt selector is compact, directed, filtered, and bounded', () => {
  let { state, alice, relationId } = setupState();
  state = applyOperations(state, [
    createOperation('scale.set', { relationshipId: relationId, scaleId: 'trust', value: 33 }, { id: 'prompt:trust' }),
    createOperation('memory.add', { relationshipId: relationId, item: { id: 'old', text: 'Old event' } }, { id: 'prompt:old' }),
    createOperation('memory.add', { relationshipId: relationId, item: { id: 'new', text: 'Recent event' } }, { id: 'prompt:new' }),
    createOperation('stage.set', { relationshipId: relationId, stage: 'friends' }, { id: 'prompt:stage' }),
  ]);
  const prompt = selectRuntimePrompt(state, {
    actorIds: [alice.id],
    scales: ['trust'],
    memoryLimit: 1,
  });
  assert.match(prompt, /^Alice>Bob;trust=33\(прислушивается\);stage=friends;mem=Recent event$/);
  assert.doesNotMatch(prompt, /affection|Old event/);
  assert.equal(selectRuntimePrompt(state, { actorIds: ['nobody'] }), '');
});

test('scale hints escalate with magnitude and stay hidden below the threshold', () => {  let { state, relationId } = setupState();
  state = applyOperations(state, [
    createOperation('scale.set', { relationshipId: relationId, scaleId: 'attraction', value: 70 }, { id: 'hint:high' }),
  ]);
  assert.match(selectRuntimePrompt(state, { scales: ['attraction'] }), /attraction=70\(сильное сексуальное желание/);
  let lowered = applyOperations(state, [
    createOperation('scale.set', { relationshipId: relationId, scaleId: 'attraction', value: 5 }, { id: 'hint:low' }),
  ]);
  assert.doesNotMatch(selectRuntimePrompt(lowered, { scales: ['attraction'] }), /attraction=5\(/);
});
