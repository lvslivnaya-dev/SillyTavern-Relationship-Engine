import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addHeadcanons, applyOperations, createDefaultState, createOperation, dropAutoHeadcanons, headcanonKey,
  importState, isAutoHeadcanons, listHeadcanonPairs, rollbackMessage, selectHeadcanons, updateHeadcanons,
} from '../src/core/index.js';

function setup() {
  const state = applyOperations(createDefaultState(), [
    createOperation('entity.upsert', { id: 'a', name: 'Анна' }),
    createOperation('entity.upsert', { id: 'b', name: 'Леон' }),
    createOperation('entity.upsert', { id: 'p', name: 'Ева' }),
    createOperation('scale.delta', { from: 'a', to: 'b', scaleId: 'trust', value: 3 }, { messageId: '4' }),
  ]);
  state.ui.personaId = 'p';
  return state;
}

test('pair key is unordered and rejects a character paired with itself', () => {
  assert.equal(headcanonKey('b', 'a'), headcanonKey('a', 'b'));
  assert.throws(() => headcanonKey('a', 'a'), /двух разных/);
});

test('one fact per item, duplicates and empty lines skipped', () => {
  const state = setup();
  const key = headcanonKey('a', 'b');
  const { headcanons, added } = addHeadcanons(state, key, ['Он всегда провожает её до дома', '  он всегда   провожает её до дома ', '', 'Зовёт её «лисой»']);
  assert.equal(added, 2);
  state.ui.headcanons = headcanons;
  const [pair] = listHeadcanonPairs(state);
  assert.equal(pair.label, 'Анна & Леон');
  assert.equal(pair.enabledCount, 2);
});

test('automatic filling is on for persona pairs by default, opt-in for character pairs, explicit choice wins', () => {
  const state = setup();
  assert.equal(isAutoHeadcanons(state, headcanonKey('a', 'p')), true);
  assert.equal(isAutoHeadcanons(state, headcanonKey('a', 'b')), false);
  state.ui.headcanons = updateHeadcanons(state, headcanonKey('a', 'b'), entry => { entry.auto = true; });
  state.ui.headcanons = updateHeadcanons(state, headcanonKey('a', 'p'), entry => { entry.auto = false; });
  assert.equal(isAutoHeadcanons(state, headcanonKey('a', 'b')), true);
  assert.equal(isAutoHeadcanons(state, headcanonKey('a', 'p')), false);
});

test('disabled facts are never selected; selection respects limit, budget and score', () => {
  const state = setup();
  const key = headcanonKey('a', 'b');
  state.ui.headcanons = addHeadcanons(state, key, ['Первый факт', 'Второй факт', 'Третий факт']).headcanons;
  state.ui.headcanons = updateHeadcanons(state, key, entry => { entry.items[1].enabled = false; });
  const lines = selectHeadcanons(state, { score: item => (item.text.startsWith('Третий') ? 2 : 1) });
  assert.deepEqual(lines, ['headcanon[Анна & Леон]: Третий факт', 'headcanon[Анна & Леон]: Первый факт']);
  assert.equal(selectHeadcanons(state, { limit: 1 }).length, 1);
  assert.equal(selectHeadcanons(state, { score: () => 0 }).length, 0, 'нерелевантные не попадают');
});

test('automatic facts of a re-analyzed message are dropped; manual ones stay; ui survives replay', () => {
  const state = setup();
  const key = headcanonKey('a', 'p');
  state.ui.headcanons = addHeadcanons(state, key, ['Из сообщения 4'], { source: 'auto', messageId: 4 }).headcanons;
  state.ui.headcanons = addHeadcanons(state, key, ['Вписано руками']).headcanons;
  const rolled = rollbackMessage(state, '4');
  assert.equal(rolled.ui.headcanons[key].items.length, 2, 'откат журнала не трогает хедканоны сам по себе');
  const { headcanons, dropped } = dropAutoHeadcanons(rolled, messageId => messageId === '4');
  assert.equal(dropped, 1);
  assert.deepEqual(headcanons[key].items.map(item => item.text), ['Вписано руками']);
  assert.doesNotThrow(() => importState({ ...rolled, ui: { ...rolled.ui, headcanons } }));
});

