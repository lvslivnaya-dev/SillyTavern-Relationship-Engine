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
  fear: { high: 'боится, избегает', mid: 'осторожна', low: 'тревожность', neg: 'чувствует себя рядом в безопасности' },
  resentment: { high: 'глубокая обида', mid: 'копит недовольство', low: 'упрёк', neg: '' },
  hostility: { high: 'открытая вражда', mid: 'колкости, сопротивление', low: 'неприязнь', neg: '' },
  jealousy: { high: 'ревнует, собственничество', mid: 'следит за соперником', low: 'тревога о месте', neg: '' },
  dependency: { high: 'не представляет жизни без него', mid: 'опирается во всём', low: 'привычка', neg: '' },
  approval: { high: 'всецело одобряет его поступки и выбор', mid: 'одобряет', low: 'скорее одобряет', neg: 'осуждает его поступки' },
  guilt: { high: 'мучительное чувство вины перед ним', mid: 'чувствует вину, хочет загладить', low: 'укол совести', neg: '' },
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
  const includeKind = { memories: options.includeMemories !== false, tensions: options.includeTensions !== false };
  const memoryLimit = includeKind.memories ? Math.max(0, options.memoryLimit ?? 3) : 0;
  const tensionLimit = includeKind.tensions ? Math.max(0, options.tensionLimit ?? 3) : 0;
  const maxRelationships = Math.max(0, options.maxRelationships ?? Infinity);
  const personaId = state.ui?.personaId || '';

  // Strongest feelings first (lines toward the persona get a bonus), so a budget cut drops the faintest lines.
  const weight = relation => Object.entries(relation.scales || {})
    .filter(([id]) => !(relation.hiddenScales ?? []).includes(id))
    .reduce((sum, [, value]) => sum + Math.abs(Number(value) || 0), 0) + (personaId && relation.to === personaId ? 50 : 0);
  const selected = Object.values(state.relationships || {})
    .filter((relation) => relation.from !== personaId)
    .filter((relation) => !relationshipSet || relationshipSet.has(relation.id))
    .filter((relation) => !actorSet || actorSet.has(relation.from) || actorSet.has(relation.to))
    .sort((left, right) => weight(right) - weight(left) || left.id.localeCompare(right.id))
    .slice(0, maxRelationships);

  const relationLines = [];
  for (const relation of selected) {
    const from = state.entities[relation.from]?.name || relation.from;
    const to = state.entities[relation.to]?.name || relation.to;
    const hidden = new Set(relation.hiddenScales ?? []);
    const scales = Object.entries(relation.scales)
      .filter(([id, value]) => !hidden.has(id) && (!scaleSet || scaleSet.has(id)) && (options.includeNeutral || value !== 0))
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
    const factors = options.includeFactors === false ? '' : (relation.factors || []).slice(0, 4)
      .map(factor => `${factor.direction === 'down' ? '-' : '+'}${factor.scaleId}: ${factor.text}`).join(' | ');
    if (factors) fields.push(`grow[${factors.trim()}]`);
    relationLines.push(fields.filter(Boolean).join(';'));
  }

  // Shared records and secret pair records, ranked by intensity and freshness.
  const candidates = [];
  for (const kind of ['memories', 'tensions']) {
    if (!includeKind[kind]) continue;
    for (const item of collectRecords(state, kind).filter(item => !item.relationshipId && !item.disabled)) {
      const participants = item.participantIds.map(id => state.entities[id]?.name || id).join(',') || 'all';
      candidates.push({ item, line: `shared-${kind}[${participants}]=${clip(item.text)}${describeKnownBy(state, item)}` });
    }
    for (const item of collectRecords(state, kind).filter(item => item.relationshipId && !item.disabled)) {
      const annotation = describeKnownBy(state, item);
      if (annotation) candidates.push({ item, line: `secret-${kind}=${clip(item.text)}${annotation}` });
    }
  }
  // Freshness comes from creation time, so memories and tensions are ranked together
  // (list order would make every tension look newer than every memory).
  const time = candidate => Date.parse(candidate.item.createdAt ?? candidate.item.timestamp ?? '') || 0;
  candidates.forEach((candidate, order) => { candidate.order = order; });
  candidates.sort((left, right) => time(left) - time(right) || left.order - right.order);
  const total = candidates.length;
  candidates.forEach((candidate, rank) => {
    const freshness = total > 1 ? rank / (total - 1) : 1;
    candidate.score = (Number(candidate.item.intensity) || 3) + 4 * freshness;
  });

  const ruleLines = [];
  // Strangers are toggled by the user only; the flag is mutual, stored as a sorted "a|b" key.
  for (const key of state.ui?.strangerPairs ?? []) {
    const [first, second] = key.split('|').map(id => state.entities[id]?.name);
    if (!first || !second) continue;
    ruleLines.push(`strangers[${first} & ${second}]: not introduced yet — they do not know each other's names, history or private details. They must meet naturally or be introduced by someone who knows both; never use the other's name before learning it in the story.`);
  }
  for (const triangle of state.ui?.triangles ?? []) {
    ruleLines.push(`triangle center=${state.entities[triangle.centerId]?.name}; others=${[triangle.firstId, triangle.secondId].map(id => state.entities[id]?.name).join(',')}; grouping only, do not invent love or rivalry`);
  }

  const budget = Number.isFinite(options.maxCharacters) ? Math.max(0, options.maxCharacters) : Infinity;
  const ranked = [...candidates].sort((left, right) => right.score - left.score);
  if (budget === Infinity) {
    return [...ruleLines, ...relationLines, ...candidates.map(candidate => candidate.line)].join('\n');
  }
  // Budget by section instead of cutting the tail: rules always, then lines and
  // records share the rest; whatever one section leaves unused goes to the other.
  const rules = fitLines(ruleLines, budget);
  const rest = budget - rules.used;
  const relationShare = ranked.length ? Math.floor(rest * 0.55) : rest;
  const relations = fitLines(relationLines, relationShare);
  const records = fitLines(ranked.map(candidate => candidate.line), rest - relations.used);
  const extraRelations = fitLines(relationLines.filter(line => !relations.kept.includes(line)), rest - relations.used - records.used);
  const keptRelations = relationLines.filter(line => relations.kept.includes(line) || extraRelations.kept.includes(line));
  // Records go out in story order, not in ranking order.
  const keptRecords = candidates.filter(candidate => records.kept.includes(candidate.line)).map(candidate => candidate.line);
  return [...rules.kept, ...keptRelations, ...keptRecords].join('\n');
}

function clip(text, limit = 240) {
  const value = String(text ?? '');
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

/** Whole lines that fit into `limit` characters (newlines included); a lone oversized line is shortened. */
function fitLines(lines, limit) {
  const kept = [];
  let used = 0;
  for (const line of lines) {
    const cost = line.length + 1;
    if (used + cost <= limit) { kept.push(line); used += cost; continue; }
    if (!kept.length && limit - used > 80) {
      const short = `${line.slice(0, limit - used - 2)}…`;
      kept.push(short);
      used += short.length + 1;
    }
  }
  return { kept, used };
}

/** Annotate only when some registered character is unaware. Naming every unaware
 * character made each line hundreds of characters long, so only the knowers are listed. */
function describeKnownBy(state, item) {
  const known = item.knownBy ?? item.participantIds ?? [];
  const someoneUnaware = Object.values(state.entities).some(entity => !known.includes(entity.id));
  if (!someoneUnaware) return '';
  const names = known.map(id => state.entities[id]?.name || id).join(',');
  return ` [known only to: ${names}; everyone else is unaware]`;
}
