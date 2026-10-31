import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFactors } from '../src/core/operations.js';
import { createDefaultState, createOperation, applyOperations, applyOperation, importState, selectRuntimePrompt, relationshipId } from '../src/core/index.js';
import { generateGrowthFactors, parseFactors, collectPairScenes, directionPresets } from '../src/integration/growth.js';

function setup() {
  const state = applyOperations(createDefaultState(), [
    createOperation('entity.upsert', { id: 'a', name: 'Анна' }),
    createOperation('entity.upsert', { id: 'b', name: 'Леон' }),
    createOperation('relationship.upsert', { from: 'a', to: 'b' }),
  ]);
  return state;
}

test('normalizeFactors validates scales, bounds size and deduplicates', () => {
  const state = createDefaultState();
  const factors = normalizeFactors([
    { scaleId: 'love', direction: 'up', text: 'Делится тайнами' },
    { scaleId: 'love', direction: 'up', text: 'Делится тайнами' },
    { scaleId: 'unknown', direction: 'up', text: '?' },
    { scaleId: 'trust', direction: 'wrong', text: 'Постоянно опаздывает' },
    { scaleId: 'trust', text: '' },
  ], state);
  assert.equal(factors.length, 2);
  assert.deepEqual(factors[0], { scaleId: 'love', direction: 'up', text: 'Делится тайнами' });
  assert.equal(factors[1].direction, 'up', 'unknown direction coerces to up');
});

test('factors.set journals, survives replay validation and reaches the runtime prompt', () => {
  let state = setup();
  const id = relationshipId('a', 'b');
  state = applyOperation(state, createOperation('factors.set', {
    relationshipId: id,
    factors: [{ scaleId: 'love', direction: 'up', text: 'Нежность в мелочах' }, { scaleId: 'trust', direction: 'down', text: 'Ложь о прошлом' }],
  }, { id: 'factors:1', reason: 'Ручное изменение' }));
  assert.equal(state.relationships[id].factors.length, 2);
  assert.match(selectRuntimePrompt(state, {}), /grow\[\+love: Нежность в мелочах \| -trust: Ложь о прошлом\]/);
  assert.doesNotThrow(() => importState(state));
});

test('generated factors parse, filter unknown scales and require content', () => {
  const state = setup();
  const factors = parseFactors(JSON.stringify({
    factors: [
      { scaleId: 'love', direction: 'up', text: 'Забота в болезни' },
      { scaleId: 'bad', direction: 'up', text: '?' },
      { scaleId: 'jealousy', direction: 'down', text: 'Откровенность о прошлом' },
    ],
  }), state);
  assert.equal(factors.length, 2);
  assert.throws(() => parseFactors('{"factors":[{"scaleId":"bad","direction":"up","text":"x"}]}', state), /ни одного валидного фактора/);
});

test('growth generation passes direction, lore and scenes; repeats are user-directed', async () => {
  const state = setup();
  const requests = [];
  const context = {
    chat: [{ mes: 'Анна и Леон говорили у камина.' }, { mes: 'Другая сцена без них.' }],
    async generateRaw(request) {
      requests.push(request);
      return JSON.stringify({ factors: [{ scaleId: 'love', direction: 'up', text: 'Тихие вечера у камина' }] });
    },
  };
  const factors = await generateGrowthFactors(context, state, 'a', 'b', {
    directionId: 'custom', customDirection: 'медленная романтика', loreContext: 'LORE: Leon values loyalty',
  });
  assert.equal(factors.length, 1);
  const prompt = requests[0].prompt.map(part => part.content).join('\n');
  assert.match(prompt, /медленная романтика/);
  assert.match(prompt, /LORE: Leon values loyalty/);
  assert.match(prompt, /Анна и Леон говорили у камина/);
  assert.doesNotMatch(prompt, /Другая сцена/);
  assert.ok(directionPresets().some(preset => preset.id === 'romance'));
});

test('collectPairScenes matches by aliases and Russian declension', () => {
  const state = setup();
  const chat = [
    { mes: 'Лео обнял Анну.' },
    { mes: 'Кто-то прошёл мимо.' },
    { mes: 'Лео снова с Анной, долгая сцена с множеством деталей и разговоров о жизни, чтобы проверить ограничение размера выборки.' },
  ];
  const scenes = collectPairScenes(state, chat, 'a', 'b', 200);
  assert.match(scenes, /Лео обнял Анну/);
  assert.doesNotMatch(scenes, /Кто-то прошёл/);
});
