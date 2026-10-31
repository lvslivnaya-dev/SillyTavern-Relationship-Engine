/** Legacy pair records remain readable; new shared records have explicit participants. */
export function collectRecords(state, kind) {
  const result = (state.records?.[kind] ?? []).map(item => normalizeRecord(state, item, null));
  for (const relation of Object.values(state.relationships ?? {})) {
    for (const item of relation[kind] ?? []) result.push(normalizeRecord(state, item, relation));
  }
  return result;
}

/** knownBy defaults to participants: witnesses of a shared event or both members of a pair. */
export function normalizeRecord(state, item, relation) {
  const participantIds = item.participantIds ?? (relation ? [relation.from, relation.to] : []);
  const knownBy = item.knownBy ?? participantIds;
  return {
    ...item,
    participantIds,
    knownBy: knownBy.filter(id => state?.entities?.[id]),
    relationshipId: relation?.id ?? null,
  };
}

export function filterRecords(items, filter = {}) {
  return items.filter(item => {
    if (filter.characterId && item.participantIds.length && !item.participantIds.includes(filter.characterId)) return false;
    if (filter.relationshipId) {
      if (item.relationshipId) return item.relationshipId === filter.relationshipId;
      return !item.participantIds.length || (filter.pairIds ?? []).every(id => item.participantIds.includes(id));
    }
    return true;
  });
}

export function triangleEdges(centerId, firstId, secondId) {
  if (new Set([centerId, firstId, secondId]).size !== 3 || !centerId || !firstId || !secondId) throw new Error('Выберите трёх разных персонажей.');
  return [[firstId, centerId], [secondId, centerId], [firstId, secondId]];
}
