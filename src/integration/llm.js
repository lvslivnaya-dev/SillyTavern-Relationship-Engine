/**
 * Routes the extension's own model requests to a cheaper "auxiliary" model:
 *  - 'profile': a SillyTavern Connection Manager profile — the request goes
 *    through the SillyTavern server and the key stays in its secrets;
 *  - 'custom': an OpenAI-compatible endpoint (URL + key + model), also sent
 *    through the SillyTavern server, so browser CORS does not apply.
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
  // Sent through SillyTavern's own "Custom (OpenAI-compatible)" backend: the request
  // leaves from the server, so browser CORS never applies. The key travels as a header
  // of this request only and is not written to SillyTavern's secrets.
  const data = await serverRequest(context, '/api/backends/chat-completions/generate', {
    ...customSource(aux),
    model: aux.model,
    messages,
    max_tokens: maxTokens,
    temperature: 0.3,
    stream: false,
  });
  if (data?.error) throw new Error(`Вспомогательный API: ${data.error.message ?? 'ошибка провайдера'}`);
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('Вспомогательный API вернул ответ без текста.');
  return content;
}

/** Model IDs of an OpenAI-compatible endpoint, listed through the SillyTavern server. */
export async function fetchAuxModels(context, url, key) {
  if (!url) throw new Error('Сначала укажите URL.');
  const data = await serverRequest(context, '/api/backends/chat-completions/status', customSource({ url, key }));
  if (data?.error) throw new Error(data.message || 'Провайдер не отдал список моделей. Проверьте URL и ключ.');
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  return [...new Set(list.map(item => String(item?.id ?? item ?? '')).filter(Boolean))].sort();
}

function customSource(aux) {
  return {
    chat_completion_source: 'custom',
    custom_url: baseUrl(aux.url),
    // YAML is a superset of JSON; SillyTavern merges these headers over its own Authorization.
    ...(aux.key ? { custom_include_headers: JSON.stringify({ Authorization: `Bearer ${aux.key}` }) } : {}),
  };
}

async function serverRequest(context, path, body) {
  let response;
  try {
    response = await fetch(path, { method: 'POST', headers: context.getRequestHeaders(), body: JSON.stringify(body) });
  } catch (error) {
    throw new Error(`Нет связи с сервером SillyTavern: ${error?.message ?? error}`);
  }
  const text = await safeText(response);
  if (!response.ok) throw new Error(`Вспомогательный API: HTTP ${response.status} ${text.slice(0, 200)}`.trim());
  try { return JSON.parse(text); }
  catch { throw new Error(`Вспомогательный API вернул не JSON: ${text.slice(0, 120)}`); }
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

async function safeText(response) {
  try { return await response.text(); } catch { return ''; }
}
