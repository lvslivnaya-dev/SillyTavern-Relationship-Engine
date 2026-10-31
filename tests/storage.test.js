import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatStorage } from '../src/integration/storage.js';
import { createDefaultState, createEntity, createOperation, applyOperations, importState } from '../src/core/index.js';

function makeContext() {
  const metadataByChat = {
    'chat-a': {},
    'chat-b': {},
  };
  const saves = [];
  let currentChatId = 'chat-a';
  return {
    getCurrentChatId: () => currentChatId,
    get chatMetadata() { return metadataByChat[currentChatId]; },
    async saveMetadata() {
      saves.push({ chatId: currentChatId, keys: Object.keys(metadataByChat[currentChatId]) });
    },
    getChatMetadata(id) { return metadataByChat[id]; },
    getSaves() { return saves; },
    switchTo(id) { currentChatId = id; },
  };
}

test('storage always saves immediately: no debounced window survives chat exit', async () => {
  const ctx = makeContext();
  const storage = createChatStorage(() => ctx, createDefaultState, importState);
  const stateA = applyOperations(createDefaultState(), [
    createOperation('entity.upsert', createEntity('Анна')),
    createOperation('entity.upsert', createEntity('Леон')),
  ]);
  await storage.save(stateA);
  // Simulate SillyTavern's clearChat() discarding debounced writers —
  // there is nothing pending, so the data must persist.
  assert.ok(ctx.getChatMetadata('chat-a')['relationshipEngine.v1']);
  assert.equal(ctx.getChatMetadata('chat-a')['relationshipEngine.v1'].entities['entity:анна:1knyf2r'].name, 'Анна');

  // Switch to chat B: state is isolated, nothing leaks from A.
  ctx.switchTo('chat-b');
  const loadedB = storage.load();
  assert.equal(Object.keys(loadedB.entities).length, 0);
  const stateB = applyOperations(createDefaultState(), [createOperation('entity.upsert', createEntity('Мира'))]);
  await storage.save(stateB);
  assert.ok(ctx.getChatMetadata('chat-b')['relationshipEngine.v1']);
  assert.equal(ctx.getChatMetadata('chat-a')['relationshipEngine.v1'].entities['entity:анна:1knyf2r'].name, 'Анна', 'чат A не тронут');

  // Return to A: everything restores.
  ctx.switchTo('chat-a');
  const restored = storage.load();
  assert.equal(Object.keys(restored.entities).length, 2);
  const saves = ctx.getSaves();
  assert.ok(saves.every(save => save.keys.includes('relationshipEngine.v1')));
  assert.ok(saves.every(save => save.chatId === 'chat-a' || save.chatId === 'chat-b'));
});
