import { applyOperation, createEntity, createOperation, relationshipId, uniqueId } from '../core/index.js';

function normalizedName(value) {
  return String(value ?? '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

/** Materialize validated analysis into ordinary reversible core operations.
 * acceptedNewCharacters: entries from result.newCharacters that the user confirmed;
 * operations may reference them by scene name, which is mapped to the new stable ID. */
export function applyAnalysisResult(state, result, metadata = {}, acceptedNewCharacters = []) {
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
    add('scale.delta', { relationshipId: id, scaleId: metric, value: Number(proposed.delta) }, proposed.reason);
    // Love and sexual attraction softly feed each other: a quarter of a significant
    // change spills into the partner scale, capped so pure lust cannot instantly create love.
    const partner = metric === 'love' ? 'attraction' : metric === 'attraction' ? 'love' : null;
    if (partner && next.config.scales.some(scale => scale.id === partner) && Math.abs(Number(proposed.delta)) >= 4) {
      const coupled = Math.max(-3, Math.min(3, Math.round(Number(proposed.delta) * 0.25)));
      if (coupled !== 0) add('scale.delta', { relationshipId: id, scaleId: partner, value: coupled }, `Связанная шкала (${metric} ${proposed.delta > 0 ? '+' : ''}${proposed.delta})`);
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
