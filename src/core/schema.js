export const SCHEMA_VERSION = 1;
export const VALUE_MIN = -100;
export const VALUE_MAX = 100;
export const MAX_OPERATIONS = 10_000;
export const MAX_ENTITIES = 1_000;
export const MAX_RELATIONSHIPS = 10_000;
const OPERATION_TYPES = new Set([
  'entity.upsert', 'entity.remove', 'relationship.upsert', 'relationship.remove', 'scale.delta', 'scale.set', 'factors.set', 'record.toggle',
  'memory.add', 'memory.remove', 'tension.add', 'tension.remove', 'stage.set',
]);

export const DEFAULT_SCALES = Object.freeze([
  Object.freeze({ id: 'affection', label: 'Привязанность', default: 0 }),
  Object.freeze({ id: 'love', label: 'Любовь', default: 0 }),
  Object.freeze({ id: 'trust', label: 'Доверие', default: 0 }),
  Object.freeze({ id: 'respect', label: 'Уважение', default: 0 }),
  Object.freeze({ id: 'attraction', label: 'Влечение', default: 0 }),
  Object.freeze({ id: 'friendship', label: 'Дружба', default: 0 }),
  Object.freeze({ id: 'fear', label: 'Страх', default: 0 }),
  Object.freeze({ id: 'resentment', label: 'Обида', default: 0 }),
  Object.freeze({ id: 'hostility', label: 'Враждебность', default: 0 }),
  Object.freeze({ id: 'jealousy', label: 'Ревность', default: 0 }),
  Object.freeze({ id: 'dependency', label: 'Зависимость', default: 0 }),
]);

/** Clamp a relationship scale value to the engine range. */
export function clamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('Scale value must be a finite number');
  }
  return Math.max(VALUE_MIN, Math.min(VALUE_MAX, value));
}

/** Normalize and validate configurable scale definitions. */
export function normalizeScales(scales = DEFAULT_SCALES) {
  if (!Array.isArray(scales) || scales.length === 0) {
    throw new TypeError('At least one scale is required');
  }
  const seen = new Set();
  return scales.map((scale) => {
    if (!scale || typeof scale.id !== 'string' || !/^[a-z][a-z0-9_-]*$/i.test(scale.id)) {
      throw new TypeError('Scale IDs must be non-empty alphanumeric identifiers');
    }
    if (seen.has(scale.id)) throw new TypeError(`Duplicate scale ID: ${scale.id}`);
    seen.add(scale.id);
    return {
      id: scale.id,
      label: typeof scale.label === 'string' && scale.label.trim() ? scale.label.trim() : scale.id,
      default: clamp(scale.default ?? 0),
    };
  });
}

/** Validate a v1 state and return all discovered errors. */
function entityIdsSet(state) {
  return new Set(Object.keys(state?.entities || {}));
}

