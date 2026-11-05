import test from 'node:test';
import assert from 'node:assert/strict';
import { generationBooks, loadGroupLore } from '../src/integration/lorebooks.js';
import { matchingKeys } from '../src/integration/growth.js';

const state = {
  entities: {
    ran: { id: 'ran', name: 'Ран', aliases: ['Хайтани Ран'] },
    suzu: { id: 'suzu', name: 'Судзу', aliases: [] },
    mikey: { id: 'mikey', name: 'Майки', aliases: [] },
  },
  ui: { linkedLorebooks: ['Тосва'] },
};

const books = {
  Тосва: { entries: {
    1: { key: ['Майки'], content: 'Майки — лидер Тосвы.' },
    2: { key: ['Ран', 'Хайтани'], content: 'Ран — старший из братьев.' },
    3: { key: ['подворотня'], content: 'В подворотне Ран и Судзу впервые поговорили.' },
    4: { key: ['охрана'], content: 'Охранник у ворот никого не пускает.' },
    5: { key: ['Судзу'], content: 'Судзу — новенькая.', disable: true },
  } },
  Карточка: { entries: { 1: { key: ['Судзу'], content: 'Судзу переехала в Роппонги.' } } },
};
const context = { loadWorldInfo: async name => books[name], getWorldInfoNames: () => Object.keys(books) };

test('lore of a pair: profiles first, then shared entries; strangers and disabled entries left out', async () => {
  const text = await loadGroupLore(context, state, ['ran', 'suzu'], { books: ['Тосва', 'Карточка'], matchKeys: matchingKeys });
  const titles = [...text.matchAll(/^## (.+?) \(/gm)].map(match => match[1]);
  assert.deepEqual(titles.slice(0, 2).sort(), ['Ран, Хайтани', 'Судзу'].sort(), 'both profiles first, from either book');
  assert.equal(titles[2], 'подворотня', 'then the entry naming both');
  assert.ok(!titles.includes('Майки'), 'another character’s profile is not lore about this pair');
  assert.ok(!text.includes('Охранник'), '"ран" inside "охранник" is not Ran');
  assert.ok(!text.includes('новенькая'), 'disabled entries are skipped');
});

test('the budget keeps the most relevant entries', async () => {
  const text = await loadGroupLore(context, state, ['ran', 'suzu'], { books: ['Тосва'], matchKeys: matchingKeys, maxCharacters: 60 });
  assert.match(text, /старший из братьев/);
  assert.doesNotMatch(text, /подворотне/);
});

test('an unreadable book is skipped, not fatal', async () => {
  const broken = { loadWorldInfo: async name => { if (name === 'Сломанная') throw new Error('no'); return books[name]; } };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const text = await loadGroupLore(broken, state, ['ran'], { books: ['Сломанная', 'Тосва'], matchKeys: matchingKeys });
    assert.match(text, /старший из братьев/);
  } finally { console.warn = warn; }
});

test('generation reads linked, card and chat books, each once', () => {
  const ctx = { getWorldInfoNames: () => ['Тосва', 'Карточка', 'Чат'], chatMetadata: { world_info: 'Чат' } };
  assert.deepEqual(generationBooks(ctx, state, ['Карточка', 'Тосва']), ['Тосва', 'Карточка', 'Чат']);
  assert.deepEqual(generationBooks({ getWorldInfoNames: () => ['Тосва'] }, state, ['Удалённая']), ['Тосва'], 'a deleted book is skipped');
});
