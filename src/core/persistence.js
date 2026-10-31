import { relationshipId } from './ids.js';
import { clamp, DEFAULT_SCALES, SCHEMA_VERSION, validateState } from './schema.js';
import { createDefaultState, createEntity, createRelationship } from './state.js';
import { applyOperations } from './operations.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Migrate an unversioned/legacy document or clone an existing v1 document. */
export function migrateState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Imported state must be an object');
  if (input.schemaVersion === SCHEMA_VERSION) return clone(input);
  if (input.schemaVersion != null && input.schemaVersion !== 0) throw new RangeError(`Unsupported schemaVersion: ${input.schemaVersion}`);

  const state = createDefaultState({ scales: input.scales || input.config?.scales });
  const legacyEntities = input.entities || input.characters || [];
  const entityList = Array.isArray(legacyEntities) ? legacyEntities : Object.values(legacyEntities);
  for (const legacy of entityList) {
    const entity = createEntity(legacy.name, { id: legacy.id, aliases: legacy.aliases || [] });
    state.entities[entity.id] = entity;
  }
  const legacyRelationships = input.relationships || input.relations || [];
  const relationshipList = Array.isArray(legacyRelationships) ? legacyRelationships : Object.values(legacyRelationships);
  for (const legacy of relationshipList) {
    const relation = createRelationship(state, legacy.from, legacy.to, {
      ...legacy,
      id: legacy.id || relationshipId(legacy.from, legacy.to),
    });
    for (const scale of state.config.scales) relation.scales[scale.id] = clamp(relation.scales[scale.id] ?? scale.default);
    state.relationships[relation.id] = relation;
  }
  state.baseline = { entities: clone(state.entities), relationships: clone(state.relationships) };
  return state;
}

/** Parse, migrate, and validate a JSON string or plain object. */
export function importState(source) {
  let parsed;
  try {
    parsed = typeof source === 'string' ? JSON.parse(source) : clone(source);
  } catch (error) {
    const wrapped = new SyntaxError(`Invalid relationship state JSON: ${error instanceof Error ? error.message : String(error)}`);
    wrapped.cause = error;
    throw wrapped;
  }
  const state = migrateState(parsed);
  if (Array.isArray(state.config?.scales)) {
    for (const scale of DEFAULT_SCALES) {
      if (scale.id === 'affection' && state.config.scales.some(item => item.id === 'affinity')) continue;
      if (!state.config.scales.some(item => item.id === scale.id)) state.config.scales.push(clone(scale));
    }
    for (const relation of [...Object.values(state.relationships ?? {}), ...Object.values(state.baseline?.relationships ?? {})]) {
      for (const scale of state.config.scales) relation.scales[scale.id] ??= scale.default;
    }
  }
  const result = validateState(state);
  if (!result.valid) throw new TypeError(`Invalid relationship state: ${result.errors.join('; ')}`);
  validateReplay(state);
  return state;
}

function validateReplay(state) {
  try {
    let replay = createDefaultState({ scales: state.config.scales });
    replay.baseline = clone(state.baseline);
    replay.entities = clone(state.baseline.entities || {});
    replay.relationships = clone(state.baseline.relationships || {});
    replay.records = clone(state.baseline.records || { memories: [], tensions: [] });
    replay.snapshots = clone(state.snapshots || []);
    replay.ui = clone(state.ui || { activeRelationshipId: '' });
    replay = applyOperations(replay, state.operations);
    if (JSON.stringify(replay.entities) !== JSON.stringify(state.entities)
      || JSON.stringify(replay.relationships) !== JSON.stringify(state.relationships)
      || JSON.stringify(replay.records) !== JSON.stringify(state.records ?? { memories: [], tensions: [] })) {
      throw new Error('materialized state does not match its operation journal');
    }
  } catch (error) {
    throw new TypeError(`Invalid relationship operation journal: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Serialize a validated v1 state to JSON. */
export function exportState(state, space = 0) {
  const result = validateState(state);
  if (!result.valid) throw new TypeError(`Cannot export invalid state: ${result.errors.join('; ')}`);
  return JSON.stringify(state, null, space);
}