export function validateState(state) {
  const errors = [];
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { valid: false, errors: ['State must be an object'] };
  }
  if (state.schemaVersion !== SCHEMA_VERSION) errors.push(`Unsupported schemaVersion: ${state.schemaVersion}`);
  try {
    normalizeScales(state.config?.scales);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  for (const key of ['entities', 'relationships', 'baseline']) {
    if (!state[key] || typeof state[key] !== 'object' || Array.isArray(state[key])) errors.push(`${key} must be an object`);
  }
  if (!Array.isArray(state.operations)) errors.push('operations must be an array');
  if (!Array.isArray(state.appliedOperationIds)) errors.push('appliedOperationIds must be an array');
  if (!Array.isArray(state.snapshots)) errors.push('snapshots must be an array');
  const sharedRecords = state.records;
  if (sharedRecords != null && (typeof sharedRecords !== 'object' || Array.isArray(sharedRecords))) errors.push('records must be an object');
  else if (sharedRecords) {
    for (const kind of ['memories', 'tensions']) {
      if (!Array.isArray(sharedRecords[kind])) errors.push(`records.${kind} must be an array`);
      else for (const item of sharedRecords[kind]) {
        if (!item || typeof item.id !== 'string' || !item.id) errors.push(`records.${kind} item needs an ID`);
        if (typeof item?.text !== 'string' || !item.text.trim()) errors.push(`records.${kind} item needs text`);
        if (!Array.isArray(item?.participantIds)) errors.push(`records.${kind} participantIds must be an array`);
        else if (item.participantIds.some(id => !entityIdsSet(state).has(id))) errors.push(`records.${kind} has unknown participant`);
        if (item?.knownBy != null) {
          if (!Array.isArray(item.knownBy)) errors.push(`records.${kind} knownBy must be an array`);
          else if (item.knownBy.some(id => !entityIdsSet(state).has(id))) errors.push(`records.${kind} has unknown knownBy entry`);
        }
      }
    }
  }

  const entityIds = new Set(Object.keys(state.entities || {}));
  const scaleIds = new Set((state.config?.scales || []).map(scale => scale?.id).filter(Boolean));
  if (entityIds.size > MAX_ENTITIES) errors.push(`Entity limit exceeded: ${entityIds.size}/${MAX_ENTITIES}`);
  for (const [id, entity] of Object.entries(state.entities || {})) {
    if (entity?.id !== id) errors.push(`Entity key/id mismatch: ${id}`);
    if (typeof entity?.name !== 'string' || !entity.name.trim()) errors.push(`Entity ${id} has no name`);
    if (!Array.isArray(entity?.aliases)) errors.push(`Entity ${id} aliases must be an array`);
  }
  for (const [id, relation] of Object.entries(state.relationships || {})) {
    if (relation?.id !== id) errors.push(`Relationship key/id mismatch: ${id}`);
    if (!entityIds.has(relation?.from) || !entityIds.has(relation?.to)) errors.push(`Relationship ${id} has unknown endpoint`);
    if (!relation?.scales || typeof relation.scales !== 'object') errors.push(`Relationship ${id} scales must be an object`);
    for (const value of Object.values(relation?.scales || {})) {
      if (typeof value !== 'number' || value < VALUE_MIN || value > VALUE_MAX) errors.push(`Relationship ${id} has invalid scale value`);
    }
    if (!Array.isArray(relation?.memories) || !Array.isArray(relation?.tensions)) errors.push(`Relationship ${id} collections must be arrays`);
    if (relation?.factors != null) {
      if (!Array.isArray(relation.factors)) errors.push(`Relationship ${id} factors must be an array`);
      else for (const factor of relation.factors) {
        if (!factor || typeof factor !== 'object') errors.push(`Relationship ${id} has invalid factor`);
        else {
          if (!scaleIds.has(factor.scaleId)) errors.push(`Relationship ${id} factor has unknown scale`);
          if (factor.direction !== 'up' && factor.direction !== 'down') errors.push(`Relationship ${id} factor direction must be up or down`);
          if (typeof factor.text !== 'string' || !factor.text.trim()) errors.push(`Relationship ${id} factor needs text`);
        }
      }
    }
  }
  if (Object.keys(state.relationships || {}).length > MAX_RELATIONSHIPS) errors.push(`Relationship limit exceeded: ${Object.keys(state.relationships || {}).length}/${MAX_RELATIONSHIPS}`);
  if ((state.operations || []).length > MAX_OPERATIONS) errors.push(`Operation limit exceeded: ${state.operations.length}/${MAX_OPERATIONS}`);
  const operationIds = new Set();
  for (const operation of state.operations || []) {
    if (!operation || typeof operation.id !== 'string' || !operation.id) errors.push('Every operation needs an ID');
    else if (operationIds.has(operation.id)) errors.push(`Duplicate operation ID: ${operation.id}`);
    else operationIds.add(operation.id);
    if (!OPERATION_TYPES.has(operation?.type)) errors.push(`Unsupported operation type: ${operation?.type}`);
    if (!operation?.payload || typeof operation.payload !== 'object' || Array.isArray(operation.payload)) errors.push(`Operation ${operation?.id || '?'} payload must be an object`);
    if (operation?.messageId != null && typeof operation.messageId !== 'string') errors.push(`Operation ${operation?.id || '?'} messageId must be a string`);
  }
  const appliedIds = new Set(state.appliedOperationIds || []);
  if (appliedIds.size !== (state.appliedOperationIds || []).length) errors.push('appliedOperationIds contains duplicates');
  for (const id of operationIds) if (!appliedIds.has(id)) errors.push(`Operation ${id} is missing from appliedOperationIds`);
  for (const id of appliedIds) if (!operationIds.has(id)) errors.push(`appliedOperationId ${id} has no operation`);
  return { valid: errors.length === 0, errors };
}
