import { relationshipId, stableId, uniqueId } from './ids.js';
import { clamp } from './schema.js';
import { createDefaultState, createEntity, createRelationship, getScale } from './state.js';

const TYPES = new Set([
  'entity.upsert', 'entity.remove', 'relationship.upsert', 'relationship.remove',
  'scale.delta', 'scale.set', 'factors.set', 'record.toggle',
  'memory.add', 'memory.remove', 'tension.add', 'tension.remove', 'stage.set',
]);

/** Normalize and bound a growth-factor list: { scaleId, direction: up|down, text }. */
export function normalizeFactors(factors, state) {
  if (!Array.isArray(factors)) throw new TypeError('factors must be an array');
  const seen = new Set();
  const result = [];
  for (const factor of factors.slice(0, 20)) {
    if (!factor || typeof factor !== 'object') continue;
    const scaleId = String(factor.scaleId ?? '');
    const direction = factor.direction === 'down' ? 'down' : 'up';
    const text = String(factor.text ?? '').trim().slice(0, 200);
    if (!text || !state.config.scales.some(scale => scale.id === scaleId)) continue;
    const key = `${scaleId}\u0000${direction}\u0000${text.toLocaleLowerCase('ru-RU')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ scaleId, direction, text });
  }
  return result;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Create a validated operation envelope with a unique ID. */
export function createOperation(type, payload, metadata = {}) {
  if (!TYPES.has(type)) throw new RangeError(`Unsupported operation type: ${type}`);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('Operation payload must be an object');
  return {
    id: metadata.id || uniqueId('op'),
    type,
    payload: clone(payload),
    ...(metadata.transactionId ? { transactionId: metadata.transactionId } : {}),
    ...(metadata.messageId ? { messageId: metadata.messageId } : {}),
    ...(Number.isInteger(metadata.messageIndex) ? { messageIndex: metadata.messageIndex } : {}),
    ...(metadata.timestamp ? { timestamp: metadata.timestamp } : {}),
    ...(metadata.reason ? { reason: String(metadata.reason) } : {}),
    ...(Number.isFinite(metadata.confidence) ? { confidence: metadata.confidence } : {}),
  };
}

function relationshipFor(next, payload, create = false) {
  const id = payload.relationshipId || (payload.from && payload.to ? relationshipId(payload.from, payload.to) : null);
  if (!id) throw new TypeError('relationshipId or from/to is required');
  if (!next.relationships[id] && create) {
    if (!next.entities[payload.from] || !next.entities[payload.to]) throw new RangeError('Relationship endpoints must exist');
    next.relationships[id] = createRelationship(next, payload.from, payload.to, { id });
  }
  if (!next.relationships[id]) throw new RangeError(`Unknown relationship: ${id}`);
  return next.relationships[id];
}

function applyMutation(next, operation) {
  const payload = operation.payload;
  switch (operation.type) {
    case 'entity.upsert': {
      const entity = createEntity(payload.name, payload);
      next.entities[entity.id] = entity;
      break;
    }
    case 'relationship.upsert': {
      if (!next.entities[payload.from] || !next.entities[payload.to]) throw new RangeError('Relationship endpoints must exist');
      const relation = createRelationship(next, payload.from, payload.to, payload);
      for (const [scaleId, value] of Object.entries(relation.scales)) {
        getScale(next, scaleId);
        relation.scales[scaleId] = clamp(value);
      }
      next.relationships[relation.id] = relation;
      break;
    }
    case 'scale.delta':
    case 'scale.set': {
      const relation = relationshipFor(next, payload, true);
      const scale = getScale(next, payload.scaleId);
      const current = relation.scales[payload.scaleId] ?? scale.default;
      relation.scales[payload.scaleId] = clamp(operation.type === 'scale.delta' ? current + payload.value : payload.value);
      break;
    }
    case 'memory.add':
    case 'tension.add': {
      const relation = payload.shared ? (next.records ??= { memories: [], tensions: [] }) : relationshipFor(next, payload);
      const key = operation.type.startsWith('memory') ? 'memories' : 'tensions';
      const item = typeof payload.item === 'string'
        ? { id: payload.itemId || stableId(operation.id, key.slice(0, -1)), text: payload.item }
        : clone(payload.item);
      if (!item || typeof item.id !== 'string' || !item.id) throw new TypeError(`${key} item needs an ID`);
      if (payload.shared) {
        item.participantIds = [...new Set(item.participantIds ?? [])];
        if (item.participantIds.some(id => !next.entities[id])) throw new RangeError('Unknown record participant');
      }
      if (!relation[key].some((candidate) => candidate.id === item.id)) relation[key].push(item);
      break;
    }
    case 'memory.remove':
    case 'tension.remove': {
      const relation = payload.shared ? (next.records ??= { memories: [], tensions: [] }) : relationshipFor(next, payload);
      const key = operation.type.startsWith('memory') ? 'memories' : 'tensions';
      relation[key] = relation[key].filter((item) => item.id !== payload.itemId);
      break;
    }
    case 'record.toggle': {
      const relation = payload.shared ? (next.records ??= { memories: [], tensions: [] }) : relationshipFor(next, payload);
      const key = payload.kind === 'tension' ? 'tensions' : 'memories';
      const item = relation[key].find((candidate) => candidate.id === payload.itemId);
      if (item) item.disabled = Boolean(payload.disabled);
      break;
    }
    case 'factors.set': {
      const relation = relationshipFor(next, payload);
      relation.factors = normalizeFactors(payload.factors, next);
      break;
    }
    case 'relationship.remove': {
      const id = payload.relationshipId || (payload.from && payload.to ? relationshipId(payload.from, payload.to) : null);
      if (!id) throw new TypeError('relationshipId or from/to is required');
      if (!next.relationships[id]) break;
      delete next.relationships[id];
      if (next.ui?.activeRelationshipId === id) next.ui.activeRelationshipId = '';
      break;
    }
    case 'entity.remove': {
      const entityId = payload.entityId;
      if (!entityId || !next.entities[entityId]) break;
      delete next.entities[entityId];
      for (const id of Object.keys(next.relationships)) {
        const relation = next.relationships[id];
        if (relation.from === entityId || relation.to === entityId) delete next.relationships[id];
      }
      if (next.records) {
        for (const key of ['memories', 'tensions']) {
          next.records[key] = (next.records[key] ?? [])
            .map(item => ({
              ...item,
              participantIds: (item.participantIds ?? []).filter(id => id !== entityId),
              knownBy: (item.knownBy ?? []).filter(id => id !== entityId),
            }))
            .filter(item => (item.participantIds ?? []).length > 0 || !Array.isArray(item.participantIds));
        }
      }
      for (const relation of Object.values(next.relationships)) {
        for (const key of ['memories', 'tensions']) {
          relation[key] = (relation[key] ?? []).filter(item =>
            !(item.participantIds ?? []).includes(entityId) || (item.participantIds ?? []).length > 1);
        }
      }
      if (next.ui) {
        next.ui.triangles = (next.ui.triangles ?? []).filter(triangle =>
          triangle.centerId !== entityId && triangle.firstId !== entityId && triangle.secondId !== entityId);
        if (next.ui.personaId === entityId) next.ui.personaId = '';
        if (next.ui.activeRelationshipId && !next.relationships[next.ui.activeRelationshipId]) next.ui.activeRelationshipId = '';
      }
      break;
    }
    case 'stage.set':
      relationshipFor(next, payload).stage = payload.stage ?? null;
      break;
    default:
      throw new RangeError(`Unsupported operation type: ${operation.type}`);
  }
}

/** Apply one operation immutably. Applying an existing ID is a no-op. */
export function applyOperation(state, operation) {
  if (!state || typeof state !== 'object') throw new TypeError('State is required');
  if (!operation || typeof operation.id !== 'string' || !operation.id) throw new TypeError('Operation ID is required');
  if (!TYPES.has(operation.type)) throw new RangeError(`Unsupported operation type: ${operation.type}`);
  if (state.appliedOperationIds.includes(operation.id)) return state;
  const next = clone(state);
  applyMutation(next, operation);
  next.operations.push(clone(operation));
  next.appliedOperationIds.push(operation.id);
  return next;
}

/** Apply operations atomically; an error leaves the input state untouched. */
export function applyOperations(state, operations) {
  if (!Array.isArray(operations)) throw new TypeError('Operations must be an array');
  if (!state || typeof state !== 'object') throw new TypeError('State is required');
  const next = clone(state);
  const appliedIds = new Set(next.appliedOperationIds);
  for (const operation of operations) {
    if (!operation || typeof operation.id !== 'string' || !operation.id) throw new TypeError('Operation ID is required');
    if (!TYPES.has(operation.type)) throw new RangeError(`Unsupported operation type: ${operation.type}`);
    if (appliedIds.has(operation.id)) continue;
    applyMutation(next, operation);
    next.operations.push(clone(operation));
    next.appliedOperationIds.push(operation.id);
    appliedIds.add(operation.id);
  }
  return next;
}

function replay(state, operations) {
  let next = createDefaultState({ scales: state.config.scales });
  next.baseline = clone(state.baseline);
  next.entities = clone(state.baseline.entities || {});
  next.relationships = clone(state.baseline.relationships || {});
  next.records = clone(state.baseline.records || { memories: [], tensions: [] });
  next.snapshots = clone(state.snapshots || []);
  next.ui = clone(state.ui || { activeRelationshipId: '' });
  next = applyOperations(next, operations);
  return next;
}

/** Roll back every operation in a transaction and replay the remaining journal. */
export function rollbackTransaction(state, transactionId) {
  if (!transactionId) throw new TypeError('transactionId is required');
  return replay(state, state.operations.filter((operation) => operation.transactionId !== transactionId));
}

/** Roll back every operation associated with a message. */
export function rollbackMessage(state, messageId) {
  if (!messageId) throw new TypeError('messageId is required');
  return replay(state, state.operations.filter((operation) => operation.messageId !== messageId));
}

/** Replace a message's effects, suitable for swipe and edited-message replay. */
export function reapplyMessage(state, messageId, replacementOperations) {
  if (!Array.isArray(replacementOperations)) throw new TypeError('replacementOperations must be an array');
  const rolledBack = rollbackMessage(state, messageId);
  const normalized = replacementOperations.map((operation) => ({ ...clone(operation), messageId }));
  return applyOperations(rolledBack, normalized);
}
