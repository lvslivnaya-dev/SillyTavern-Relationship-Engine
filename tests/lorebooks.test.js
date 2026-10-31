import test from 'node:test';
import assert from 'node:assert/strict';
import { matchLoreEntries, loadLinkedLore, transliterate, canonKeys, backTransliterate, extractBookText, analyzeLorebookCharacters, namesMatch } from '../src/integration/lorebooks.js';

test('lore matching uses names and aliases and ignores disabled unrelated entries', () => {
  const book = { entries: {
    1: { uid: 1, key: ['Лёва'], content: 'Друг Анны' },
    2: { uid: 2, key: ['Лёва'], content: 'Отключено', disable: true },
    3: { uid: 3, key: ['Локация'], content: 'Не о персонаже' },
  } };
  const result = matchLoreEntries(book, { a: { name: 'Леон', aliases: ['Лева'] } }, 'Друзья');
  assert.equal(result.length, 1);
  assert.equal(result[0].book, 'Друзья');
});

test('transliteration matches English lorebook keys against Russian scene names', () => {
  assert.equal(transliterate('Леон'), 'leon');
  assert.equal(transliterate('Мира'), 'mira');
  const book = { entries: { 1: { uid: 1, key: ['Leon'], content: 'A lone wanderer' } } };
  const result = matchLoreEntries(book, { a: { name: 'Леон' } }, 'World');
  assert.equal(result.length, 1);
  assert.match(result[0].content, /wanderer/);
});

test('canon keys catch cross-alphabet duplicates like Blanco/бланко and Sanji/санджи', () => {
  assert.equal(backTransliterate('Blanco'), 'бланко');
  assert.equal(backTransliterate('Sanji'), 'санджи');
  const overlap = (a, b) => [...canonKeys(a)].some(key => canonKeys(b).has(key));
  assert.ok(overlap('бланко', 'Blanco'), 'к vs c должен совпадать через round-trip');
  assert.ok(overlap('санджи', 'Sanji'), 'дж vs j должен совпадать через round-trip');
  assert.ok(overlap('Зоро', 'Zoro'));
  assert.ok(overlap('Анна', 'Anna'));
  assert.ok(!overlap('Анна', 'Мира'), 'разные имена не пересекаются');
});

test('only explicitly linked books are read', async () => {
  const loaded = [];
  const context = { async loadWorldInfo(name) { loaded.push(name); return { entries: { 1: { uid: 1, key: ['Анна'], content: 'Описание' } } }; } };
  const text = await loadLinkedLore(context, { entities: { a: { name: 'Анна' } }, ui: { linkedLorebooks: ['Книга A', 'Книга B'] } });
  assert.deepEqual(loaded, ['Книга A', 'Книга B']);
  assert.match(text, /Книга A/);
  assert.match(text, /Книга B/);
});

test('extractBookText bounds output and skips disabled entries', () => {
  const book = { entries: {
    1: { uid: 1, comment: 'Зоро', content: 'Мечник команды. '.repeat(50) },
    2: { uid: 2, content: 'Отключено', disable: true },
    3: { uid: 3, key: ['Бланко'], content: 'Капитан.' },
  } };
  const text = extractBookText(book, 500);
  assert.ok(text.length <= 510);
  assert.match(text, /## Зоро/);
  assert.match(text, /## Бланко/);
  assert.doesNotMatch(text, /Отключено/);
  assert.ok(text.length >= 160, 'обрезка не съедает запись целиком');
});

test('analyzeLorebookCharacters parses the roster, known aliases and filters junk', async () => {
  const context = {
    async generateRaw(request) {
      assert.match(request.prompt[1].content, /LOREBOOK «Мир»/);
      assert.match(request.prompt[1].content, /KNOWN REGISTRY/);
      assert.match(request.prompt[1].content, /a = Фёдор/);
      return JSON.stringify({
        characters: [
          { name: 'Зоро', aliases: ['Zoro'], note: 'Мечник' },
          { name: 'Гора', aliases: [], note: 'Не персонаж' },
        ],
        knownAliases: [
          { id: 'a', aliases: ['Theodore', 'Ted'] },
          { id: 'ghost', aliases: ['X'] },
          { id: 'a', aliases: [] },
        ],
      });
    },
  };
  const result = await analyzeLorebookCharacters(context, { entries: { 1: { uid: 1, content: 'Зоро спал.' } } }, 'Мир', [{ id: 'a', name: 'Фёдор', aliases: [] }]);
  assert.equal(result.characters.length, 2, 'фильтрация ролей — задача модели; парсер валидирует формат');
  assert.equal(result.characters[0].name, 'Зоро');
  assert.deepEqual(result.characters[0].aliases, ['Zoro']);
  assert.deepEqual(result.knownAliases, [{ id: 'a', aliases: ['Theodore', 'Ted'] }], 'несуществующие ID и пустые алиасы отбрасываются');
});

test('namesMatch connects cross-alphabet names without merging distinct ones', () => {
  const matches = [
    ['бланко', 'Blanco'], ['санджи', 'Sanji'], ['Зоро', 'Zoro'], ['Анна', 'Anna'],
    ['Юрий', 'Yuri'], ['Дмитрий', 'Dmitry'], ['Селеста', 'Celeste'], ['Ксения', 'Xenia'],
    ['Щукин', 'Schukin'], ['Виктор', 'Victor'], ['Екатерина', 'Ekaterina'],
  ];
  for (const [ru, en] of matches) assert.ok(namesMatch(ru, en), `${ru} должен совпадать с ${en}`);
  const distinct = [
    ['Анна', 'Мира'], ['Леон', 'Зоро'], ['Юрий', 'Юлиан'], ['София', 'Селеста'],
    ['Максим', 'Дмитрий'], ['Леон', 'Леонардо'], ['Мира', 'Мария'], ['Леон', 'Лев'],
  ];
  for (const [a, b] of distinct) assert.ok(!namesMatch(a, b), `${a} не должен совпадать с ${b}`);
});
