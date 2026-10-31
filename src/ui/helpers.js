const FALLBACK_METRICS = [
  { key: 'affection', label: 'Привязанность', min: -100, max: 100 },
  { key: 'trust', label: 'Доверие', min: -100, max: 100 },
  { key: 'respect', label: 'Уважение', min: -100, max: 100 },
  { key: 'attraction', label: 'Влечение', min: -100, max: 100 },
];

const METRIC_LABELS = {
  affection: 'Привязанность', love: 'Любовь', trust: 'Доверие', respect: 'Уважение', attraction: 'Влечение',
  friendship: 'Дружба', fear: 'Страх', resentment: 'Обида', hostility: 'Враждебность',
  jealousy: 'Ревность', dependency: 'Зависимость',
};

let controlId = 0;

export function element(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(options)) {
    if (value == null) continue;
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') Object.assign(node.style, value);
    else if (key in node && key !== 'role') node[key] = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child != null) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function button(label, className, onClick, title = label) {
  const node = element('button', { type: 'button', className, text: label, title, 'aria-label': title });
  node.addEventListener('click', onClick);
  return node;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

export function metricDefinitions(snapshot, pair) {
  const source = snapshot?.metricDefinitions || snapshot?.config?.scales || snapshot?.scales || pair?.metricDefinitions;
  if (Array.isArray(source) && source.length) {
    const definitions = source.map((item) => typeof item === 'string'
      ? { key: item, label: METRIC_LABELS[item] || titleCase(item), min: -100, max: 100 }
      : { min: -100, max: 100, ...item, key: item.key || item.id, label: METRIC_LABELS[item.key || item.id] || item.label || titleCase(item.key || item.id) });
    for (const [key, label] of Object.entries(METRIC_LABELS)) {
      if (key === 'affection' && definitions.some(item => item.key === 'affinity')) continue;
      if (!definitions.some(item => item.key === key)) definitions.push({ key, label, min: -100, max: 100 });
    }
    for (const definition of definitions) if (definition.key === 'affinity') definition.label = 'Привязанность';
    return definitions;
  }
  const metrics = pair?.metrics || pair?.scales;
  if (metrics && Object.keys(metrics).length) {
    const keys = [...new Set([...Object.keys(metrics), ...Object.keys(METRIC_LABELS)])]
      .filter(key => !(key === 'affection' && Object.hasOwn(metrics, 'affinity')));
    return keys.map((key) => ({ key, label: key === 'affinity' ? 'Привязанность' : METRIC_LABELS[key] || titleCase(key), min: -100, max: 100 }));
  }
  return Object.entries(METRIC_LABELS).map(([key, label]) => ({ key, label, min: -100, max: 100 }));
}

export function titleCase(value) {
  return String(value || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function characterName(character, fallback = 'Неизвестно') {
  return character?.name || character?.displayName || character?.label || fallback;
}

export function characterId(character) {
  return String(character?.id ?? character?.key ?? character?.name ?? '');
}

export function pairId(pair) {
  if (!pair) return '';
  return String(pair?.id ?? `${pair?.sourceId ?? pair?.from ?? ''}->${pair?.targetId ?? pair?.to ?? ''}`);
}

export function pairSource(pair) {
  return String(pair?.sourceId ?? pair?.from ?? pair?.source?.id ?? '');
}

export function pairTarget(pair) {
  return String(pair?.targetId ?? pair?.to ?? pair?.target?.id ?? '');
}

export function getPair(snapshot, selectedId) {
  const pairs = Array.isArray(snapshot?.pairs) ? snapshot.pairs : [];
  const active = selectedId || snapshot?.activePairId || pairId(snapshot?.activePair);
  const found = pairs.find((pair) => pairId(pair) === String(active));
  if (found) return found;
  if (selectedId && String(selectedId).includes('->')) {
    const [sourceId, targetId] = String(selectedId).split('->');
    return { id: String(selectedId), sourceId, targetId, metrics: {}, memories: [], tensions: [] };
  }
  return snapshot?.activePair || pairs[0] || null;
}

export function pairLabel(snapshot, pair) {
  if (!pair) return 'Активная пара не выбрана';
  const characters = Array.isArray(snapshot?.characters) ? snapshot.characters : [];
  const find = (id) => characters.find((character) => characterId(character) === id);
  const source = pair.source || find(pairSource(pair));
  const target = pair.target || find(pairTarget(pair));
  return `${characterName(source, pairSource(pair) || 'Неизвестно')} → ${characterName(target, pairTarget(pair) || 'Неизвестно')}`;
}

export function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(date);
}

export function createFacade({ store, callbacks = {}, ...options } = {}) {
  let localSnapshot = {};
  const read = () => {
    const value = typeof store?.getSnapshot === 'function' ? store.getSnapshot()
      : typeof store?.getState === 'function' ? store.getState()
        : store?.state || store?.snapshot;
    return normalizeSnapshot(value || localSnapshot || {});
  };
  const invoke = (name, payload) => {
    const handler = callbacks[name] || options[name] || (typeof store?.[name] === 'function' ? store[name].bind(store) : null);
    return handler?.(payload);
  };
  return {
    read,
    invoke,
    setLocal(snapshot) { localSnapshot = snapshot || {}; },
    subscribe(listener) {
      if (typeof store?.subscribe !== 'function') return () => {};
      const unsubscribe = store.subscribe((value) => listener(normalizeSnapshot(value || read())));
      return typeof unsubscribe === 'function' ? unsubscribe : () => {};
    },
  };
}

export function normalizeSnapshot(value = {}) {
  const characters = Array.isArray(value.characters) ? value.characters
    : Array.isArray(value.entities) ? value.entities
      : Object.values(value.entities || {});
  const pairs = Array.isArray(value.pairs) ? value.pairs
    : Array.isArray(value.relationships) ? value.relationships
      : Object.values(value.relationships || {});
  const journal = value.journal || value.history || value.operations || [];
  const metricDefinitions = value.metricDefinitions || value.config?.scales;
  const activePairId = value.activePairId || value.activeRelationshipId || value.ui?.activeRelationshipId || value.activePair?.id || '';
  const personaId = value.personaId || value.ui?.personaId || '';
  const widgetSettings = value.widget || value.settings?.widget;
  return {
    ...value,
    characters,
    pairs,
    journal,
    metricDefinitions,
    activePairId,
    personaId,
    widget: widgetSettings ? {
      ...widgetSettings,
      position: widgetSettings.position || (widgetSettings.x != null || widgetSettings.y != null
        ? { x: widgetSettings.x, y: widgetSettings.y }
        : undefined),
    } : value.widget,
  };
}

export function dispatch(host, name, detail) {
  host.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}

export function downloadJson(data, filename = 'relationships.json') {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = element('a', { href: url, download: filename });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function listen(target, type, handler, options, cleanups) {
  target.addEventListener(type, handler, options);
  cleanups.push(() => target.removeEventListener(type, handler, options));
}

export function ensureContainer(container) {
  if (container instanceof Element || container instanceof ShadowRoot) return container;
  if (!document.body) throw new Error('Для интерфейса отношений требуется document.body или явный контейнер.');
  return document.body;
}

export function nextControlId(prefix = 'relationship-control') {
  controlId += 1;
  return `${prefix}-${controlId}`;
}
