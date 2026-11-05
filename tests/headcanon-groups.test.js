import test from 'node:test';
import assert from 'node:assert/strict';
import { addHeadcanons, headcanonKey, listHeadcanonPairs, selectHeadcanons } from '../src/core/index.js';
import { parseAnalysis } from '../src/integration/analyzer.js';
import { applyAnalysisResult } from '../src/integration/analysis-operations.js';
import { mentionScorer } from '../src/integration/headcanon-retrieval.js';

const state = {
  entities: {
    a: { id: 'a', name: 'Майки', aliases: [] },
    b: { id: 'b', name: 'Дракен', aliases: [] },
    c: { id: 'c', name: 'Баджи', aliases: [] },
  },
  relationships: {},
  ui: {},
  config: { scales: [] },
};

test('a group key is unordered and holds 2..8 characters', () => {
  assert.equal(headcanonKey('c', 'a', 'b'), 'a|b|c');
  assert.equal(headcanonKey(['b', 'c', 'a']), 'a|b|c');
  assert.equal(headcanonKey('a', 'b'), 'a|b', 'pairs work as before');
  assert.equal(headcanonKey(['a', 'a', 'b']), 'a|b', 'duplicates collapse');
  assert.throws(() => headcanonKey(['a']), /хотя бы двух/);
  assert.throws(() => headcanonKey([...'abcdefghi']), /не больше 8/);
});

test('group headcanons are listed with every name and picked only when the whole group is in the scene', () => {
  const key = headcanonKey('a', 'b', 'c');
  const withGroup = { ...state, ui: { headcanons: addHeadcanons(state, key, ['Втроём делят одну пачку сигарет']).headcanons } };
  const [group] = listHeadcanonPairs(withGroup);
  assert.equal(group.label, 'Майки & Дракен & Баджи');
  assert.deepEqual(selectHeadcanons(withGroup, { score: mentionScorer(withGroup, 'Майки и Дракен на мосту') }), []);
  assert.deepEqual(selectHeadcanons(withGroup, { score: mentionScorer(withGroup, 'Майки, Дракен и Баджи на мосту') }),
    ['headcanon[Майки & Дракен & Баджи]: Втроём делят одну пачку сигарет']);
});

test('the analyzer may return a group headcanon; it is kept only for an allowed group with exactly its members', () => {
  const parsed = parseAnalysis(JSON.stringify({
    operations: [],
    headcanons: [
      { participantIds: ['a', 'b', 'c'], text: 'Всегда садятся в одном порядке' },
      { participantIds: ['a', 'b'], text: 'Парный факт' },
      { participantIds: ['a'], text: 'Один не считается' },
    ],
  }));
  assert.equal(parsed.headcanons.length, 2);
  const result = applyAnalysisResult(state, parsed, { messageId: '5' }, [], { headcanonKeys: [headcanonKey('a', 'b', 'c')] });
  assert.deepEqual(result.headcanons, [{ key: 'a|b|c', text: 'Всегда садятся в одном порядке' }]);
});
