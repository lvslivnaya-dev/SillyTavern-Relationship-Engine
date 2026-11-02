import { applyOperation, createEntity, createOperation, relationshipId, uniqueId } from '../core/index.js';
import { coupledDeltas } from './coupling.js';

function normalizedName(value) {
  return String(value ?? '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

/** Human-readable list of proposed scale changes for the confirmation popup.
 * Operations may reference characters by registry ID or by scene name. */
export function describeProposedChanges(state, operations, threshold) {
  const nameOf = reference => {
    if (state.entities?.[reference]) return state.entities[reference].name;
    const found = Object.values(state.entities ?? {}).find(entity =>
      [entity.name, ...(entity.aliases ?? [])].some(candidate => normalizedName(candidate) === normalizedName(reference)));
    return found?.name ?? String(reference ?? '?');
  };
  const labelOf = metric => state.config?.scales?.find(scale => scale.id === metric)?.label ?? metric;
  return (operations ?? []).map(operation => {
    const delta = Number(operation.delta);
    return {
      from: nameOf(operation.subjectId),
      to: nameOf(operation.objectId),
      scale: labelOf(operation.metric),
      delta,
      reason: String(operation.reason ?? ''),
      large: Math.abs(delta) >= threshold,
    };
  }).sort((left, right) => Number(right.large) - Number(left.large) || Math.abs(right.delta) - Math.abs(left.delta));
}

/** Materialize validated analysis into ordinary reversible core operations.
 * acceptedNewCharacters: entries from result.newCharacters that the user confirmed;
 * operations may reference them by scene name, which is mapped to the new stable ID.
 * options.linkedScales: false disables spills into related scales. */
export function applyAnalysisResult(state, result, metadata = {}, acceptedNewCharacters = [], options = {}) {
  let next = state;
  const personaId = state.ui?.personaId || '';
  const operations = [];
  const nameToId = new Map();

  for (const character of acceptedNewCharacters) {
    const entity = createEntity(character.name, { aliases: character.aliases });
    if (next.entities[entity.id]) { nameToId.set(normalizedName(character.name), entity.id); continue; }
    next = applyOperation(next, createOperation('entity.upsert', entity, {
      id: uniqueId('scene-character'), reason: `Персонаж найден в сцене${character.note ? `: ${character.note}` : ''}`, timestamp: new Date().toISOString(),
    }));
    nameToId.set(normalizedName(character.name), entity.id);
    for (const alias of character.aliases ?? []) nameToId.set(normalizedName(alias), entity.id);
  }

  function resolveId(reference) {
    if (!reference) return null;
    if (next.entities[reference]) return reference;
    const byNewName = nameToId.get(normalizedName(reference));
    if (byNewName) return byNewName;
    for (const entity of Object.values(next.entities)) {
      const candidates = [entity.name, ...(entity.aliases ?? [])];
      if (candidates.some(candidate => normalizedName(candidate) === normalizedName(reference))) return entity.id;
    }
    return null;
  }

  function ensurePair(subjectId, objectId) {
    if (subjectId === objectId || !next.entities[subjectId] || !next.entities[objectId]) return null;
    const id = relationshipId(subjectId, objectId);
    if (!next.relationships[id]) next = applyOperation(next, createOperation('relationship.upsert', {
      from: subjectId, to: objectId,
    }, { id: `relationship:${id}`, reason: 'Связь обнаружена при анализе', timestamp: new Date().toISOString() }));
    return id;
  }
  function add(type, payload, reason) {
    const operation = createOperation(type, payload, {
      ...metadata, id: uniqueId('analysis'), reason, timestamp: new Date().toISOString(),
    });
    next = applyOperation(next, operation);
    operations.push(operation);
  }
  // Resolve first, so linked-scale spills know which scales the analyzer evidenced itself.
  const resolved = [];
  for (const proposed of result.operations ?? []) {
    const subjectId = resolveId(proposed.subjectId);
    const objectId = resolveId(proposed.objectId);
    if (!subjectId || !objectId) continue;
    if (personaId && subjectId === personaId) continue;
    let metric = proposed.metric;
    if (metric === 'affection' && !next.config.scales.some(scale => scale.id === metric)
      && next.config.scales.some(scale => scale.id === 'affinity')) metric = 'affinity';
    if (!next.config.scales.some(scale => scale.id === metric)) continue;
    const id = ensurePair(subjectId, objectId);
    if (!id) continue;
    if ((next.relationships[id].hiddenScales ?? []).includes(metric)) continue;
    resolved.push({ id, metric, delta: Number(proposed.delta), reason: proposed.reason });
  }
  const evidenced = new Map();
  for (const change of resolved) {
    if (!evidenced.has(change.id)) evidenced.set(change.id, new Set());
    evidenced.get(change.id).add(change.metric);
  }
  for (const change of resolved) {
    add('scale.delta', { relationshipId: change.id, scaleId: change.metric, value: change.delta }, change.reason);
    if (options.linkedScales === false) continue;
    const hidden = new Set(next.relationships[change.id].hiddenScales ?? []);
    const available = new Set(next.config.scales.map(scale => scale.id).filter(scaleId => !hidden.has(scaleId)));
    for (const spill of coupledDeltas(change.metric, change.delta, available, evidenced.get(change.id))) {
      add('scale.delta', { relationshipId: change.id, scaleId: spill.scaleId, value: spill.value },
        `Связанная шкала (${change.metric} ${change.delta > 0 ? '+' : ''}${change.delta})`);
    }
  }
  for (const [collection, type] of [['memories', 'memory.add'], ['tensions', 'tension.add']]) {
    for (const item of result[collection] ?? []) {
      if (Array.isArray(item.participantIds)) {
        const participants = [...new Set(item.participantIds.map(resolveId).filter(Boolean))].sort();
        if (!participants.length || participants.length !== item.participantIds.length) continue;
        if ((next.records?.[collection] ?? []).some(existing => existing.text.trim().toLocaleLowerCase() === item.text.trim().toLocaleLowerCase()
          && JSON.stringify([...(existing.participantIds ?? [])].sort()) === JSON.stringify(participants))) continue;
        const knownBy = (item.knownBy ?? participants).filter(id => next.entities[id]);
        if (item.knownBy && !participants.every(id => knownBy.includes(id))) {
          knownBy.push(...participants);
        }
        add(type, { shared: true, item: { id: uniqueId(collection), text: item.text, intensity: item.intensity, participantIds: participants, knownBy: [...new Set(knownBy)].sort(), createdAt: new Date().toISOString(), source: 'chat-analysis' } }, item.text);
        continue;
      }
      const subjectId = resolveId(item.subjectId);
      const objectId = resolveId(item.objectId);
      const id = subjectId && objectId ? ensurePair(subjectId, objectId) : null;
      if (!id) continue;
      if (next.relationships[id][collection].some(existing => existing.text?.trim().toLocaleLowerCase() === item.text.trim().toLocaleLowerCase())) continue;
      add(type, { relationshipId: id, item: { id: uniqueId(collection), text: item.text, intensity: item.intensity, createdAt: new Date().toISOString(), source: 'chat-analysis' } }, item.text);
    }
  }
  return { state: next, operations };
}
