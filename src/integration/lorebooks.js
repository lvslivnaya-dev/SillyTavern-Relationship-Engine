import { withBusy } from './busy.js';

const TRANSLIT_RU_TO_EN = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

// Greedy digraph-first mapping; longer sequences must come first.
const TRANSLIT_EN_TO_RU = [
  ['sch', 'щ'], ['dzh', 'дж'], ['sh', 'ш'], ['ch', 'ч'], ['zh', 'ж'], ['ts', 'ц'], ['kh', 'х'],
  ['th', 'т'], ['ph', 'ф'], ['ya', 'я'], ['yo', 'ё'], ['yu', 'ю'], ['ja', 'я'], ['ju', 'ю'], ['jo', 'ё'],
  ['a', 'а'], ['b', 'б'], ['c', 'к'], ['d', 'д'], ['e', 'е'], ['f', 'ф'], ['g', 'г'], ['h', 'х'],
  ['i', 'и'], ['j', 'дж'], ['k', 'к'], ['l', 'л'], ['m', 'м'], ['n', 'н'], ['o', 'о'], ['p', 'п'],
  ['q', 'к'], ['r', 'р'], ['s', 'с'], ['t', 'т'], ['u', 'у'], ['v', 'в'], ['w', 'в'], ['x', 'кс'],
  ['y', 'й'], ['z', 'з'],
];

