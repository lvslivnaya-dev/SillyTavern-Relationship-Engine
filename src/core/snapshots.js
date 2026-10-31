import { uniqueId } from './ids.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Capture a restorable snapshot and append its descriptor to state.snapshots. */
export function createSnapshot(state, metadata = {}) {
  if (!state || typeof state !== 'object') throw new TypeError('State is required');
  const snapshot = {
    id: metadata.id || uniqueId('snapshot'),
    createdAt: metadata.createdAt || new Date().toISOString(),
    ...(metadata.messageId ? { messageId: metadata.messageId } : {}),
    data: clone({
      schemaVersion: state.schemaVersion,
      config: state.config,
      baseline: state.baseline,
      entities: state.entities,
      relationships: state.relationships,
      records: state.records ?? { memories: [], tensions: [] },
      ui: state.ui ?? {},
      operations: state.operations,
      appliedOperationIds: state.appliedOperationIds,
    }),
  };
  const next = clone(state);
  next.snapshots.push(snapshot);
  return { state: next, snapshot };
}

/** Restore state materialization and journal from a snapshot object or ID. */
export function restoreSnapshot(state, snapshotOrId) {
  const snapshot = typeof snapshotOrId === 'string'
    ? state?.snapshots?.find((candidate) => candidate.id === snapshotOrId)
    : snapshotOrId;
  if (!snapshot?.data) throw new RangeError('Snapshot not found or invalid');
  return { ...clone(snapshot.data), snapshots: clone(state?.snapshots || []) };
}
