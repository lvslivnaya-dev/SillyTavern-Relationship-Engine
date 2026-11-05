/**
 * Headcanons: stable facts about how two or more characters relate ("he always
 * walks her home", "the three of them share one umbrella"). One fact per item,
 * each can be switched off. They belong to an unordered group (A & B, or
 * A & B & C), so a group may have headcanons before any line exists.
 *
 * Stored in state.ui.headcanons = { "a|b": {…}, "a|b|c": { auto?: boolean, items: [...] } }.
 * ui is carried through journal replays untouched; automatic items remember
 * their messageId so a swipe, edit or deletion can drop them.
 */
import { uniqueId } from './ids.js';

export const MAX_HEADCANONS_PER_PAIR = 60;
/** A group headcanon covers at most this many characters. */
export const MAX_HEADCANON_GROUP = 8;
const MAX_TEXT = 400;

/** Unordered key of a pair or group: headcanonKey(a, b), headcanonKey(a, b, c) or headcanonKey([a, b, c]). */
export function headcanonKey(...args) {
  const ids = [...new Set((Array.isArray(args[0]) ? args[0] : args).filter(Boolean).map(String))];
  if (ids.length < 2) throw new Error('Выберите хотя бы двух разных персонажей.');
  if (ids.length > MAX_HEADCANON_GROUP) throw new Error(`В одной группе не больше ${MAX_HEADCANON_GROUP} персонажей.`);
  return ids.sort().join('|');
}

export function headcanonPairIds(key) {
  return String(key).split('|');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

/**
 * Automatic filling: an explicit per-pair choice wins; otherwise it is on only
 * for pairs with the persona (character-to-character pairs are opt-in).
 */
export function isAutoHeadcanons(state, key) {
  const explicit = state.ui?.headcanons?.[key]?.auto;
  if (typeof explicit === 'boolean') return explicit;
  const personaId = state.ui?.personaId || '';
  return Boolean(personaId && headcanonPairIds(key).includes(personaId));
}

/** Pairs that have headcanons or an explicit setting, with names, for lists and pickers. */
export function listHeadcanonPairs(state) {
  return Object.entries(state.ui?.headcanons ?? {})
    .filter(([key]) => headcanonPairIds(key).every(id => state.entities?.[id]))
    .map(([key, entry]) => ({
      key,
      ids: headcanonPairIds(key),
      label: headcanonPairIds(key).map(id => state.entities[id].name).join(' & '),
      items: entry.items ?? [],
      enabledCount: (entry.items ?? []).filter(item => item.enabled !== false).length,
      auto: isAutoHeadcanons(state, key),
    }))
    .sort((left, right) => left.label.localeCompare(right.label, 'ru-RU'));
}

/** Returns a new ui.headcanons map with the change applied (input untouched). */
export function updateHeadcanons(state, key, change) {
  const all = clone(state.ui?.headcanons);
  const entry = all[key] ?? { items: [] };
  entry.items ??= [];
  change(entry);
  entry.items = entry.items.slice(-MAX_HEADCANONS_PER_PAIR);
  if (!entry.items.length && typeof entry.auto !== 'boolean') delete all[key];
  else all[key] = entry;
  return all;
}

function normalizeText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

function sameText(left, right) {
  return normalizeText(left).toLocaleLowerCase('ru-RU') === normalizeText(right).toLocaleLowerCase('ru-RU');
}

/** Add facts, skipping empty and duplicate ones. Returns { headcanons, added, ids }. */
export function addHeadcanons(state, key, texts, { source = 'manual', messageId } = {}) {
  const ids = [];
  const headcanons = updateHeadcanons(state, key, entry => {
    for (const raw of texts) {
      const text = normalizeText(raw);
      if (!text || entry.items.some(item => sameText(item.text, text))) continue;
      const id = uniqueId('headcanon');
      entry.items.push({
        id, text, enabled: true, source, createdAt: new Date().toISOString(),
        ...(messageId != null ? { messageId: String(messageId) } : {}),
      });
      ids.push(id);
    }
  });
  return { headcanons, added: ids.length, ids };
}

/**
 * After messages were deleted, chat indices shift. `liveIndex(id)` tells where an
 * automatic fact's message is now (from the message markers) or null when gone.
 */
export function remapAutoHeadcanons(state, liveIndex) {
  const all = clone(state.ui?.headcanons);
  let changed = false;
  for (const [key, entry] of Object.entries(all)) {
    const kept = [];
    for (const item of entry.items ?? []) {
      if (item.source !== 'auto' || item.messageId == null) { kept.push(item); continue; }
      const index = liveIndex(item.id);
      if (index == null) { changed = true; continue; }
      if (String(index) !== item.messageId) { item.messageId = String(index); changed = true; }
      kept.push(item);
    }
    entry.items = kept;
    if (!kept.length && typeof entry.auto !== 'boolean') delete all[key];
  }
  return { headcanons: all, changed };
}

/** Drop automatic facts created by messages that are gone or re-analyzed. */
export function dropAutoHeadcanons(state, shouldDrop) {
  const all = clone(state.ui?.headcanons);
  let dropped = 0;
  for (const [key, entry] of Object.entries(all)) {
    const kept = (entry.items ?? []).filter(item => !(item.source === 'auto' && item.messageId != null && shouldDrop(item.messageId)));
    dropped += (entry.items ?? []).length - kept.length;
    entry.items = kept;
    if (!kept.length && typeof entry.auto !== 'boolean') delete all[key];
  }
  return { headcanons: all, dropped };
}

/**
 * Pick headcanons for the prompt. `score(item, pair)` ranks them (semantic
 * similarity, or a mention-based fallback); items scoring <= 0 are skipped.
 */
export function selectHeadcanons(state, { score, limit = 8, maxCharacters = 1200 } = {}) {
  const candidates = [];
  for (const pair of listHeadcanonPairs(state)) {
    for (const item of pair.items) {
      if (item.enabled === false) continue;
      const value = score ? score(item, pair) : 1;
      if (value > 0) candidates.push({ pair, item, value });
    }
  }
  candidates.sort((left, right) => right.value - left.value);
  const lines = [];
  let size = 0;
  for (const candidate of candidates.slice(0, Math.max(0, limit))) {
    const line = `headcanon[${candidate.pair.label}]: ${candidate.item.text}`;
    if (size + line.length + 1 > maxCharacters) continue;
    lines.push(line);
    size += line.length + 1;
  }
  return lines;
}