function normalize(value) { return String(value ?? '').normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').trim(); }

/** Latin form of a Cyrillic name: Леон -> leon. */
export function transliterate(value) {
  const normalized = String(value ?? '').toLocaleLowerCase('ru-RU');
  let result = '';
  for (const char of normalized) result += TRANSLIT_RU_TO_EN[char] ?? char;
  return result.replace(/[^a-z0-9]/g, '');
}

// Ambiguous Latin letter readings: each letter may map to several Russian
// letters depending on the original spelling, so every Cyrillic variant is generated.
const AMBIGUOUS_EN = {
  c: ['к', 'с'],
  j: ['дж', 'й'],
  w: ['в'],
  x: ['кс', 'к'],
  y: ['й', 'и'],
};

/** All Cyrillic back-forms of a Latin string, including ambiguous readings. */
export function backTransliterateAll(value) {
  const source = String(value ?? '').toLocaleLowerCase('ru-RU');
  let results = [''];
  let index = 0;
  while (index < source.length) {
    // TRANSLIT_EN_TO_RU is ordered longest-first, so the first match wins and
    // its own length drives the advance.
    const expansions = [];
    for (const [sequence, replacement] of TRANSLIT_EN_TO_RU) {
      if (source.startsWith(sequence, index)) {
        for (const variant of AMBIGUOUS_EN[sequence] ?? [replacement]) {
          expansions.push({ variant, length: sequence.length });
        }
        break;
      }
    }
    if (!expansions.length) {
      const char = source[index];
      expansions.push({ variant: /[а-я0-9]/.test(char) ? char : '', length: 1 });
    }
    const next = [];
    for (const prefix of results) {
      for (const { variant } of expansions) next.push(prefix + variant);
    }
    results = next.slice(0, 64);
    index += expansions[0].length;
  }
  return [...new Set(results.map(result => result.replace(/[^а-я0-9]/g, '')).filter(Boolean))];
}

/**
 * Canonical key set for cross-alphabet matching. Includes:
 * - the normalized name itself and its Latin transliteration;
 * - Cyrillic back-forms with round-trips (Blanco -> бланко -> blanko);
 * - stem keys with trimmed endings (Yuri/Yuriy, Celeste/Селеста differ only
 *   in the final letters, so the stem "selest"/"dmitr" matches both).
 */
export function canonKeys(value) {
  const normalized = normalize(value);
  if (!normalized) return new Set();
  const keys = new Set([normalized]);
  const direct = transliterate(normalized);
  if (direct) keys.add(direct);
  for (const form of backTransliterateAll(normalized)) {
    keys.add(form);
    const roundTrip = transliterate(form);
    if (roundTrip) keys.add(roundTrip);
  }
  // Stem keys: drop the variable ending (both Cyrillic and Latin forms).
  if (normalized.length >= 5) {
    const stemLength = Math.max(3, normalized.length - 2);
    const cyrillicStem = normalized.slice(0, stemLength);
    keys.add(cyrillicStem);
    const latinStem = transliterate(cyrillicStem);
    if (latinStem) keys.add(latinStem);
  }
  if (direct && direct.length >= 5) {
    const latinStem = direct.slice(0, Math.max(3, direct.length - 2));
    keys.add(latinStem);
    for (const form of backTransliterateAll(latinStem)) keys.add(form);
  }
  return keys;
}

/** Cyrillic back-form of a Latin name (first variant). */
export function backTransliterate(value) {
  return backTransliterateAll(value)[0] ?? '';
}

/**
 * Do two canonical key sets designate the same name? Exact intersection plus
 * prefix matching: "dmitri" (Dmitry stem) starts with "dmitr" (Дмитрий stem),
 * so spelling-convention differences in endings do not split one character.
 */
export function keysIntersect(setA, setB) {
  for (const a of setA) {
    if (setB.has(a)) return true;
  }
  for (const a of setA) {
    if (a.length < 3) continue;
    for (const b of setB) {
      if (b.length < 3) continue;
      // Prefix matching tolerates single-letter ending conventions (Yuri/Yuriy,
      // selest/seleste) but must not merge longer extensions (Леон/Леонардо).
      if (Math.abs(a.length - b.length) > 1) continue;
      if (a.startsWith(b) || b.startsWith(a)) return true;
    }
  }
  return false;
}

/** Convenience wrapper: do two raw name strings match across alphabets? */
export function namesMatch(a, b) {
  return keysIntersect(canonKeys(a), canonKeys(b));
}

export function matchLoreEntries(book, entities, bookName) {
  const aliases = new Set();
  for (const entity of Object.values(entities)) {
    for (const key of canonKeys(entity.name)) aliases.add(key);
    for (const alias of entity.aliases ?? []) for (const key of canonKeys(alias)) aliases.add(key);
  }
  return Object.values(book?.entries ?? {}).filter(entry => !entry.disable && typeof entry.content === 'string').flatMap(entry => {
    const keywords = new Set();
    for (const value of [...(Array.isArray(entry.key) ? entry.key : []), ...(Array.isArray(entry.keysecondary) ? entry.keysecondary : []), entry.comment ?? '']) {
      for (const key of canonKeys(value)) keywords.add(key);
    }
    if (!keywords.size) return [];
    if (![...keywords].some(keyword => aliases.has(keyword) || containsAnyForm(keyword, aliases))) return [];
    return [{ book: bookName, uid: entry.uid, title: entry.comment || entry.key?.join(', ') || 'Запись', content: entry.content }];
  });
}

/** Substring check tolerant to transliteration drift: "zoronoa" matches key "zoro". */
function containsAnyForm(keyword, aliases) {
  for (const alias of aliases) {
    if (alias.length < 3) continue;
    if (keyword.includes(alias) || (keyword.length > 2 && alias.includes(keyword))) return true;
  }
  return false;
}

export async function loadLinkedLore(context, state, maxCharacters = 14000) {
  const names = state.ui?.linkedLorebooks ?? [];
  const sections = [];
  let remaining = maxCharacters;
  for (const name of names) {
    const book = await context.loadWorldInfo(name);
    if (!book?.entries) throw new Error(`Не удалось прочитать подключённый лорбук «${name}». Проверьте вкладку «Лорбуки».`);
    for (const entry of matchLoreEntries(book, state.entities, name)) {
      const text = JSON.stringify(entry);
      if (text.length > remaining) continue;
      sections.push(text);
      remaining -= text.length;
    }
  }
  return sections.join('\n');
}

/** Concatenate enabled entries of a book into a bounded text for character discovery. */
export function extractBookText(book, maxCharacters = 16000) {
  const entries = Object.values(book?.entries ?? {})
    .filter(entry => !entry.disable && typeof entry.content === 'string' && entry.content.trim());
  // Every entry keeps its title AND trigger keys (keys usually are the
  // character's names), so no entry silently disappears in a big book; only the
  // content is shortened proportionally when everything does not fit.
  const headers = entries.map(entry => {
    const keys = Array.isArray(entry.key) ? entry.key.filter(Boolean).join(', ') : '';
    const title = entry.comment || keys || 'Запись';
    return `## ${title}${keys && keys !== title ? ` [ключи: ${keys}]` : ''}`;
  });
  const headerLength = headers.reduce((sum, header) => sum + header.length + 3, 0);
  const totalLength = headerLength + entries.reduce((sum, entry) => sum + entry.content.trim().length, 0);
  const budget = totalLength > maxCharacters
    ? Math.max(60, Math.floor((maxCharacters - headerLength) / Math.max(1, entries.length)))
    : Infinity;
  return entries.map((entry, index) => {
    let content = entry.content.trim();
    if (content.length > budget) content = `${content.slice(0, budget)}…`;
    return `${headers[index]}\n${content}`;
  }).join('\n\n');
}

/**
 * Ask the model to find named recurring characters inside one lorebook.
 * Pass the known registry so the model can recognize alternate spellings and
 * TRANSLATED names (Theodore = Фёдор) that no transliteration can connect.
 * Returns { characters: [...new], knownAliases: [{ id, aliases }] }.
 */
export async function analyzeLorebookCharacters(context, book, bookName, knownEntities = []) {
  const text = extractBookText(book);
  if (!text.trim()) return { characters: [], knownAliases: [] };
  const knownList = knownEntities.map(entity => `${entity.id} = ${entity.name}${(entity.aliases ?? []).length ? ` (${entity.aliases.join(', ')})` : ''}`).join('\n');
  const prompt = `Find named story characters in this lorebook. Include only actual persons with names or stable aliases — not locations, items, factions, generic roles, or one-off mentions. Prefer characters with meaningful descriptions or relationships. Do not include the Narrator, the Game Master, or the user persona.

KNOWN REGISTRY (already registered characters):
${knownList || '(empty)'}

Rules:
- If a lorebook character is the SAME person as someone in the registry — including translated names (Theodore=Фёдор, Catherine=Екатерина), alternate spellings (Zoro=Зоро), or full names (Julian Vega=Юлиан) — do NOT list them as new. Instead return them in "knownAliases" with the registry ID and the new spellings found in the lorebook.
- "characters" must contain only persons absent from the registry.

Return JSON only: {"characters":[{"name":"canonical name as used in the lorebook","aliases":["other spellings"],"note":"one short line about their role"}],"knownAliases":[{"id":"registry ID","aliases":["new spellings from this lorebook"]}]}.

LOREBOOK «${bookName}»:\n${text}`;
  const raw = await withBusy(`анализ лорбука «${bookName}»…`, () => context.generateRaw({
    prompt: [
      { role: 'system', content: 'You identify story characters in lorebook entries and match them against a known registry, including cross-language name equivalences. Return strict JSON only.' },
      { role: 'user', content: prompt },
    ],
    trimNames: false,
  }));
  const { parseCharacters, parseModelObject } = await import('./analyzer.js');
  const data = parseModelObject(raw);
  const characters = parseCharacters(JSON.stringify({ characters: Array.isArray(data.characters) ? data.characters : [] }));
  const registryIds = new Set(knownEntities.map(entity => entity.id));
  const knownAliases = (Array.isArray(data.knownAliases) ? data.knownAliases : [])
    .map(item => ({
      id: String(item?.id ?? ''),
      aliases: [...new Set((Array.isArray(item?.aliases) ? item.aliases : []).map(String).map(alias => alias.trim()).filter(alias => alias && alias.length <= 100))].slice(0, 10),
    }))
    .filter(item => registryIds.has(item.id) && item.aliases.length);
  return { characters, knownAliases };
}
