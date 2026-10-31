import { collectRecords } from './records.js';

function compactItems(items, limit) {
  return items.filter(item => !item.disabled).slice(-limit).map((item) => item.text || item.label || item.id).filter(Boolean).join(' | ');
}

/** Short behavioral hints per scale level so the model can act on numbers, not just read them. */
const SCALE_HINTS = {
  love: { high: 'глубокая любовь, романтическая преданность', mid: 'влюблённость, романтическое чувство', low: 'зарождающаяся симпатия', neg: 'любовь угасла' },
  attraction: { high: 'сильное сексуальное желание, физический голод', mid: 'физический интерес, возбуждение рядом', low: 'лёгкий физический интерес', neg: 'физически отталкивает' },
  affection: { high: 'дорожит человеком, тянется душой', mid: 'теплеет', low: 'симпатия', neg: 'равнодушие' },
  trust: { high: 'верит на слово, открывается', mid: 'прислушивается', low: 'осторожное доверие', neg: 'подозревает' },
  friendship: { high: 'свой человек', mid: 'товарищеское тепло', low: 'приязнь', neg: 'отчуждение' },
  respect: { high: 'восхищается', mid: 'ценит', low: 'признание', neg: 'пренебрегает' },
  fear: { high: 'боится, избегает', mid: 'осторожна', low: 'тревожность', neg: '' },
  resentment: { high: 'глубокая обида', mid: 'копит недовольство', low: 'упрёк', neg: '' },
  hostility: { high: 'открытая вражда', mid: 'колкости, сопротивление', low: 'неприязнь', neg: '' },
  jealousy: { high: 'ревнует, собственничество', mid: 'следит за соперником', low: 'тревога о месте', neg: '' },
  dependency: { high: 'не представляет жизни без него', mid: 'опирается во всём', low: 'привычка', neg: '' },
};

function describeScale(id, value) {
  const hints = SCALE_HINTS[id];
  if (!hints) return '';
  const magnitude = Math.abs(value);
  if (magnitude < 30) return magnitude >= 10 ? `(${hints.low})` : '';
  const hint = magnitude >= 65 ? hints.high : hints.mid;
  return hint ? `(${value < 0 && hints.neg ? hints.neg : hint})` : '';
}

/** Select a compact relationship context string for a runtime prompt. */
export function selectRuntimePrompt(state, options = {}) {
  if (!state || typeof state !== 'object') throw new TypeError('State is required');
  const actorSet = options.actorIds ? new Set(options.actorIds) : null;
  const relationshipSet = options.relationshipIds ? new Set(options.relationshipIds) : null;
  const scaleSet = options.scales ? new Set(options.scales) : null;
  const memoryLimit = Math.max(0, options.memoryLimit ?? 3);
  const tensionLimit = Math.max(0, options.tensionLimit ?? 3);
  const maxRelationships = Math.max(0, options.maxRelationships ?? 8);

  const selected = Object.values(state.relationships || {})
    .filter((relation) => relation.from !== (state.ui?.personaId || ''))
    .filter((relation) => !relationshipSet || relationshipSet.has(relation.id))
    .filter((relation) => !actorSet || actorSet.has(relation.from) || actorSet.has(relation.to))
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, maxRelationships);

  const lines = [];
  for (const relation of selected) {
    const from = state.entities[relation.from]?.name || relation.from;
    const to = state.entities[relation.to]?.name || relation.to;
    const scales = Object.entries(relation.scales)
      .filter(([id, value]) => (!scaleSet || scaleSet.has(id)) && (options.includeNeutral || value !== 0))
      .map(([id, value]) => {
        const hint = describeScale(id, value);
        return `${id}=${value}${hint}`;
      })
      .join(',');
    const fields = [`${from}>${to}`, scales];
    if (relation.stage) fields.push(`stage=${relation.stage}`);
    const memories = compactItems(relation.memories, memoryLimit);
    const tensions = compactItems(relation.tensions, tensionLimit);
    if (memories) fields.push(`mem=${memories}`);
    if (tensions) fields.push(`ten=${tensions}`);
    const factors = (relation.factors || []).slice(0, 4)
      .map(factor => `${factor.direction === 'down' ? '-' : '+'}${factor.scaleId}: ${factor.text}`).join(' | ');
    if (factors) fields.push(`grow[${factors.trim()}]`);
    lines.push(fields.filter(Boolean).join(';'));
  }
  for (const kind of ['memories', 'tensions']) {
    const items = collectRecords(state, kind).filter(item => !item.relationshipId && !item.disabled).slice(-8);
    for (const item of items) {
      const participants = item.participantIds.map(id => state.entities[id]?.name || id).join(',') || 'all';
      lines.push(`shared-${kind}[${participants}]=${item.text}${describeKnownBy(state, item)}`);
    }
  }
  for (const kind of ['memories', 'tensions']) {
    for (const item of collectRecords(state, kind).filter(item => item.relationshipId && !item.disabled)) {
      const annotation = describeKnownBy(state, item);
      if (annotation) lines.push(`secret-${kind}=${item.text}${annotation}`);
    }
  }
  for (const triangle of state.ui?.triangles ?? []) {
    lines.push(`triangle center=${state.entities[triangle.centerId]?.name}; others=${[triangle.firstId, triangle.secondId].map(id => state.entities[id]?.name).join(',')}; grouping only, do not invent love or rivalry`);
  }
  return lines.join('\n');
}

/** Annotate only when some registered character is unaware; compact output stays unchanged otherwise. */
function describeKnownBy(state, item) {
  const known = item.knownBy ?? item.participantIds ?? [];
  const others = Object.values(state.entities)
    .filter(entity => !known.includes(entity.id))
    .map(entity => entity.name);
  if (!others.length) return '';
  const names = known.map(id => state.entities[id]?.name || id).join(',');
  return ` [known only to: ${names}] (secret from ${others.join(',')})`;
}
