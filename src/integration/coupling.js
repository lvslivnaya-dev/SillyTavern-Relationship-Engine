/**
 * Linked scales: a change the analyzer found evidence for spills a small share
 * into scales that plausibly move with it (growing affection warms friendship
 * and trust; resentment feeds hostility and cools affection).
 *
 * Only one hop — a spill never triggers further spills — so changes cannot
 * snowball. `factor` is the share of the source delta; a negative factor moves
 * the linked scale the opposite way. `when` limits a rule to growth ('up') or
 * decline ('down') of the source scale.
 */
export const COUPLING_RULES = Object.freeze([
  { from: 'affection', to: 'friendship', factor: 0.3, when: 'any' },
  { from: 'affection', to: 'trust', factor: 0.2, when: 'up' },
  { from: 'friendship', to: 'affection', factor: 0.3, when: 'any' },
  { from: 'friendship', to: 'trust', factor: 0.25, when: 'any' },
  { from: 'love', to: 'affection', factor: 0.4, when: 'any' },
  { from: 'love', to: 'trust', factor: 0.2, when: 'up' },
  { from: 'love', to: 'attraction', factor: 0.25, when: 'any' },
  // Pure lust must not create love quickly.
  { from: 'attraction', to: 'love', factor: 0.15, when: 'any' },
  { from: 'trust', to: 'friendship', factor: 0.15, when: 'up' },
  { from: 'trust', to: 'friendship', factor: 0.2, when: 'down' },
  { from: 'trust', to: 'resentment', factor: -0.3, when: 'down' },
  { from: 'respect', to: 'approval', factor: 0.3, when: 'any' },
  { from: 'respect', to: 'trust', factor: 0.15, when: 'up' },
  { from: 'approval', to: 'respect', factor: 0.25, when: 'any' },
  { from: 'resentment', to: 'hostility', factor: 0.3, when: 'up' },
  { from: 'resentment', to: 'affection', factor: -0.2, when: 'up' },
  { from: 'hostility', to: 'resentment', factor: 0.3, when: 'up' },
  { from: 'hostility', to: 'trust', factor: -0.3, when: 'up' },
  { from: 'hostility', to: 'friendship', factor: -0.3, when: 'up' },
  { from: 'jealousy', to: 'resentment', factor: 0.2, when: 'up' },
  { from: 'fear', to: 'trust', factor: -0.25, when: 'up' },
]);

const MIN_SOURCE_DELTA = 3;
const MAX_SPILL = 4;

/**
 * Spills for one analyzer change.
 * available: scale IDs that exist and are visible on this line;
 * evidenced: scale IDs the analyzer changed itself for this line — those are left alone.
 */
export function coupledDeltas(metric, delta, available, evidenced = new Set()) {
  const value = Number(delta);
  if (!Number.isFinite(value) || Math.abs(value) < MIN_SOURCE_DELTA) return [];
  const direction = value > 0 ? 'up' : 'down';
  const totals = new Map();
  for (const rule of COUPLING_RULES) {
    if (rule.from !== metric || (rule.when !== 'any' && rule.when !== direction)) continue;
    if (!available.has(rule.to) || evidenced.has(rule.to)) continue;
    const raw = value * rule.factor;
    const spill = Math.sign(raw) * Math.min(MAX_SPILL, Math.max(1, Math.round(Math.abs(raw))));
    totals.set(rule.to, (totals.get(rule.to) ?? 0) + spill);
  }
  return [...totals].filter(([, spill]) => spill !== 0).map(([scaleId, spill]) => ({ scaleId, value: spill }));
}
