const counters = new Map();

/** Normalize a user-facing name for alias matching. */
export function normalizeAlias(value) {
  if (typeof value !== 'string') throw new TypeError('Alias must be a string');
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
}

function hash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

/** Build a deterministic, URL-safe identifier from a stable source value. */
export function stableId(value, prefix = 'id') {
  const normalized = normalizeAlias(String(value));
  if (!normalized) throw new TypeError('ID source cannot be empty');
  const slug = normalized
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36) || 'item';
  return `${prefix}:${slug}:${hash(normalized)}`;
}

/** Build the stable identifier for a directed edge. Direction is significant. */
export function relationshipId(from, to) {
  if (!from || !to) throw new TypeError('Both relationship endpoints are required');
  return stableId(`${from}\u0000${to}`, 'rel');
}

/** Create a process-unique operation, transaction, or snapshot identifier. */
export function uniqueId(prefix = 'op') {
  if (globalThis.crypto?.randomUUID) return `${prefix}:${globalThis.crypto.randomUUID()}`;
  const next = (counters.get(prefix) || 0) + 1;
  counters.set(prefix, next);
  return `${prefix}:${Date.now().toString(36)}:${next.toString(36)}`;
}

/** Resolve a name, alias, or exact ID to an entity ID. */
export function resolveEntityId(state, reference) {
  if (!state || typeof state !== 'object') throw new TypeError('State is required');
  if (state.entities?.[reference]) return reference;
  const wanted = normalizeAlias(reference);
  for (const entity of Object.values(state.entities || {})) {
    const candidates = [entity.name, ...(entity.aliases || [])];
    if (candidates.some((candidate) => normalizeAlias(candidate) === wanted)) return entity.id;
  }
  return null;
}
