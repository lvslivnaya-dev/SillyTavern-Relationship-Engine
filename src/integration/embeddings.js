/**
 * Text embeddings for the semantic choice of headcanons.
 *
 *  - 'local': transformers.js in the browser (model downloaded once, then cached
 *    by the browser); free, understands Russian, but heavy on weak phones;
 *  - 'api': an embeddings endpoint (OpenAI-compatible /embeddings or Gemini
 *    batchEmbedContents) called from the browser.
 *
 * Vectors are cached in memory and in IndexedDB (per browser), keyed by the
 * model and a hash of the text, so a fact is embedded once.
 */
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';

export const LOCAL_MODELS = Object.freeze({
  'Xenova/multilingual-e5-small': { label: 'multilingual-e5-small — многоязычная, ~33 МБ (q8)', query: 'query: ', passage: 'passage: ' },
});

const memory = new Map();
let extractor = null;
let extractorKey = '';

export function configKey(config) {
  return config.mode === 'local'
    ? `local:${config.localModel}:${config.dtype}`
    : `api:${config.format}:${config.url}:${config.model}`;
}

export function cosine(left, right) {
  let dot = 0;
  let a = 0;
  let b = 0;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    dot += left[index] * right[index];
    a += left[index] * left[index];
    b += right[index] * right[index];
  }
  return a && b ? dot / Math.sqrt(a * b) : 0;
}

function hash(text) {
  let value = 2166136261;
  for (const char of String(text)) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return (value >>> 0).toString(36);
}

/** Embed texts; kind is 'query' (the scene) or 'passage' (a headcanon). Cached. */
export async function embedTexts(config, texts, kind = 'passage') {
  const key = configKey(config);
  const result = new Array(texts.length);
  const missing = [];
  for (const [index, text] of texts.entries()) {
    const cacheKey = `${key}|${kind}|${hash(text)}`;
    const cached = memory.get(cacheKey) ?? await idbGet(cacheKey);
    if (cached) { memory.set(cacheKey, cached); result[index] = cached; }
    else missing.push({ index, text, cacheKey });
  }
  for (let start = 0; start < missing.length; start += 32) {
    const batch = missing.slice(start, start + 32);
    const vectors = config.mode === 'local'
      ? await embedLocal(config, batch.map(item => item.text), kind)
      : await embedApi(config, batch.map(item => item.text));
    batch.forEach((item, offset) => {
      const vector = Array.from(vectors[offset] ?? []);
      if (!vector.length) throw new Error('Модель эмбеддингов вернула пустой вектор.');
      memory.set(item.cacheKey, vector);
      idbPut(item.cacheKey, vector);
      result[item.index] = vector;
    });
  }
  return result;
}

async function embedLocal(config, texts, kind) {
  const model = LOCAL_MODELS[config.localModel] ? config.localModel : Object.keys(LOCAL_MODELS)[0];
  const key = `${model}:${config.dtype}`;
  if (!extractor || extractorKey !== key) {
    extractorKey = key;
    extractor = (async () => {
      const { pipeline, env } = await import(TRANSFORMERS_URL);
      env.allowLocalModels = false;
      return pipeline('feature-extraction', model, { dtype: config.dtype === 'q4' ? 'q4' : 'q8' });
    })();
    extractor.catch(() => { extractor = null; extractorKey = ''; });
  }
  const run = await extractor;
  const prefix = LOCAL_MODELS[model][kind] ?? '';
  const output = await run(texts.map(text => `${prefix}${text}`), { pooling: 'mean', normalize: true });
  return output.tolist();
}

async function embedApi(config, texts) {
  if (!config.url || !config.model) throw new Error('Укажите URL и модель эмбеддингов.');
  const base = String(config.url).trim().replace(/\/+$/, '');
  if (config.format === 'gemini') {
    const model = config.model.startsWith('models/') ? config.model : `models/${config.model}`;
    const data = await corsAwareJson(`${base}/${model}:batchEmbedContents?key=${encodeURIComponent(config.key ?? '')}`, {
      requests: texts.map(text => ({ model, content: { parts: [{ text }] } })),
    }, {});
    return (data.embeddings ?? []).map(item => item.values ?? []);
  }
  const data = await corsAwareJson(`${base.replace(/\/embeddings$/, '')}/embeddings`, { model: config.model, input: texts },
    config.key ? { Authorization: `Bearer ${config.key}` } : {});
  return [...(data.data ?? [])].sort((left, right) => (left.index ?? 0) - (right.index ?? 0)).map(item => item.embedding ?? []);
}

/** Direct request; if the browser blocks it (CORS), retry through SillyTavern's CORS proxy when it is enabled. */
async function corsAwareJson(url, body, headers) {
  const init = { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) };
  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    try {
      response = await fetch(`/proxy/${url}`, init);
    } catch {
      throw new Error('Провайдер эмбеддингов не принимает запросы из браузера (CORS), а CORS-прокси SillyTavern выключен. Включите enableCorsProxy в config.yaml или выберите локальную модель.');
    }
    if (response.status === 404 || response.status === 403) {
      throw new Error('Провайдер эмбеддингов не принимает запросы из браузера (CORS), а CORS-прокси SillyTavern выключен. Включите enableCorsProxy в config.yaml или выберите локальную модель.');
    }
  }
  const text = await response.text().catch(() => '');
  if (!response.ok) throw new Error(`Эмбеддинги: HTTP ${response.status} ${text.slice(0, 200)}`.trim());
  try { return JSON.parse(text); } catch { throw new Error(`Эмбеддинги: ответ не JSON — ${text.slice(0, 120)}`); }
}

// IndexedDB cache; any failure (private mode, blocked storage) just means no persistent cache.
let dbPromise = null;
function db() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  dbPromise ??= new Promise(resolve => {
    try {
      const request = indexedDB.open('relationship-engine-embeddings', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('vectors');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
}

async function idbGet(key) {
  try {
    const database = await db();
    if (!database) return null;
    return await new Promise(resolve => {
      const request = database.transaction('vectors', 'readonly').objectStore('vectors').get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    });
  } catch { return null; }
}

async function idbPut(key, value) {
  try {
    const database = await db();
    database?.transaction('vectors', 'readwrite').objectStore('vectors').put(value, key);
  } catch { /* no persistent cache */ }
}
