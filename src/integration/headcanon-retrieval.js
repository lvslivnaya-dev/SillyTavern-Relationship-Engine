/**
 * Which headcanons fit the scene that is about to be generated.
 *
 * Without embeddings a pair is relevant when both of its members appear in the
 * last messages (the persona always counts as present). With embeddings the
 * semantic similarity between the scene and each fact ranks them, and pair
 * presence only adds a small bonus — see semanticScorer.
 */
import { matchingKeys } from './growth.js';

/** Text of the last messages (newest last), trimmed to a budget from the end. */
export function recentSceneText(chat, count = 3, maxCharacters = 3000) {
  const messages = (chat ?? []).filter(message => message && !message.is_system && String(message.mes ?? '').trim()).slice(-count);
  const text = messages.map(message => String(message.mes)).join('\n\n');
  return text.length > maxCharacters ? text.slice(-maxCharacters) : text;
}

/** Entity IDs mentioned in the text by name, alias or Russian word stem. */
export function mentionedEntities(state, text) {
  const lower = String(text ?? '').toLocaleLowerCase('ru-RU');
  const found = new Set();
  for (const entity of Object.values(state.entities ?? {})) {
    if (matchingKeys(entity).some(key => lower.includes(key))) found.add(entity.id);
  }
  const personaId = state.ui?.personaId || '';
  if (personaId && state.entities?.[personaId]) found.add(personaId);
  return found;
}

/** Fallback: both members present → relevant; newer facts first. */
export function mentionScorer(state, sceneText) {
  const present = mentionedEntities(state, sceneText);
  return (item, pair) => {
    if (!pair.ids.every(id => present.has(id))) return 0;
    const time = Date.parse(item.createdAt ?? '') || 0;
    return 1 + time / 1e15;
  };
}

/**
 * Semantic ranking. similarity(item) is the cosine similarity of the fact to the
 * scene (or null when its vector is missing). e5-style models put almost every
 * pair of texts near 0.8 and relevant ones only ~0.05 higher, so presence of
 * both members adds just a nudge (PRESENCE_BONUS), never more than meaning.
 */
const PRESENCE_BONUS = 0.03;

export function semanticScorer(state, sceneText, similarity, threshold = 0) {
  const present = mentionedEntities(state, sceneText);
  return (item, pair) => {
    const value = similarity(item);
    if (value == null || value < threshold) return 0;
    // Keep scores positive: selectHeadcanons skips anything <= 0.
    return Math.max(1e-6, value + (pair.ids.every(id => present.has(id)) ? PRESENCE_BONUS : 0));
  };
}
