import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOperations, createDefaultState, createEntity, createOperation, importState, rollbackMessage, selectRuntimePrompt,
} from '../src/core/index.js';
import { analyzeMessage, parseAnalysis } from '../src/integration/analyzer.js';
import { applyAnalysisResult } from '../src/integration/analysis-operations.js';

const suzu = createEntity('Судзу');
const mikey = createEntity('Майки');
const ran = createEntity('Ран');

function chat() {
  let state = applyOperations(createDefaultState(), [
    createOperation('entity.upsert', suzu),
    createOperation('entity.upsert', mikey),
    createOperation('entity.upsert', ran),
    createOperation('stranger.set', { entityId: mikey.id, stranger: true }),
  ]);
  state = { ...state, ui: { ...state.ui, personaId: suzu.id } };
  return state;
}

const promptText = state => {
  const result = selectRuntimePrompt(state);
  return typeof result === 'string' ? result : result.text;
};

test('the prompt says plainly: not met, no names, they must get acquainted', () => {
  const text = promptText(chat());
  assert.match(text, /strangers\[Майки & Судзу\]: Майки has NOT met Судзу yet/);
  assert.match(text, /do not know each other's names/);
  assert.match(text, /must not call Судзу by name/);
  assert.match(text, /have to get acquainted in the story first/);
  assert.doesNotMatch(text, /strangers\[Ран/, 'only marked characters');
});

test('no persona bound: no persona rule', () => {
  const state = { ...chat(), ui: { ...chat().ui, personaId: '' } };
  assert.doesNotMatch(promptText(state) ?? '', /strangers\[Майки/);
});

test('editing a character keeps the mark', () => {
  const state = applyOperations(chat(), [createOperation('entity.upsert', createEntity('Майки', { aliases: ['Манджиро'] }))]);
  assert.equal(state.entities[mikey.id].stranger, true);
  assert.deepEqual(state.entities[mikey.id].aliases, ['Манджиро']);
});

test('the analyzer is told who has not met the persona, and an introduction clears the mark until swiped', async () => {
  const calls = [];
  const context = { async generateRaw(options) { calls.push(options); return JSON.stringify({ operations: [], introduced: [mikey.id, ran.id] }); } };
  const result = await analyzeMessage(context, chat(), { mes: '— Я Судзу, — сказала она. Майки кивнул: — Манджиро.' }, { analysisMaxCharacters: 12000 });
  assert.match(calls[0].prompt[1].content, /Strangers to the persona \(have not met Судзу yet\): .*Майки/);
  assert.match(calls[0].prompt[0].content, /"introduced"/);
  const applied = applyAnalysisResult(chat(), result, { messageId: '7', messageIndex: 7, transactionId: 'message:7' });
  assert.equal(applied.state.entities[mikey.id].stranger, undefined, 'introduced');
  assert.equal(applied.operations.length, 1, 'Ran was never a stranger: nothing to clear');
  assert.equal(rollbackMessage(applied.state, '7').entities[mikey.id].stranger, true, 'a swipe brings the mark back');
});

test('without strangers the analyzer gets neither the list nor the rule', async () => {
  const calls = [];
  const context = { async generateRaw(options) { calls.push(options); return '{"operations":[]}'; } };
  const state = applyOperations(chat(), [createOperation('stranger.set', { entityId: mikey.id, stranger: false })]);
  await analyzeMessage(context, state, { mes: 'Текст' }, { analysisMaxCharacters: 12000 });
  assert.doesNotMatch(calls[0].prompt[1].content, /Strangers to the persona/);
  assert.doesNotMatch(calls[0].prompt[0].content, /"introduced"/);
  assert.deepEqual(parseAnalysis('{"operations":[]}').introduced, []);
});

test('the mark survives export and import', () => {
  assert.equal(importState(JSON.stringify(chat())).entities[mikey.id].stranger, true);
});
