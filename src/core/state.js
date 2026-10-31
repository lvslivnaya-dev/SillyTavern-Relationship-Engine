import { normalizeAlias, relationshipId, stableId } from './ids.js';
import { clamp, normalizeScales, SCHEMA_VERSION } from './schema.js';

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** Create an empty JSON-serializable v1 engine state. */
export function createDefaultState(options = {}) {
  const scales = normalizeScales(options.scales);
  return {
    schemaVersion: SCHEMA_VERSION,
    config: { scales },
    baseline: { entities: {}, relationships: {}, records: { memories: [], tensions: [] } },
    entities: {},
    relationships: {},
    records: { memories: [], tensions: [] },
    operations: [],
    appliedOperationIds: [],
    snapshots: [],
    ui: { activeRelationshipId: '' },
  };
}

/** Create a normalized entity record with a stable ID and deduplicated aliases. */
export function createEntity(name, options = {}) {
  if (typeof name !== 'string' || !name.trim()) throw new TypeError('Entity name is required');
  const canonicalName = name.trim();
  const id = options.id || stableId(canonicalName, 'entity');
  const aliases = [];
  const seen = new Set([normalizeAlias(canonicalName)]);
  for (const alias of options.aliases || []) {
    const normalized = normalizeAlias(alias);
    if (normalized && !seen.has(normalized)) {
      aliases.push(alias.trim());
      seen.add(normalized);
    }
  }
  return {
    id,
    name: canonicalName,
    aliases,
    ...(options.avatar ? { avatar: options.avatar } : {}),
    ...(options.sourceId ? { sourceId: options.sourceId } : {}),
  };
}

/** Create a directed relationship populated with configured scale defaults. */
export function createRelationship(state, from, to, options = {}) {
  if (!state?.config?.scales) throw new TypeError('A valid state is required');
  if (!from || !to) throw new TypeError('Both relationship endpoints are required');
  const configuredIds = new Set(state.config.scales.map((scale) => scale.id));
  for (const scaleId of Object.keys(options.scales || {})) {
    if (!configuredIds.has(scaleId)) throw new RangeError(`Unknown scale: ${scaleId}`);
  }
  const scales = Object.fromEntries(state.config.scales.map((scale) => [
    scale.id,
    clamp(options.scales?.[scale.id] ?? scale.default),
  ]));
  return {
    id: options.id || relationshipId(from, to),
    from,
    to,
    scales,
    memories: clone(options.memories || []),
    tensions: clone(options.tensions || []),
    factors: clone(options.factors || []),
    stage: options.stage ?? null,
  };
}

/** Return the configured scale definition or throw for an unknown scale. */
export function getScale(state, scaleId) {
  const scale = state?.config?.scales?.find((candidate) => candidate.id === scaleId);
  if (!scale) throw new RangeError(`Unknown scale: ${scaleId}`);
  return scale;
}