test('removing a character removes headcanons of its pairs', () => {
  const state = setup();
  state.ui.headcanons = addHeadcanons(state, headcanonKey('a', 'b'), ['Факт']).headcanons;
  const next = applyOperations(state, [createOperation('entity.remove', { entityId: 'b' })]);
  assert.deepEqual(next.ui.headcanons, {});
});

test('scene fallback: only pairs whose members appear in recent messages (persona always present)', async () => {
  const { mentionScorer, recentSceneText } = await import('../src/integration/headcanon-retrieval.js');
  const state = setup();
  state.ui.headcanons = addHeadcanons(state, headcanonKey('a', 'b'), ['Анна и Леон спорят о книгах']).headcanons;
  state.ui.headcanons = addHeadcanons({ ...state }, headcanonKey('a', 'p'), ['Анна зовёт Еву «солнцем»']).headcanons;
  const chat = [{ mes: 'Старое: Леон ушёл.' }, { mes: 'Анна вошла в комнату и улыбнулась.' }];
  const scene = recentSceneText(chat, 1);
  assert.equal(scene, 'Анна вошла в комнату и улыбнулась.');
  const lines = selectHeadcanons(state, { score: mentionScorer(state, scene) });
  assert.deepEqual(lines, ['headcanon[Анна & Ева]: Анна зовёт Еву «солнцем»'], 'Леона нет в сцене — его пара не попадает');
  const both = selectHeadcanons(state, { score: mentionScorer(state, recentSceneText(chat, 2)) });
  assert.equal(both.length, 2);
});

test('semantic ranking: meaning wins, presence only nudges, threshold cuts', async () => {
  const { semanticScorer } = await import('../src/integration/headcanon-retrieval.js');
  const { cosine } = await import('../src/integration/embeddings.js');
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  const state = setup();
  state.ui.headcanons = addHeadcanons(state, headcanonKey('a', 'b'), ['Близкий по смыслу']).headcanons;
  state.ui.headcanons = addHeadcanons({ ...state }, headcanonKey('a', 'p'), ['Далёкий, но персона рядом']).headcanons;
  const similarity = item => (item.text.startsWith('Близкий') ? 0.83 : 0.80);
  const lines = selectHeadcanons(state, { score: semanticScorer(state, 'Ева одна дома.', similarity) });
  assert.equal(lines[0], 'headcanon[Анна & Леон]: Близкий по смыслу', 'смысл важнее присутствия');
  assert.equal(selectHeadcanons(state, { score: semanticScorer(state, '', similarity, 0.82) }).length, 1, 'порог отсекает далёкие');
});

test('automatic headcanons: only allowed pairs, resolved by scene names, follow deleted messages', async () => {
  const { applyAnalysisResult } = await import('../src/integration/analysis-operations.js');
  const { parseAnalysis } = await import('../src/integration/analyzer.js');
  const { remapAutoHeadcanons } = await import('../src/core/index.js');
  const state = setup();
  const result = parseAnalysis(JSON.stringify({ operations: [], headcanons: [
    { participantIds: ['Анна', 'p'], text: 'Анна всегда приносит Еве кофе' },
    { participantIds: ['a', 'b'], text: 'Пара без автозаполнения' },
    { participantIds: ['a'], text: 'Неполная пара' },
  ] }));
  assert.equal(result.headcanons.length, 2, 'неполная пара отброшена при разборе');
  const applied = applyAnalysisResult(state, result, { messageId: '5' }, [], { headcanonKeys: [headcanonKey('a', 'p')] });
  assert.deepEqual(applied.headcanons, [{ key: headcanonKey('a', 'p'), text: 'Анна всегда приносит Еве кофе' }]);

  const added = addHeadcanons(state, headcanonKey('a', 'p'), ['Анна всегда приносит Еве кофе'], { source: 'auto', messageId: 5 });
  state.ui.headcanons = added.headcanons;
  const moved = remapAutoHeadcanons(state, id => (id === added.ids[0] ? 3 : null));
  assert.equal(moved.changed, true);
  assert.equal(moved.headcanons[headcanonKey('a', 'p')].items[0].messageId, '3', 'сдвинулся вместе с сообщением');
  const gone = remapAutoHeadcanons(state, () => null);
  assert.equal(gone.headcanons[headcanonKey('a', 'p')], undefined, 'удалён вместе с сообщением');
});
