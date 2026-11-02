/**
 * Routes the extension's own model requests to a cheaper "auxiliary" model:
 *  - 'profile': a SillyTavern Connection Manager profile — the request goes
 *    through the SillyTavern server and the key stays in its secrets;
 *  - 'custom': an OpenAI-compatible endpoint (URL + key + model) called from
 *    the browser; some providers block such requests (CORS).
 * Callers keep using context.generateRaw: routedContext() swaps only that method.
 */
import { logEvent } from './diagnostics.js';

export const AUX_PURPOSES = Object.freeze({
  analysis: 'Анализ ответов и истории',
  discovery: 'Поиск персонажей',
  generation: 'Генерация факторов, целей и хедканонов',
});

export function auxEnabledFor(settings, purpose) {
  const aux = settings?.aux ?? {};
  return (aux.mode === 'profile' || aux.mode === 'custom') && aux.purposes?.[purpose] !== false;
}

/** The SillyTavern context with generateRaw routed for this purpose (or untouched when aux is off). */
export function routedContext(context, settings, purpose) {
  if (!auxEnabledFor(settings, purpose)) return context;
  return new Proxy(context, {
    get(target, property) {
      if (property === 'generateRaw') return options => routedGenerate(target, settings, options, purpose);
      return Reflect.get(target, property);
    },
  });
}

function toMessages(prompt) {
  return Array.isArray(prompt) ? prompt.map(({ role, content }) => ({ role, content: String(content ?? '') })) : [{ role: 'user', content: String(prompt ?? '') }];
}

async function routedGenerate(context, settings, options, purpose) {
  const aux = settings.aux;
  try {
    return await auxGenerate(context, aux, toMessages(options.prompt));
  } catch (error) {
    if (!aux.fallbackToMain) throw error;
    logEvent('warn', `Вспомогательный API не ответил (${AUX_PURPOSES[purpose] ?? purpose}) — запрос ушёл в основной API`, error);
    return context.generateRaw(options);
  }
}

export async function auxGenerate(context, aux, messages) {
  const maxTokens = Math.max(256, Math.min(32000, Number(aux.maxTokens) || 4096));
  if (aux.mode === 'profile') {
    const service = context.ConnectionManagerRequestService;
    if (!service) throw new Error('В этой версии SillyTavern нет профилей подключений.');
    if (!aux.profileId) throw new Error('Выберите профиль подключения для вспомогательного API.');
    const result = await service.sendRequest(aux.profileId, messages, maxTokens);
    const content = typeof result === 'string' ? result : result?.content;
    if (typeof content !== 'string') throw new Error('Профиль подключения вернул пустой ответ.');
    return content;
  }
  if (!aux.url || !aux.model) throw new Error('Укажите URL и модель вспомогательного API.');
  let response;
  try {
    response = await fetch(`${baseUrl(aux.url)}/chat/completions`, {
      method: 'POST',
      headers: authHeaders(aux.key),
      body: JSON.stringify({ model: aux.model, messages, max_tokens: maxTokens, temperature: 0.3, stream: false }),
    });
  } catch (error) {
    throw new Error(`Нет связи со вспомогательным API. Если адрес верный, провайдер, скорее всего, блокирует запросы из браузера (CORS) — подключите его через профиль подключения SillyTavern. (${error?.message ?? error})`);
  }
  if (!response.ok) throw new Error(`Вспомогательный API: HTTP ${response.status} ${(await safeText(response)).slice(0, 200)}`);
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('Вспомогательный API вернул ответ без текста.');
  return content;
}

/** Model IDs offered by an OpenAI-compatible endpoint (GET /models). */
export async function fetchAuxModels(url, key) {
  if (!url) throw new Error('Сначала укажите URL.');
  let response;
  try {
    response = await fetch(`${baseUrl(url)}/models`, { headers: authHeaders(key) });
  } catch (error) {
    throw new Error(`Нет связи с ${baseUrl(url)}: возможно, провайдер блокирует запросы из браузера (CORS). (${error?.message ?? error})`);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${(await safeText(response)).slice(0, 200)}`);
  const data = await response.json();
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  return [...new Set(list.map(item => String(item?.id ?? item ?? '')).filter(Boolean))].sort();
}

/** Connection Manager profiles usable for requests, as [{ id, name }]. */
export function listAuxProfiles(context) {
  try {
    return (context.ConnectionManagerRequestService?.getSupportedProfiles?.() ?? [])
      .map(profile => ({ id: profile.id, name: profile.name || profile.id }));
  } catch {
    return [];
  }
}

function baseUrl(url) {
  return String(url).trim().replace(/\/+$/, '').replace(/\/(chat\/completions|models)$/, '');
}

function authHeaders(key) {
  return { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) };
}

async function safeText(response) {
  try { return await response.text(); } catch { return ''; }
}
