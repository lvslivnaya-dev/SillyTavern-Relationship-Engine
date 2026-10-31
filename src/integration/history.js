import { applyOperations, createDefaultState } from '../core/index.js';

/** Split the complete transcript without silently dropping long messages. */
export function createHistoryBatches(messages, maxCharacters = 12000) {
  if (!Number.isInteger(maxCharacters) || maxCharacters < 256) throw new RangeError('Недопустимый размер пакета истории.');
  const segments = [];
  messages.forEach((message, index) => {
    if (message?.is_system) return;
    const text = String(message?.mes ?? '').trim();
    if (!text) return;
    const speaker = message.is_user ? (message.name || 'Пользователь') : 'Повествование';
    const prefix = `[message ${index}] ${speaker}: `;
    const limit = maxCharacters - prefix.length - 2;
    if (limit < 1) throw new RangeError('Слишком длинное имя автора сообщения.');
    for (let offset = 0; offset < text.length; offset += limit) {
      segments.push(`${prefix}${text.slice(offset, offset + limit)}`);
    }
  });
  const batches = [];
  let current = '';
  for (const segment of segments) {
    if (current && current.length + segment.length + 2 > maxCharacters) {
      batches.push(current);
      current = '';
    }
    current += `${current ? '\n\n' : ''}${segment}`;
  }
  if (current) batches.push(current);
  return batches;
}

/** Keep registry/structure and manual edits when replacing automatic estimates. */
export function rebuildWithoutAutomaticHistory(state) {
  const kept = state.operations.filter(operation =>
    operation.type === 'entity.upsert' || operation.type === 'relationship.upsert'
    || (!operation.messageId && operation.transactionId !== 'history-import'));
  let rebuilt = createDefaultState({ scales: state.config.scales });
  rebuilt.baseline = structuredClone(state.baseline);
  rebuilt.entities = structuredClone(state.baseline.entities ?? {});
  rebuilt.relationships = structuredClone(state.baseline.relationships ?? {});
  rebuilt.records = structuredClone(state.baseline.records ?? { memories: [], tensions: [] });
  rebuilt.snapshots = structuredClone(state.snapshots ?? []);
  rebuilt.ui = structuredClone(state.ui ?? { activeRelationshipId: '' });
  return applyOperations(rebuilt, kept);
}

export function historyFingerprint(messages) {
  // Include order, author role and selected swipe text, not extension metadata.
  let hash = 2166136261;
  const text = JSON.stringify(messages.map(message => [Boolean(message?.is_user), message?.mes ?? '']));
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}

/**
 * Evenly sample the WHOLE chat for character discovery. The old version
 * stopped as soon as the budget filled, so long roleplay posts meant only the
 * first few messages were ever seen and characters introduced later were
 * missed. Now every sampled message gets an equal share of the budget
 * (beginning + ending of the post), spread from the first to the last message.
 */
export function sampleHistory(messages, maxCharacters) {
  const available = messages.filter(message => message?.mes?.trim());
  if (!available.length) return [];
  const minExcerpt = 500;
  const count = Math.min(available.length, 60, Math.max(1, Math.floor(maxCharacters / minExcerpt)));
  const indices = new Set();
  for (let index = 0; index < count; index += 1) {
    indices.add(count === 1 ? available.length - 1 : Math.round(index * (available.length - 1) / (count - 1)));
  }
  const picked = [...indices].sort((left, right) => left - right).map(index => available[index]);
  const excerpt = Math.max(200, Math.floor(maxCharacters / picked.length) - 60);
  return picked.map(message => {
    const text = message.mes.trim();
    if (text.length <= excerpt) return message;
    const half = Math.floor(excerpt / 2);
    return { ...message, mes: `${text.slice(0, half)} … ${text.slice(-half)}` };
  });
}
