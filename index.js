import {
  applyOperation,
  applyOperations,
  createDefaultState,
  createEntity,
  createOperation,
  importState,
  relationshipId,
  rollbackMessage,
  addHeadcanons,
  dropAutoHeadcanons,
  headcanonKey,
  headcanonPairIds,
  isAutoHeadcanons,
  listHeadcanonPairs,
  remapAutoHeadcanons,
  selectHeadcanons,
  updateHeadcanons,
  selectRuntimePrompt,
  uniqueId,
} from './src/core/index.js';
import { analyzeHistoryBatch, analyzeMessage, discoverHistoryCharacters } from './src/integration/analyzer.js';
import { detectConflicts } from './src/integration/conflicts.js';
import { clearRelationshipPrompt, updateRelationshipPrompt } from './src/integration/prompt.js';
import { getSettings } from './src/integration/settings.js';
import { createHistoryBatches, rebuildWithoutAutomaticHistory, historyFingerprint, sampleHistory } from './src/integration/history.js';
import { applyAnalysisResult, describeProposedChanges } from './src/integration/analysis-operations.js';
import { loadLinkedLore, loadGroupLore, generationBooks, analyzeLorebookCharacters, canonKeys, namesMatch } from './src/integration/lorebooks.js';
import { generateGrowthFactors, generatePairGoal, directionPresets, generateTriangleFactors, generateTriangleGoal, generateHeadcanons, matchingKeys } from './src/integration/growth.js';
import { pairTropeFactors, pairTropePace, pairTropes, triangleTropeFactors, triangleTropes, tropeLabel } from './src/integration/tropes.js';
import { getAnalysisTokenUsage } from './src/integration/analyzer.js';
import { onChangeBusy, getBusy, resetBusy } from './src/integration/busy.js';
import { clearLog, formatLog, logEvent } from './src/integration/diagnostics.js';
import { AUX_PURPOSES, auxGenerate, fetchAuxModels, listAuxProfiles, routedContext } from './src/integration/llm.js';
import { triangleEdges } from './src/core/records.js';
import { mountExtensionShell } from './src/integration/shell.js';
import { mountMessageButtons } from './src/integration/message-buttons.js';
import { mentionScorer, mentionedEntities, recentSceneText, semanticScorer } from './src/integration/headcanon-retrieval.js';
import { LOCAL_MODELS, cosine, embedTexts } from './src/integration/embeddings.js';
import { createChatStorage } from './src/integration/storage.js';
import { createRelationshipStudio } from './src/ui/studio.js';
import { createRelationshipWidget } from './src/ui/widget.js';

const MESSAGE_EXTRA_KEY = 'relationshipEngineV1';
/** Plain on/off preferences edited as checkboxes in the Studio settings. */
const TOGGLE_SETTINGS = ['linkedScales', 'autoCharacterLines', 'confirmPersonaLines', 'sendMemories', 'sendTensions', 'sendFactors', 'sendHeadcanons', 'autoHeadcanons'];
let controller = null;

function normalizeEmbeddings(config) {
  return {
    mode: ['off', 'local', 'api'].includes(config?.mode) ? config.mode : 'off',
    localModel: String(config?.localModel || 'Xenova/multilingual-e5-small'),
    dtype: config?.dtype === 'q4' ? 'q4' : 'q8',
    format: config?.format === 'gemini' ? 'gemini' : 'openai',
    url: String(config?.url ?? '').trim().slice(0, 500),
    key: String(config?.key ?? '').trim().slice(0, 500),
    model: String(config?.model ?? '').trim().slice(0, 200),
    threshold: Math.max(0, Math.min(0.95, Number(config?.threshold) || 0)),
  };
}

function normalizeAux(aux) {
  const mode = ['off', 'profile', 'custom'].includes(aux?.mode) ? aux.mode : 'off';
  return {
    mode,
    profileId: String(aux?.profileId ?? '').slice(0, 200),
    url: String(aux?.url ?? '').trim().slice(0, 500),
    key: String(aux?.key ?? '').trim().slice(0, 500),
    model: String(aux?.model ?? '').trim().slice(0, 200),
    maxTokens: Math.max(256, Math.min(32000, Math.round(Number(aux?.maxTokens)) || 4096)),
    fallbackToMain: Boolean(aux?.fallbackToMain),
    purposes: Object.fromEntries(Object.keys(AUX_PURPOSES).map(key => [key, aux?.purposes?.[key] !== false])),
  };
}

/** SillyTavern popups render their text as HTML. */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export async function init() {
  if (controller) return controller;
  const context = SillyTavern.getContext();
  const settings = getSettings(context);
  const storage = createChatStorage(() => SillyTavern.getContext(), createDefaultState, importState);
  const listeners = [];
  const subscribers = new Set();
  let state = storage.load();
  let studio;
  let widget;
  let unmountShell = () => {};
  let analysisQueue = Promise.resolve();
  let chatEpoch = 0;
  let historyQueued = false;
  const busy = getBusy();
  const unsubscribeBusy = onChangeBusy(next => {
    Object.assign(busy, next);
    notify();
  });
  Object.assign(busy, getBusy());

  function uiState() {
    const persona = state.ui?.personaId && state.entities[state.ui.personaId] ? state.ui.personaId : '';
    const tavernList = tavernPersonas();
    const chatAvatar = personaAvatarForChat();
    const personaEntity = persona ? state.entities[persona] : null;
    const boundPersonaName = personaEntity?.name ?? '';
    const chatPersona = chatAvatar ? (tavernList.find(item => item.avatarId === chatAvatar)?.name ?? '') : '';
    return {
      ...state,
      headcanonPairs: listHeadcanonPairs(state),
      sceneHeadcanons: [...sceneHeadcanons],
      headcanonInfo: { ...headcanonInfo },
      pairs: Object.values(state.relationships).filter(relation => relation.from !== persona),
      widgetPairs: Object.values(state.relationships)
        .filter(relation => relation.from !== persona)
        .filter(relation => !(state.ui?.hiddenRelationshipIds ?? []).includes(relation.id)),
      personaId: persona,
      tavernPersonas: tavernList,
      chatPersonaName: chatPersona,
      personaBoundName: boundPersonaName,
      personaMismatch: Boolean(persona && chatPersona && boundPersonaName
        && boundPersonaName.toLocaleLowerCase('ru-RU') !== chatPersona.toLocaleLowerCase('ru-RU')),
      lorebooks: { available: SillyTavern.getContext().getWorldInfoNames?.() ?? [], selected: state.ui?.linkedLorebooks ?? [], cardWorlds: cardWorldNames(), status: 'Книги подключаются только к анализатору этого чата. Исходные файлы не изменяются.' },
      settings: {
        autoTrack: settings.autoAnalyze, widgetEnabled: settings.widget.visible,
        maxPromptCharacters: settings.maxPromptCharacters,
        headcanonLimit: settings.headcanonLimit,
        aux: structuredClone(settings.aux),
        embeddings: structuredClone(settings.embeddings),
        ...Object.fromEntries(TOGGLE_SETTINGS.map(key => [key, settings[key] !== false])),
      },
      widget: {
        expanded: settings.widget.expanded,
        position: { x: settings.widget.x, y: settings.widget.y },
      },
      promptPreview: buildInjectionText(state, persona) || 'Пока пусто: нет связей с ненулевыми показателями.',
      promptTokens,
      analysisTokens: getAnalysisTokenUsage(),
      modelBusy: busy.busy,
      modelBusyLabel: busy.label,
    };
  }

  function buildPromptPreview(persona) {
    if (!settings.enabled || !settings.injectPrompt) return 'Инъекция отключена настройками.';
    const text = buildInjectionText(state, persona);
    return text || 'Пока пусто: нет связей с ненулевыми показателями.';
  }

  const store = {
    getState: uiState,
    subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); },
  };

  function notify() {
    for (const subscriber of subscribers) {
      try { subscriber(uiState()); } catch (error) { console.error('[Relationship Engine] UI subscriber failed.', error); }
    }
  }

  async function commit(next, immediate = true) {
    state = importState(next);
    try {
      await storage.save(state);
    } catch (error) {
      logEvent('error', 'Не удалось сохранить отношения в чат', error);
      throw error;
    }
    refreshPrompt();
    notify();
    return state;
  }

  let promptTokens = 0;

  function countTokens(text) {
    try {
      const ctx = SillyTavern.getContext();
      const tokenizer = ctx.getTokenCountAsync ? null : null;
      return ctx.getTokenCount?.(text) ?? Math.ceil(String(text).length / 3.5);
    } catch {
      return Math.ceil(String(text).length / 3.5);
    }
  }

  function buildInjectionText(targetState, persona) {
    if (!settings.enabled || !settings.injectPrompt) return '';
    // The budget is applied per section inside selectRuntimePrompt; slicing the finished
    // text used to drop every memory, tension and stranger rule at the end.
    return selectRuntimePrompt({ ...targetState, ui: { ...targetState.ui, personaId: persona } }, {
      memoryLimit: 2,
      tensionLimit: 2,
      includeMemories: settings.sendMemories !== false,
      includeTensions: settings.sendTensions !== false,
      includeFactors: settings.sendFactors !== false,
      maxCharacters: Number(settings.maxPromptCharacters) || 4000,
    }) + (settings.sendHeadcanons !== false && sceneHeadcanons.length ? `\n${sceneHeadcanons.join('\n')}` : '');
  }

  function assertHeadcanonPair(key) {
    const ids = headcanonPairIds(key);
    if (ids.length !== 2 || ids.some(id => !state.entities[id])) throw new Error('Персонаж не найден.');
  }

  function isAutoHeadcanonsFor(key) {
    return isAutoHeadcanons(state, key);
  }

  async function commitHeadcanons(headcanons) {
    const next = structuredClone(state);
    next.ui ??= {};
    next.ui.headcanons = headcanons;
    await commit(next, true);
    await prepareHeadcanons();
    refreshPrompt();
  }

  // Headcanons picked for the current scene; refreshed before every generation
  // (generate interceptor) and when the chat or the headcanons change.
  let sceneHeadcanons = [];
  // Why the preview shows what it shows: how many are on, how many fit the scene, how they were picked.
  let headcanonInfo = { enabled: 0, picked: 0, method: 'mentions', disabled: false };

  async function prepareHeadcanons(chat = SillyTavern.getContext().chat) {
    const enabled = listHeadcanonPairs(state).reduce((sum, pair) => sum + pair.enabledCount, 0);
    try {
      if (settings.sendHeadcanons === false || !enabled) {
        sceneHeadcanons = [];
        headcanonInfo = { enabled, picked: 0, method: 'mentions', disabled: settings.sendHeadcanons === false };
        return;
      }
      const sceneText = recentSceneText(chat);
      const { score, method, note } = await headcanonScorer(sceneText);
      sceneHeadcanons = selectHeadcanons(state, {
        score,
        limit: Math.max(1, Math.min(30, Number(settings.headcanonLimit) || 8)),
        maxCharacters: 1500,
      });
      headcanonInfo = { enabled, picked: sceneHeadcanons.length, method, disabled: false, ...(note ? { note } : {}) };
    } catch (error) {
      logEvent('error', 'Не удалось отобрать хедканоны для сцены', error);
      sceneHeadcanons = [];
      headcanonInfo = { enabled, picked: 0, method: 'mentions', disabled: false, error: error?.message ?? String(error) };
    }
  }

  const EMBEDDING_WAIT_MS = 8000;

  /**
   * Semantic ranking when embeddings are on; mentions otherwise. A slow first
   * model download must not hold the generation: after EMBEDDING_WAIT_MS this
   * generation falls back to mentions while the vectors keep loading.
   */
  async function headcanonScorer(sceneText) {
    const config = settings.embeddings ?? {};
    if (config.mode !== 'local' && config.mode !== 'api') return { score: mentionScorer(state, sceneText), method: 'mentions' };
    const items = listHeadcanonPairs(state).flatMap(pair => pair.items.filter(item => item.enabled !== false));
    const work = (async () => {
      const [sceneVector] = await embedTexts(config, [sceneText.slice(-1500) || ' '], 'query');
      const vectors = await embedTexts(config, items.map(item => item.text), 'passage');
      const byId = new Map(items.map((item, index) => [item.id, vectors[index]]));
      return item => (byId.has(item.id) ? cosine(sceneVector, byId.get(item.id)) : null);
    })();
    work.catch(error => logEvent('warn', 'Смысловой поиск хедканонов не сработал', error));
    try {
      const similarity = await Promise.race([work, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), EMBEDDING_WAIT_MS))]);
      return { score: semanticScorer(state, sceneText, similarity, Number(config.threshold) || 0), method: 'semantic' };
    } catch (error) {
      const note = error?.message === 'timeout'
        ? 'Модель эмбеддингов ещё загружается — на эту генерацию отбор по упоминаниям.'
        : `Смысловой поиск недоступен (${error?.message ?? error}) — отбор по упоминаниям.`;
      return { score: mentionScorer(state, sceneText), method: 'mentions', note };
    }
  }

  function refreshPrompt() {
    const ctx = SillyTavern.getContext();
    if (!settings.enabled || !settings.injectPrompt) {
      promptTokens = 0;
      clearRelationshipPrompt(ctx);
      notify();
      return;
    }
    const persona = state.ui?.personaId && state.entities[state.ui.personaId] ? state.ui.personaId : '';
    const text = buildInjectionText(state, persona);
    promptTokens = text ? countTokens(`[RELATIONSHIP ENGINE]\n${text}\n[/RELATIONSHIP ENGINE]`) : 0;
    updateRelationshipPrompt(ctx, text, Boolean(text));
    notify();
  }

  async function ensurePair(sourceId, targetId) {
    const id = relationshipId(sourceId, targetId);
    let next = state;
    if (!next.relationships[id]) {
      next = applyOperation(next, createOperation('relationship.upsert', { from: sourceId, to: targetId }, { id: uniqueId('relationship') }));
    }
    next = structuredClone(next);
    next.ui ??= {};
    next.ui.activeRelationshipId = id;
    await commit(next, true);
    studio?.selectPair(id);
    widget?.selectPair(id);
    return id;
  }

  async function addCharacter({ name, aliases = [] }) {
    const candidate = createEntity(name, { aliases });
    const existing = state.entities[candidate.id];
    const entity = createEntity(name, {
      id: candidate.id,
      aliases: [...(existing?.aliases ?? []), ...aliases],
      avatar: existing?.avatar,
      sourceId: existing?.sourceId,
    });
    await commit(applyOperation(state, createOperation('entity.upsert', entity, { id: uniqueId('entity-update') })), true);
  }

  /** Replace a character's aliases, keeping its ID, name, avatar and source. */
  async function setAliases({ characterId: id, aliases }) {
    const existing = state.entities[id];
    if (!existing) throw new Error('Персонаж не найден.');
    const entity = createEntity(existing.name, {
      id, aliases: (aliases ?? []).map(String).map(alias => alias.trim()).filter(alias => alias && alias.length <= 100).slice(0, 30),
      avatar: existing.avatar, sourceId: existing.sourceId,
    });
    await commit(applyOperation(state, createOperation('entity.upsert', entity, {
      id: uniqueId('entity-update'), reason: 'Псевдонимы персонажа', timestamp: new Date().toISOString(),
    })), true);
    await prepareHeadcanons();
    refreshPrompt();
  }

  function findTriangle(id) {
    const triangle = (state.ui?.triangles ?? []).find(item => item.id === id);
    if (!triangle) throw new Error('Треугольник не найден.');
    return triangle;
  }

  /** The triangle's tracked directed lines: both directions of its three edges, minus the persona's own. */
  function triangleLines(triangle) {
    const personaId = state.ui?.personaId || '';
    const name = id => state.entities[id]?.name ?? id;
    return triangleEdges(triangle.centerId, triangle.firstId, triangle.secondId)
      .flatMap(([a, b]) => [[a, b], [b, a]])
      .filter(([from]) => from !== personaId)
      .map(([from, to]) => ({ from, to, relationshipId: relationshipId(from, to), label: `${name(from)} → ${name(to)}` }));
  }

  function withLineIds(factors) {
    return factors.map(factor => ({ ...factor, relationshipId: relationshipId(factor.from, factor.to) }));
  }

  async function selectPair({ sourceId, targetId }) {
    if (!state.entities[sourceId] || !state.entities[targetId] || sourceId === targetId) return;
    await ensurePair(sourceId, targetId);
  }

  async function changeMetric({ sourceId, targetId, metric, value }) {
    const id = await ensurePair(sourceId, targetId);
    if (!state.config.scales.some(scale => scale.id === metric)) {
      throw new Error(`Неизвестная шкала: ${metric}`);
    }
    const next = applyOperation(state, createOperation('scale.set', {
      relationshipId: id, scaleId: metric, value: Number(value),
    }, { transactionId: uniqueId('manual'), reason: 'Ручное изменение', timestamp: new Date().toISOString() }));
    await commit(next, true);
    return next;
  }

  async function addCollection(kind, payload) {
    if (Array.isArray(payload.participantIds)) {
      const knownBy = (payload.knownBy ?? payload.participantIds).filter(id => state.entities[id]);
      for (const id of payload.participantIds) if (!knownBy.includes(id)) knownBy.push(id);
      await commit(applyOperation(state, createOperation(kind === 'memory' ? 'memory.add' : 'tension.add', {
        shared: true, item: { id: uniqueId(kind), text: payload.text, participantIds: payload.participantIds, knownBy: [...new Set(knownBy)].sort(), intensity: payload.intensity, createdAt: new Date().toISOString() },
      }, { transactionId: uniqueId('manual'), reason: 'Ручная запись', timestamp: new Date().toISOString() })), true);
      return;
    }
    const id = await ensurePair(payload.sourceId, payload.targetId);
    const type = kind === 'memory' ? 'memory.add' : 'tension.add';
    await commit(applyOperation(state, createOperation(type, {
      relationshipId: id,
      item: { id: uniqueId(kind), text: payload.text, intensity: payload.intensity, createdAt: new Date().toISOString() },
    }, { transactionId: uniqueId('manual'), reason: 'Ручное изменение', timestamp: new Date().toISOString() })), true);
  }

  async function importFromStudio({ data }) {
    const imported = importState(data?.state ?? data);
    const ctx = SillyTavern.getContext();
    const accepted = await ctx.Popup.show.confirm(
      'Импорт отношений',
      `<p>В файле персонажей: ${Object.keys(imported.entities ?? {}).length}, линий: ${Object.keys(imported.relationships ?? {}).length}.</p><p>Текущие отношения этого чата будут заменены. Продолжить?</p>`,
    );
    if (accepted !== ctx.POPUP_RESULT.AFFIRMATIVE) return false;
    await commit(imported, true);
    return true;
  }

  function exportForStudio() {
    return { kind: 'sillytavern-relationship-engine', exportedAt: new Date().toISOString(), state };
  }

  async function changeSettings({ settings: patch }) {
    if (Object.hasOwn(patch, 'autoTrack')) settings.autoAnalyze = Boolean(patch.autoTrack);
    if (Object.hasOwn(patch, 'widgetEnabled')) settings.widget.visible = Boolean(patch.widgetEnabled);
    for (const key of TOGGLE_SETTINGS) if (Object.hasOwn(patch, key)) settings[key] = Boolean(patch[key]);
    if (Object.hasOwn(patch, 'maxPromptCharacters')) {
      const limit = Math.round(Number(patch.maxPromptCharacters));
      if (Number.isFinite(limit)) settings.maxPromptCharacters = Math.max(800, Math.min(20000, limit));
    }
    if (Object.hasOwn(patch, 'headcanonLimit')) {
      const limit = Math.round(Number(patch.headcanonLimit));
      if (Number.isFinite(limit)) settings.headcanonLimit = Math.max(1, Math.min(30, limit));
    }
    if (patch.aux && typeof patch.aux === 'object') settings.aux = normalizeAux({ ...settings.aux, ...patch.aux });
    if (patch.embeddings && typeof patch.embeddings === 'object') {
      settings.embeddings = normalizeEmbeddings({ ...settings.embeddings, ...patch.embeddings });
      prepareHeadcanons().then(refreshPrompt);
    }
    context.saveSettingsDebounced();
    widget.element.hidden = !settings.widget.visible;
    refreshPrompt();
    notify();
  }

  /** Lorebooks bound to the current card(s) in SillyTavern (card's "world"). */
  /** Lore about these characters from every book of the chat, for generation (factors, end points, headcanons). */
  function loreAbout(ids) {
    const ctx = SillyTavern.getContext();
    return loadGroupLore(ctx, state, ids, { books: generationBooks(ctx, state, cardWorldNames()), matchKeys: matchingKeys });
  }

  function cardWorldNames() {
    const ctx = SillyTavern.getContext();
    let cards = [];
    if (ctx.groupId) {
      const group = (ctx.groups ?? []).find(item => String(item.id) === String(ctx.groupId));
      cards = (group?.members ?? []).map(avatar => (ctx.characters ?? []).find(character => character?.avatar === avatar)).filter(Boolean);
    } else if (ctx.characterId !== undefined && ctx.characterId !== null && ctx.characters?.[ctx.characterId]) {
      cards = [ctx.characters[ctx.characterId]];
    }
    const available = new Set(ctx.getWorldInfoNames?.() ?? []);
    return [...new Set(cards.map(card => card?.data?.extensions?.world).filter(name => name && available.has(name)))];
  }

  /** Character card(s) of the current chat (or every group member) plus the user persona. */
  function cardContext(ctx, maxCharacters = 9000) {
    const substitute = value => {
      const text = String(value ?? '').trim();
      if (!text) return '';
      try { return typeof ctx.substituteParams === 'function' ? ctx.substituteParams(text) : text; }
      catch { return text; }
    };
    let cards = [];
    if (ctx.groupId) {
      const group = (ctx.groups ?? []).find(item => String(item.id) === String(ctx.groupId));
      cards = (group?.members ?? []).map(avatar => (ctx.characters ?? []).find(character => character?.avatar === avatar)).filter(Boolean);
    } else if (ctx.characterId !== undefined && ctx.characterId !== null) {
      const card = ctx.characters?.[ctx.characterId];
      if (card) cards = [card];
    }
    const parts = [];
    const perCard = cards.length ? Math.floor((maxCharacters - 1200) / cards.length) : 0;
    for (const card of cards) {
      const fields = [card.description ?? card.data?.description, card.personality ?? card.data?.personality, card.scenario ?? card.data?.scenario, card.first_mes ?? card.data?.first_mes]
        .map(substitute).filter(Boolean).join('\n');
      if (!fields) continue;
      parts.push(`### Карточка «${card.name}»\n${fields.length > perCard ? `${fields.slice(0, perCard)}…` : fields}`);
    }
    const personaName = String(ctx.name1 ?? '').trim();
    const personaDescription = substitute(ctx.powerUserSettings?.persona_description).slice(0, 1000);
    if (personaName) parts.push(`### Персона пользователя «${personaName}»\n${personaDescription || '(без описания)'}`);
    return parts.join('\n\n');
  }

  /** Find characters inside linked lorebooks, deduplicate against the registry, ask, add. */
  async function analyzeLorebooksForCharacters({ names } = {}) {
    if (isGenerationActive()) await waitForGenerationEnd();
    const ctx = SillyTavern.getContext();
    const books = names ?? (state.ui?.linkedLorebooks ?? []);
    if (!books.length) throw new Error('Нет подключённых лорбуков. Сначала подключите книгу на вкладке «Лорбуки».');
    const registryKeys = new Set();
    for (const entity of Object.values(state.entities)) {
      for (const value of [entity.name, ...(entity.aliases ?? [])]) {
        for (const key of canonKeys(value)) registryKeys.add(key);
      }
    }
    const found = [];
    const aliasUpdates = [];
    const seen = new Set();
    const knownEntities = Object.values(state.entities).map(entity => ({ id: entity.id, name: entity.name, aliases: entity.aliases ?? [] }));
    for (const bookName of books) {
      const book = await ctx.loadWorldInfo(bookName);
      if (!book?.entries) throw new Error(`Не удалось прочитать лорбук «${bookName}».`);
      const { characters, knownAliases } = await analyzeLorebookCharacters(routedContext(ctx, settings, 'discovery'), book, bookName, knownEntities);
      for (const update of knownAliases) {
        const entity = state.entities[update.id];
        if (!entity) continue;
        const fresh = update.aliases.filter(alias => !namesMatch(alias, entity.name) && !(entity.aliases ?? []).some(existing => namesMatch(alias, existing)));
        if (!fresh.length) continue;
        const existingEntry = aliasUpdates.find(item => item.id === update.id);
        if (existingEntry) existingEntry.aliases = [...new Set([...existingEntry.aliases, ...fresh])];
        else aliasUpdates.push({ id: update.id, name: entity.name, aliases: [...fresh] });
      }
      for (const character of characters) {
        const candidateKeys = [...canonKeys(character.name), ...character.aliases.flatMap(alias => [...canonKeys(alias)])];
        if (candidateKeys.some(key => registryKeys.has(key))) continue;
        if (candidateKeys.some(key => seen.has(key))) continue;
        for (const key of candidateKeys) seen.add(key);
        found.push({ ...character, book: bookName });
      }
    }
    if (!found.length && !aliasUpdates.length) {
      globalThis.toastr?.info?.('Новые персонажи в лорбуках не найдены.', 'Движок отношений');
      return { found: [], aliasUpdates: [] };
    }
    const newLines = found.map(character =>
      `• ${character.name}${character.aliases.length ? ` (${character.aliases.join(', ')})` : ''}${character.note ? ` — ${character.note}` : ''}\n  из «${character.book}»`).join('\n');
    const aliasLines = aliasUpdates.map(update =>
      `• ${update.name} — распознан как уже существующий; будут добавлены псевдонимы: ${update.aliases.join(', ')}`).join('\n');
    const accepted = await ctx.Popup.show.confirm(
      'Персонажи в лорбуках',
      `${found.length ? `Новые персонажи:\n${newLines}\n\n` : ''}${aliasUpdates.length ? `Уже известные (добавятся псевдонимы для сцепки с лором):\n${aliasLines}\n\n` : ''}Применить?`,
    );
    if (accepted !== ctx.POPUP_RESULT.AFFIRMATIVE) return { found: [], aliasUpdates: [] };
    let next = state;
    for (const character of found) {
      const entity = createEntity(character.name, { aliases: character.aliases });
      next = applyOperation(next, createOperation('entity.upsert', entity, {
        id: uniqueId('lore-character'), reason: `Персонаж из лорбука «${character.book}»`, timestamp: new Date().toISOString(),
      }));
    }
    for (const update of aliasUpdates) {
      const entity = next.entities[update.id];
      if (!entity) continue;
      const merged = createEntity(entity.name, {
        id: entity.id, aliases: [...new Set([...(entity.aliases ?? []), ...update.aliases])],
        avatar: entity.avatar, sourceId: entity.sourceId,
      });
      next = applyOperation(next, createOperation('entity.upsert', merged, {
        id: uniqueId('lore-alias'), reason: 'Псевдонимы из лорбука', timestamp: new Date().toISOString(),
      }));
    }
    await commit(next, true);
    globalThis.toastr?.success?.(`Добавлено персонажей: ${found.length}; обновлено псевдонимов: ${aliasUpdates.length}`, 'Движок отношений');
    return { found, aliasUpdates };
  }

  async function analyzeWholeHistory({ onProgress = () => {} } = {}) {    const ctx = SillyTavern.getContext();
    const expectedChatId = ctx.getCurrentChatId();
    const expectedEpoch = chatEpoch;
    const messages = structuredClone(ctx.chat ?? []);
    const originalState = state;
    const originalFingerprint = historyFingerprint(messages);
    function assertCurrent() {
      const current = SillyTavern.getContext();
      if (expectedEpoch !== chatEpoch || current.getCurrentChatId() !== expectedChatId
        || state !== originalState || historyFingerprint(current.chat ?? []) !== originalFingerprint) {
        throw new Error('Чат или настройки отношений изменились во время анализа. Результат не сохранён; повторите запуск.');
      }
    }
    if (!messages.some(message => message?.mes?.trim())) throw new Error('В этом чате пока нет сообщений для анализа.');
    const batches = createHistoryBatches(messages, settings.analysisMaxCharacters);
    const maxBatches = 40;
    if (batches.length > maxBatches) throw new Error(`Чат слишком большой для безопасного анализа за один запуск: ${batches.length} пакетов. Максимум — ${maxBatches}.`);
    if (!batches.length) throw new Error('В чате нет сюжетных сообщений.');
    onProgress('Ищу персонажей в истории…');
    const knownEntities = Object.values(state.entities).map(entity => ({ id: entity.id, name: entity.name, aliases: entity.aliases ?? [] }));
    const { characters: discovered, knownAliases } = await discoverHistoryCharacters(routedContext(ctx, settings, 'discovery'), sampleHistory(messages, settings.analysisMaxCharacters * 2), settings, knownEntities, cardContext(ctx));
    assertCurrent();
    // Registry-aware dedup: never re-add persons the model or transliteration already knows.
    const registryKeys = new Set();
    for (const entity of Object.values(state.entities)) {
      for (const value of [entity.name, ...(entity.aliases ?? [])]) {
        for (const key of canonKeys(value)) registryKeys.add(key);
      }
    }
    const freshCharacters = discovered.filter(character => {
      const candidateKeys = [...canonKeys(character.name), ...character.aliases.flatMap(alias => [...canonKeys(alias)])];
      return !candidateKeys.some(key => registryKeys.has(key));
    });
    const aliasUpdates = [];
    for (const update of knownAliases) {
      const entity = state.entities[update.id];
      if (!entity) continue;
      const fresh = update.aliases.filter(alias => !namesMatch(alias, entity.name) && !(entity.aliases ?? []).some(existing => namesMatch(alias, existing)));
      if (!fresh.length) continue;
      const existingEntry = aliasUpdates.find(item => item.id === update.id);
      if (existingEntry) existingEntry.aliases = [...new Set([...existingEntry.aliases, ...fresh])];
      else aliasUpdates.push({ id: update.id, name: entity.name, aliases: [...fresh] });
    }
    const newNames = freshCharacters.length
      ? freshCharacters.map(character => `• ${character.name}${character.aliases.length ? ` (${character.aliases.join(', ')})` : ''}`).join('\n')
      : '';
    const aliasLines = aliasUpdates.length
      ? aliasUpdates.map(update => `• ${update.name} — уже в реестре; добавятся псевдонимы из чата: ${update.aliases.join(', ')}`).join('\n')
      : '';
    const names = newNames || aliasLines || 'Новых персонажей не найдено; будут использованы уже добавленные.';
    const accepted = await ctx.Popup.show.confirm(
      'Анализ истории чата',
      `${newNames ? `Новые персонажи в истории:\n${escapePopupText(newNames)}\n\n` : ''}${aliasLines ? `Уже известные (добавятся псевдонимы из чата):\n${escapePopupText(aliasLines)}\n\n` : ''}${!newNames && !aliasLines ? `${names}\n\n` : ''}Narrator добавлен не будет. Для истории потребуется ${batches.length} пакетных запросов к текущей модели. Прежние автоматические оценки будут заменены. Продолжить?`,
    );
    if (accepted !== ctx.POPUP_RESULT.AFFIRMATIVE) throw new Error('Анализ истории отменён пользователем.');
    assertCurrent();

    let next = rebuildWithoutAutomaticHistory(state);
    for (const update of aliasUpdates) {
      const entity = next.entities[update.id];
      if (!entity) continue;
      const merged = createEntity(entity.name, {
        id: entity.id, aliases: [...new Set([...(entity.aliases ?? []), ...update.aliases])],
        avatar: entity.avatar, sourceId: entity.sourceId,
      });
      next = applyOperation(next, createOperation('entity.upsert', merged, {
        id: uniqueId('history-alias'), reason: 'Псевдонимы из истории чата', timestamp: new Date().toISOString(),
      }));
    }
    for (const character of freshCharacters) {
      const entity = createEntity(character.name, { aliases: character.aliases });
      if (next.entities[entity.id]) continue;
      next = applyOperation(next, createOperation('entity.upsert', entity, {
        id: uniqueId('history-character'), reason: 'Персонаж найден в истории чата', timestamp: new Date().toISOString(),
      }));
    }
    if (Object.keys(next.entities).length < 2) throw new Error('Нужно как минимум два подтверждённых персонажа. Добавьте их вручную и повторите анализ.');
    const personaMatch = matchPersonaEntity(next);
    if (personaMatch && !next.ui?.personaId) {
      next.ui ??= {};
      next.ui.personaId = personaMatch.id;
    }
    onProgress('Читаю подходящие записи подключённых лорбуков…');
    const loreContext = await loadLinkedLore(ctx, next);
    assertCurrent();

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      assertCurrent();
      onProgress(`Анализирую историю: пакет ${batchIndex + 1} из ${batches.length}…`);
      const result = await analyzeHistoryBatch(routedContext(ctx, settings, 'analysis'), next, batches[batchIndex], settings, loreContext);
      assertCurrent();
      // History analysis is started by the user explicitly, so persona lines are not asked one by one;
      // only the "no automatic character lines" setting applies.
      next = applyAnalysisResult(next, result, { transactionId: 'history-import' }, [], {
        linkedScales: settings.linkedScales !== false,
        allowNewPair: (subjectId, objectId) => settings.autoCharacterLines !== false || objectId === (next.ui?.personaId || ''),
      }).state;
    }
    assertCurrent();
    next.ui ??= {};
    if (!next.relationships[next.ui.activeRelationshipId]) next.ui.activeRelationshipId = Object.keys(next.relationships)[0] || '';
    next.ui.historyImport = { fingerprint: originalFingerprint, messageCount: messages.length, createdAt: new Date().toISOString() };
    onProgress('Сохраняю найденные отношения…');
    for (const message of SillyTavern.getContext().chat ?? []) {
      if (message.is_user || message.is_system) continue;
      message.extra ??= {};
      message.extra[MESSAGE_EXTRA_KEY] = { fingerprint: fingerprint(message.mes), operationIds: [], historyImported: true };
    }
    await commit(next, true);
    onProgress(`Готово: обработано ${batches.length} пакетов истории.`);
  }

  function escapePopupText(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  function enqueueHistory(payload) {
    if (historyQueued) return Promise.reject(new Error('Анализ истории уже запущен. Дождитесь завершения.'));
    historyQueued = true;
    const expectedEpoch = chatEpoch;
    const job = analysisQueue.then(() => {
      if (expectedEpoch !== chatEpoch) throw new Error('Чат изменился до начала анализа. Повторите запуск.');
      return analyzeWholeHistory(payload);
    }).finally(() => { historyQueued = false; });
    analysisQueue = job.catch(() => {});
    return job;
  }

  function tavernPersonas() {
    const context = SillyTavern.getContext();
    const personas = context.powerUserSettings?.personas ?? {};
    const chatPersonaAvatar = context.chatMetadata?.persona ?? '';
    return Object.entries(personas)
      .map(([avatarId, name]) => ({ avatarId, name: String(name || '').trim() || avatarId }))
      .filter(persona => persona.name)
      .sort((left, right) => left.name.localeCompare(right.name, 'ru-RU'))
      .map(persona => ({ ...persona, lockedToChat: persona.avatarId === chatPersonaAvatar }));
  }

  function personaAvatarForChat() {
    const context = SillyTavern.getContext();
    const chatAvatar = context.chatMetadata?.persona ?? '';
    if (chatAvatar && context.powerUserSettings?.personas?.[chatAvatar]) return chatAvatar;
    return context.powerUserSettings?.default_persona ?? '';
  }

  function matchPersonaEntity(targetState) {
    const context = SillyTavern.getContext();
    const avatar = personaAvatarForChat();
    const personaName = String((avatar && context.powerUserSettings?.personas?.[avatar]) || context.name1 || '').trim();
    if (!personaName) return null;
    const normalized = personaName.toLocaleLowerCase('ru-RU');
    return Object.values(targetState.entities).find(entity =>
      entity.name.toLocaleLowerCase('ru-RU') === normalized
      || (entity.aliases ?? []).some(alias => alias.toLocaleLowerCase('ru-RU') === normalized)) ?? null;
  }

  async function autoBindPersona(targetState, immediate = true) {
    const current = targetState.ui?.personaId;
    if (current && targetState.entities[current]) return targetState;
    const match = matchPersonaEntity(targetState);
    if (!match) return targetState;
    const next = structuredClone(targetState);
    next.ui ??= {};
    next.ui.personaId = match.id;
    await commit(next, immediate);
    return next;
  }

  async function setTavernPersona({ avatarId }) {
    const context = SillyTavern.getContext();
    const personas = context.powerUserSettings?.personas ?? {};
    if (avatarId && !personas[avatarId]) throw new Error('Персона не найдена в списке персон SillyTavern.');
    let next = state;
    let personaName = '';
    if (avatarId) {
      personaName = String(personas[avatarId] || '').trim();
      if (!personaName) throw new Error('У этой персоны не задано имя.');
      const normalized = personaName.toLocaleLowerCase('ru-RU');
      const existing = Object.values(next.entities).find(entity =>
        entity.name.toLocaleLowerCase('ru-RU') === normalized
        || (entity.aliases ?? []).some(alias => alias.toLocaleLowerCase('ru-RU') === normalized));
      if (!existing) {
        const entity = createEntity(personaName, { sourceId: avatarId });
        next = applyOperation(next, createOperation('entity.upsert', entity, {
          id: uniqueId('persona-entity'), reason: 'Персона SillyTavern', timestamp: new Date().toISOString(),
        }));
        next.ui ??= {};
        next.ui.personaId = entity.id;
      } else {
        next = structuredClone(next);
        next.ui ??= {};
        next.ui.personaId = existing.id;
      }
    } else {
      next = structuredClone(next);
      next.ui ??= {};
      next.ui.personaId = '';
    }
    await commit(next, true);
  }

  const callbacks = {
    onSetTavernPersona: setTavernPersona,
    onAddTriangle: async ({ centerId, firstId, secondId, name }) => {
      const edges = triangleEdges(centerId, firstId, secondId);
      if ([centerId, firstId, secondId].some(id => !state.entities[id])) throw new Error('Персонаж не найден.');
      let next = state;
      for (const [from, to] of edges) for (const [a, b] of [[from, to], [to, from]]) {
        const id = relationshipId(a, b);
        if (!next.relationships[id]) next = applyOperation(next, createOperation('relationship.upsert', { from: a, to: b }, { id: uniqueId('relationship') }));
      }
      next = structuredClone(next);
      next.ui ??= {};
      next.ui.triangles ??= [];
      next.ui.triangles.push({ id: uniqueId('triangle'), name: name || 'Треугольник', centerId, firstId, secondId });
      await commit(next, true);
    },
    onRemoveTriangle: async ({ id }) => {
      const next = structuredClone(state);
      next.ui.triangles = (next.ui.triangles ?? []).filter(item => item.id !== id);
      await commit(next, true);
    },
    onSetTriangleGoal: async ({ id, goal }) => {
      const next = structuredClone(state);
      const triangle = (next.ui?.triangles ?? []).find(item => item.id === id);
      if (!triangle) throw new Error('Треугольник не найден.');
      const text = String(goal ?? '').trim().slice(0, 500);
      if (text) triangle.goal = text; else delete triangle.goal;
      await commit(next, true);
    },
    onGenerateTriangleGoal: async ({ id, wish }) => {
      if (isGenerationActive()) await waitForGenerationEnd();
      const triangle = findTriangle(id);
      const loreContext = await loreAbout([triangle.centerId, triangle.firstId, triangle.secondId]);
      return generateTriangleGoal(routedContext(SillyTavern.getContext(), settings, 'generation'), state, triangle, { loreContext, wish });
    },
    onTriangleLines: ({ id }) => triangleLines(findTriangle(id)),
    onGenerateTriangleFactors: async ({ id, goal }) => {
      if (isGenerationActive()) await waitForGenerationEnd();
      const triangle = findTriangle(id);
      const lines = triangleLines(triangle);
      const loreContext = await loreAbout([triangle.centerId, triangle.firstId, triangle.secondId]);
      const factors = await generateTriangleFactors(routedContext(SillyTavern.getContext(), settings, 'generation'), state, triangle, lines, { goal: goal ?? triangle.goal, loreContext });
      return withLineIds(factors);
    },
    onTriangleTropes: () => triangleTropes(),
    onTriangleTropeFactors: ({ id, tropeId }) => {
      const triangle = findTriangle(id);
      const result = triangleTropeFactors(tropeId, triangle, state.config.scales.map(scale => scale.id), state.ui?.personaId || '');
      return { goal: result.goal, factors: withLineIds(result.factors).map(factor => ({ ...factor, origin: `triangle-trope:${tropeId}` })) };
    },
    /** Saves the combined editor: every tracked line of the triangle gets exactly the listed factors
     * (and, when given, the listed pace). */
    onSetTriangleFactors: async ({ id, factors, paceByLine }) => {
      const triangle = findTriangle(id);
      let next = state;
      for (const line of triangleLines(triangle)) {
        if (!next.relationships[line.relationshipId]) {
          next = applyOperation(next, createOperation('relationship.upsert', { from: line.from, to: line.to }, { id: uniqueId('relationship') }));
        }
      }
      const meta = { transactionId: uniqueId('manual'), reason: `Факторы треугольника «${triangle.name}»`, timestamp: new Date().toISOString() };
      next = applyOperations(next, triangleLines(triangle).map(line => createOperation('factors.set', {
        relationshipId: line.relationshipId,
        factors: (factors ?? []).filter(factor => factor.relationshipId === line.relationshipId && String(factor.text ?? '').trim())
          .map(({ scaleId, direction, text, origin }) => ({ scaleId, direction, text, ...(origin ? { origin } : {}) })),
        ...(paceByLine && Object.hasOwn(paceByLine, line.relationshipId) ? { pace: paceByLine[line.relationshipId] } : {}),
      }, meta)));
      await commit(next, true);
    },
    onPairTropes: () => pairTropes(),
    /** origin marks a line's own trope; the triangle editor re-labels it as a triangle trope. */
    onPairTropeFactors: ({ tropeId }) => {
      const scaleIds = state.config.scales.map(scale => scale.id);
      return {
        factors: pairTropeFactors(tropeId, scaleIds).map(factor => ({ ...factor, origin: `pair-trope:${tropeId}` })),
        pace: pairTropePace(tropeId, scaleIds),
      };
    },
    onTropeLabel: ({ origin }) => tropeLabel(origin),
    onRefreshLorebooks: () => notify(),
    onLinkLorebook: async ({ name }) => {
      if (!(SillyTavern.getContext().getWorldInfoNames?.() ?? []).includes(name)) throw new Error('Лорбук не найден. Обновите список.');
      const next = structuredClone(state);
      next.ui ??= {};
      next.ui.linkedLorebooks = [...new Set([...(next.ui.linkedLorebooks ?? []), name])];
      await commit(next, true);
      // Offer character discovery right after linking, so the roster fills without manual work.
      analyzeLorebooksForCharacters({ names: [name] }).catch(error => console.error('[Relationship Engine] Lorebook character discovery failed.', error));
    },
    onUnlinkLorebook: async ({ name }) => {
      const next = structuredClone(state);
      next.ui ??= {};
      next.ui.linkedLorebooks = (next.ui.linkedLorebooks ?? []).filter(book => book !== name);
      await commit(next, true);
    },
    onAddCharacter: addCharacter,
    onSetAliases: setAliases,
    onSelectPair: selectPair,
    onSetFactors: async ({ sourceId, targetId, factors, pace, goal }) => {
      const id = relationshipId(sourceId, targetId);
      if (!state.relationships[id]) throw new Error('Линия не найдена.');
      await commit(applyOperation(state, createOperation('factors.set', {
        relationshipId: id, factors, ...(pace !== undefined ? { pace } : {}), ...(goal !== undefined ? { goal } : {}),
      }, { transactionId: uniqueId('manual'), reason: 'Ручное изменение факторов', timestamp: new Date().toISOString() })), true);
    },
    onGeneratePairGoal: async ({ sourceId, targetId, wish }) => {
      if (isGenerationActive()) await waitForGenerationEnd();
      if (!state.relationships[relationshipId(sourceId, targetId)]) throw new Error('Сначала создайте линию.');
      const loreContext = await loreAbout([sourceId, targetId]);
      return generatePairGoal(routedContext(SillyTavern.getContext(), settings, 'generation'), state, sourceId, targetId, { loreContext, wish });
    },
    onGenerateFactors: async ({ sourceId, targetId, directionId, customDirection, replace, goal }) => {
      if (isGenerationActive()) await waitForGenerationEnd();
      const id = relationshipId(sourceId, targetId);
      if (!state.relationships[id]) throw new Error('Сначала создайте линию.');
      const loreContext = await loreAbout([sourceId, targetId]);
      const factors = await generateGrowthFactors(routedContext(SillyTavern.getContext(), settings, 'generation'), state, sourceId, targetId, {
        directionId, customDirection, loreContext, goal: goal ?? state.relationships[id].goal ?? '',
      });
      const merged = replace ? factors : [...(state.relationships[id].factors ?? []), ...factors];
      await commit(applyOperation(state, createOperation('factors.set', {
        relationshipId: id, factors: merged, ...(goal !== undefined ? { goal } : {}),
      }, { transactionId: uniqueId('manual'), reason: `Генерация факторов (${directionId})`, timestamp: new Date().toISOString() })), true);
      return factors;
    },
    onDirectionPresets: () => directionPresets(),
    onRemoveRecord: async ({ kind, shared, relationshipId, itemId }) => {
      const type = kind === 'tension' ? 'tension.remove' : 'memory.remove';
      await commit(applyOperation(state, createOperation(type, {
        shared: Boolean(shared), relationshipId, itemId,
      }, { transactionId: uniqueId('manual'), reason: 'Ручное удаление записи', timestamp: new Date().toISOString() })), true);
    },
    onUpdateRecord: async ({ kind, shared, relationshipId: pairRecordOwner, itemId, changes }) => {
      const meta = { transactionId: uniqueId('manual'), reason: 'Правка записи', timestamp: new Date().toISOString() };
      const key = kind === 'tension' ? 'tensions' : 'memories';
      if (shared) {
        await commit(applyOperation(state, createOperation('record.update', { kind, shared: true, itemId, changes }, meta)), true);
        return;
      }
      const relation = state.relationships[pairRecordOwner];
      const original = relation?.[key]?.find(item => item.id === itemId);
      if (!original) throw new Error('Запись не найдена.');
      const pairParticipants = [relation.from, relation.to].sort();
      const sameParticipants = !changes.participantIds
        || JSON.stringify([...changes.participantIds].sort()) === JSON.stringify(pairParticipants);
      if (sameParticipants && !changes.knownBy) {
        await commit(applyOperation(state, createOperation('record.update', { kind, relationshipId: pairRecordOwner, itemId, changes }, meta)), true);
        return;
      }
      // Old pair-bound records have fixed participants: editing them moves the record into shared ones.
      const participantIds = [...new Set(changes.participantIds ?? pairParticipants)].sort();
      const knownBy = [...new Set([...(changes.knownBy ?? participantIds), ...participantIds])].sort();
      const moved = {
        ...original,
        id: uniqueId(kind),
        text: String(changes.text ?? original.text).trim(),
        intensity: changes.intensity ?? original.intensity,
        participantIds,
        knownBy,
      };
      await commit(applyOperations(state, [
        createOperation(kind === 'tension' ? 'tension.remove' : 'memory.remove', { relationshipId: pairRecordOwner, itemId }, meta),
        createOperation(kind === 'tension' ? 'tension.add' : 'memory.add', { shared: true, item: moved }, meta),
      ]), true);
    },
    onToggleRecord: async ({ kind, shared, relationshipId, itemId, disabled }) => {
      await commit(applyOperation(state, createOperation('record.toggle', {
        kind, shared: Boolean(shared), relationshipId, itemId, disabled: Boolean(disabled),
      }, { transactionId: uniqueId('manual'), reason: disabled ? 'Запись отключена' : 'Запись включена', timestamp: new Date().toISOString() })), true);
    },
    onToggleWidgetPair: async ({ relationshipId }) => {
      const next = structuredClone(state);
      next.ui ??= {};
      const hidden = [...new Set([...(next.ui.hiddenRelationshipIds ?? [])])];
      const index = hidden.indexOf(relationshipId);
      if (index >= 0) hidden.splice(index, 1);
      else hidden.push(relationshipId);
      next.ui.hiddenRelationshipIds = hidden;
      await commit(next, true);
    },
    onRemovePair: async ({ sourceId, targetId }) => {      if (!state.entities[sourceId] || !state.entities[targetId]) throw new Error('Персонаж не найден.');
      const id = relationshipId(sourceId, targetId);
      if (!state.relationships[id]) return;
      const confirmed = await context.Popup.show.confirm(
        'Удалить линию отношений',
        `Линия «${escapeHtml(state.entities[sourceId].name)} → ${escapeHtml(state.entities[targetId].name)}» и её шкалы, воспоминания и напряжения будут удалены. Продолжить?`,
      );
      if (confirmed !== context.POPUP_RESULT.AFFIRMATIVE) return;
      await commit(applyOperation(state, createOperation('relationship.remove', {
        relationshipId: id, from: sourceId, to: targetId,
      }, { transactionId: uniqueId('manual'), reason: 'Ручное удаление линии', timestamp: new Date().toISOString() })), true);
    },
    onRemovePairsBulk: async ({ relationshipIds }) => {
      const lines = [...new Set(relationshipIds ?? [])].map(id => state.relationships[id]).filter(Boolean);
      if (!lines.length) return false;
      const nameOf = id => escapeHtml(state.entities[id]?.name ?? id);
      const items = lines.map(relation => `<li>${nameOf(relation.from)} → ${nameOf(relation.to)}</li>`).join('');
      const confirmed = await context.Popup.show.confirm(
        `Удалить линии: ${lines.length}`,
        `<ul style="text-align:left;margin:0;padding-left:18px">${items}</ul><p>Шкалы, воспоминания и напряжения этих линий будут удалены. Продолжить?</p>`,
      );
      if (confirmed !== context.POPUP_RESULT.AFFIRMATIVE) return false;
      const meta = { transactionId: uniqueId('manual'), reason: 'Ручное удаление линий', timestamp: new Date().toISOString() };
      await commit(applyOperations(state, lines.map(relation => createOperation('relationship.remove', {
        relationshipId: relation.id, from: relation.from, to: relation.to,
      }, meta))), true);
      return true;
    },
    onRemoveCharacter: async ({ characterId: id }) => {
      const entity = state.entities[id];
      if (!entity) throw new Error('Персонаж не найден.');
      if (state.ui?.personaId === id) throw new Error('Нельзя удалить привязанную персону. Сначала отвяжите её.');
      const relations = Object.values(state.relationships).filter(relation => relation.from === id || relation.to === id);
      const confirmed = await context.Popup.show.confirm(
        'Удалить персонажа',
        `«${entity.name}» будет удалён из реестра вместе с ${relations.length} линиями и упоминаниями из общих записей. Продолжить?`,
      );
      if (confirmed !== context.POPUP_RESULT.AFFIRMATIVE) return;
      await commit(applyOperation(state, createOperation('entity.remove', {
        entityId: id,
      }, { transactionId: uniqueId('manual'), reason: 'Ручное удаление персонажа', timestamp: new Date().toISOString() })), true);
    },
    onRemoveCharactersBulk: async ({ characterIds }) => {
      const ids = [...new Set((characterIds ?? []).filter(id => state.entities[id] && state.ui?.personaId !== id))];
      if (!ids.length) throw new Error('Не выбраны персонажи для удаления.');
      const names = ids.map(id => state.entities[id].name);
      const relationCount = Object.values(state.relationships)
        .filter(relation => ids.includes(relation.from) || ids.includes(relation.to)).length;
      const confirmed = await context.Popup.show.confirm(
        'Удалить выбранных персонажей',
        `Будут удалены: ${names.join(', ')}\n\nВместе с ними исчезнут ${relationCount} линий и упоминания из общих записей. Продолжить?`,
      );
      if (confirmed !== context.POPUP_RESULT.AFFIRMATIVE) return;
      let next = state;
      for (const id of ids) {
        next = applyOperation(next, createOperation('entity.remove', {
          entityId: id,
        }, { transactionId: uniqueId('manual'), reason: 'Массовое удаление персонажей', timestamp: new Date().toISOString() }));
      }
      await commit(next, true);
      globalThis.toastr?.success?.(`Удалено персонажей: ${ids.length}`, 'Движок отношений');
    },
    onMetricChange: changeMetric,
    onAddMemory: payload => addCollection('memory', payload),
    onAddTension: payload => addCollection('tension', payload),
    onImport: importFromStudio,
    onExport: exportForStudio,
    onSettingsChange: changeSettings,
    onHeadcanonKey: ({ firstId, secondId }) => headcanonKey(firstId, secondId),
    onAutoHeadcanons: ({ key }) => isAutoHeadcanonsFor(key),
    onAddHeadcanons: async ({ key, texts }) => {
      assertHeadcanonPair(key);
      const { headcanons, added } = addHeadcanons(state, key, texts ?? [], { source: 'manual' });
      await commitHeadcanons(headcanons);
      return added;
    },
    onUpdateHeadcanon: async ({ key, id, text, enabled }) => {
      assertHeadcanonPair(key);
      await commitHeadcanons(updateHeadcanons(state, key, entry => {
        const item = entry.items.find(candidate => candidate.id === id);
        if (!item) throw new Error('Хедканон не найден.');
        if (text != null) {
          const value = String(text).replace(/\s+/g, ' ').trim().slice(0, 400);
          if (!value) throw new Error('Текст хедканона пуст.');
          item.text = value;
        }
        if (enabled != null) item.enabled = Boolean(enabled);
      }));
    },
    onRemoveHeadcanon: async ({ key, id }) => {
      assertHeadcanonPair(key);
      await commitHeadcanons(updateHeadcanons(state, key, entry => { entry.items = entry.items.filter(item => item.id !== id); }));
    },
    onSetHeadcanonAuto: async ({ key, auto }) => {
      assertHeadcanonPair(key);
      await commitHeadcanons(updateHeadcanons(state, key, entry => { entry.auto = Boolean(auto); }));
    },
    onGenerateHeadcanons: async ({ key }) => {
      assertHeadcanonPair(key);
      if (isGenerationActive()) await waitForGenerationEnd();
      const [firstId, secondId] = headcanonPairIds(key);
      const loreContext = await loreAbout([firstId, secondId]);
      const existing = (state.ui?.headcanons?.[key]?.items ?? []).map(item => item.text);
      const texts = await generateHeadcanons(routedContext(SillyTavern.getContext(), settings, 'generation'), state, firstId, secondId, { loreContext, existing });
      const { headcanons, added } = addHeadcanons(state, key, texts, { source: 'lore' });
      await commitHeadcanons(headcanons);
      return added;
    },
    onToggleStrangers: async ({ relationshipId: id, strangers }) => {
      const relation = state.relationships[id];
      if (!relation) throw new Error('Линия не найдена.');
      const key = [relation.from, relation.to].sort().join('|');
      const next = structuredClone(state);
      next.ui ??= {};
      const pairs = new Set(next.ui.strangerPairs ?? []);
      if (strangers) pairs.add(key); else pairs.delete(key);
      next.ui.strangerPairs = [...pairs];
      await commit(next, true);
    },
    onSetHiddenScales: async ({ relationshipId: id, hiddenScales }) => {
      if (!state.relationships[id]) throw new Error('Линия не найдена.');
      await commit(applyOperation(state, createOperation('scales.hide', { relationshipId: id, hiddenScales }, {
        transactionId: uniqueId('manual'), reason: 'Видимость шкал линии', timestamp: new Date().toISOString(),
      })), true);
    },
    onGetDiagnostics: () => formatLog({
      'Движок отношений': 'журнал диагностики',
      'Браузер': globalThis.navigator?.userAgent ?? '?',
      'Экран': `${globalThis.innerWidth ?? '?'}×${globalThis.innerHeight ?? '?'}`,
      'Автоанализ': settings.autoAnalyze ? 'вкл' : 'выкл',
      'Инъекция': settings.enabled && settings.injectPrompt ? 'вкл' : 'выкл',
      // Never the key or the URL: only which mode is used.
      'Вспомогательный API': settings.aux?.mode === 'profile' ? 'профиль подключения' : settings.aux?.mode === 'custom' ? 'свой URL' : 'выкл',
      'Эмбеддинги': settings.embeddings?.mode === 'local' ? `локально (${settings.embeddings.localModel}, ${settings.embeddings.dtype})` : settings.embeddings?.mode === 'api' ? `API (${settings.embeddings.format})` : 'выкл',
      'Персонажей / линий': `${Object.keys(state.entities).length} / ${Object.keys(state.relationships).length}`,
    }),
    onClearDiagnostics: () => { clearLog(); notify(); },
    onRefreshScene: async () => { await prepareHeadcanons(); refreshPrompt(); },
    onAuxProfiles: () => listAuxProfiles(SillyTavern.getContext()),
    onLocalEmbeddingModels: () => Object.entries(LOCAL_MODELS).map(([id, model]) => ({ id, label: model.label })),
    /** Embeds two short texts with the settings being edited; the first local run downloads the model. */
    onTestEmbeddings: async ({ embeddings }) => {
      const config = normalizeEmbeddings({ ...settings.embeddings, ...embeddings });
      if (config.mode === 'off') throw new Error('Смысловой поиск выключен.');
      const started = Date.now();
      const [scene, fact] = await embedTexts(config, ['Они вместе идут домой под дождём', 'Он всегда провожает её до дома'], 'passage');
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      logEvent('info', `Проверка эмбеддингов: ${scene.length} измерений за ${seconds} с`);
      return `Работает: вектор из ${scene.length} чисел за ${seconds} с, сходство примера ${cosine(scene, fact).toFixed(2)}.`;
    },
    onAuxPurposes: () => ({ ...AUX_PURPOSES }),
    onFetchAuxModels: ({ url, key }) => fetchAuxModels(SillyTavern.getContext(), url, key),
    /** A tiny request with the settings being edited (not yet saved). */
    onTestAux: async ({ aux }) => {
      const candidate = normalizeAux({ ...settings.aux, ...aux });
      if (candidate.mode === 'off') throw new Error('Вспомогательный API выключен.');
      const started = Date.now();
      const reply = await auxGenerate(SillyTavern.getContext(), candidate, [{ role: 'user', content: 'Reply with the single word OK.' }]);
      logEvent('info', `Проверка вспомогательного API: ответ за ${Date.now() - started} мс`);
      return `Ответ получен за ${((Date.now() - started) / 1000).toFixed(1)} с: «${String(reply).trim().slice(0, 60)}»`;
    },
    onAnalyzeCurrent: () => runManualCheck(lastBotMessageIndex()),
    onAnalyzeHistory: enqueueHistory,
    onAnalyzeLorebooks: analyzeLorebooksForCharacters,
  };

  studio = createRelationshipStudio({
    store, callbacks, open: false,
    directionPresets,
    settingsFields: [
      { key: 'autoTrack', label: 'Автоматически анализировать новые ответы', type: 'checkbox' },
      { key: 'widgetEnabled', label: 'Показывать компактный виджет', type: 'checkbox' },
      { key: 'linkedScales', label: 'Связанные шкалы: рост привязанности немного тянет дружбу и доверие, обида — враждебность и т. п.', type: 'checkbox' },
      { key: 'autoCharacterLines', label: 'Автоматически создавать линии между персонажами (персонаж → персонаж)', type: 'checkbox' },
      { key: 'confirmPersonaLines', label: 'Спрашивать перед созданием новой линии к персоне', type: 'checkbox' },
      { key: 'sendMemories', label: 'Отправлять модели воспоминания', type: 'checkbox' },
      { key: 'sendTensions', label: 'Отправлять модели напряжения', type: 'checkbox' },
      { key: 'sendFactors', label: 'Отправлять модели факторы роста', type: 'checkbox' },
      { key: 'sendHeadcanons', label: 'Отправлять модели хедканоны (только подходящие к сцене)', type: 'checkbox' },
      { key: 'autoHeadcanons', label: 'Автозаполнение хедканонов по ходу игры: анализатор добавляет новые устойчивые факты о парах, у которых включено «Авто-хедканоны»', type: 'checkbox' },
      { key: 'headcanonLimit', label: 'Сколько хедканонов к сцене, не больше (1–30)', type: 'number', min: 1, max: 30 },
      { key: 'maxPromptCharacters', label: 'Объём данных для модели, символов (800–20000; ~1 токен на 3–4 символа). Не влезает всё — уходят самые слабые линии и старые записи.', type: 'number', min: 800, max: 20000 },
    ],
  });
  widget = createRelationshipWidget({
    store,
    expanded: settings.widget.expanded,
    position: { x: settings.widget.x ?? Math.max(8, window.innerWidth - 350), y: settings.widget.y ?? 96 },
    callbacks: {
      onOpenStudio: () => studio.open(),
      onAnalyzeLatest: () => runManualCheck(lastBotMessageIndex()),
      onPositionChange: ({ position }) => {
        settings.widget.x = position.x;
        settings.widget.y = position.y;
        context.saveSettingsDebounced();
      },
      onWidgetToggle: ({ expanded }) => {
        settings.widget.expanded = expanded;
        context.saveSettingsDebounced();
      },
    },
  });
  widget.element.hidden = !settings.widget.visible;

  function mountShell() {
    unmountShell();
    unmountShell = mountExtensionShell({
      settings,
      conflicts: detectConflicts(SillyTavern.getContext()),
      onOpenStudio: () => studio.open(),
      onSettingsChanged: () => {
        context.saveSettingsDebounced();
        widget.element.hidden = !settings.widget.visible;
        refreshPrompt();
      },
    });
  }

  function listen(type, handler) {
    if (!type) return;
    context.eventSource.on(type, handler);
    listeners.push(() => context.eventSource.removeListener(type, handler));
  }

  function fingerprint(text) {
    let hash = 2166136261;
    for (const char of String(text)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return (hash >>> 0).toString(36);
  }

  /** SillyTavern marks active generation on body; never run analysis or forced saves in parallel with it. */
  function isGenerationActive() {
    return typeof document !== 'undefined' && document.body?.dataset?.generating === 'true';
  }

  // Watch the attribute instead of polling: phone browsers freeze timers in a
  // background tab, so a polling loop could time out while the screen was off.
  async function waitForGenerationEnd(timeoutMs = 600000) {
    if (!isGenerationActive()) return;
    logEvent('info', 'Жду окончания основной генерации перед анализом');
    await new Promise(resolve => {
      let timer = null;
      const observer = new MutationObserver(() => { if (!isGenerationActive()) done(); });
      function done() { clearTimeout(timer); observer.disconnect(); resolve(); }
      observer.observe(document.body, { attributes: true, attributeFilter: ['data-generating'] });
      timer = setTimeout(done, timeoutMs);
    });
    if (isGenerationActive()) throw new Error('Основная генерация не завершилась вовремя; анализ отменён.');
  }

  function isPageHidden() {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
  }

  /** Phones suspend network requests of hidden tabs; start analysis only when the user is back. */
  function waitUntilVisible() {
    if (!isPageHidden()) return Promise.resolve();
    logEvent('info', 'Вкладка скрыта — анализ отложен до возвращения в таверну');
    return new Promise(resolve => {
      const onVisible = () => {
        if (isPageHidden()) return;
        document.removeEventListener('visibilitychange', onVisible);
        resolve();
      };
      document.addEventListener('visibilitychange', onVisible);
    });
  }

  /** One retry when the request died because the tab was hidden mid-flight. */
  async function analyzeWithResume(ctx, sourceState, message, loreContext, options = {}) {
    let hiddenDuringRequest = false;
    const markHidden = () => { if (isPageHidden()) hiddenDuringRequest = true; };
    document.addEventListener('visibilitychange', markHidden);
    try {
      return await analyzeMessage(routedContext(ctx, settings, 'analysis'), sourceState, message, settings, loreContext, options);
    } catch (error) {
      if (!hiddenDuringRequest) throw error;
      logEvent('warn', 'Запрос анализа прервался, пока вкладка была скрыта — повторяю', error);
      await waitUntilVisible();
      return analyzeMessage(routedContext(ctx, settings, 'analysis'), sourceState, message, settings, loreContext, options);
    } finally {
      document.removeEventListener('visibilitychange', markHidden);
    }
  }

  /** Returns the operations to apply: all, only the small ones, or null when cancelled. */
  async function confirmLargeChanges(operations) {
    const isLarge = item => Math.abs(Number(item.delta)) >= settings.largeChangeThreshold;
    if (!settings.confirmLargeChanges || !operations.some(isLarge)) return operations;
    const smallOnly = operations.filter(item => !isLarge(item));
    const rows = describeProposedChanges(state, operations, settings.largeChangeThreshold).map(change => {
      const sign = change.delta > 0 ? '+' : '';
      const line = `${escapeHtml(change.from)} → ${escapeHtml(change.to)}: ${escapeHtml(change.scale)} ${sign}${change.delta}`;
      return `<li style="margin:4px 0">${change.large ? `<b>${line}</b>` : line}${change.reason ? `<br><small>${escapeHtml(change.reason)}</small>` : ''}</li>`;
    }).join('');
    const result = await context.Popup.show.confirm(
      'Скачок в отношениях',
      `<p>Анализатор предлагает крупное изменение (порог ${settings.largeChangeThreshold}). Крупные выделены:</p><ul style="text-align:left;margin:0;padding-left:18px">${rows}</ul><p>Воспоминания и напряжения из этого ответа сохранятся при любом выборе, кроме «Отменить».</p>`,
      {
        okButton: 'Применить всё',
        cancelButton: 'Отменить',
        customButtons: [{ text: 'Только мелкие', result: context.POPUP_RESULT.CUSTOM1, tooltip: 'Отбросить крупные изменения шкал, остальное применить' }],
      },
    );
    if (result === context.POPUP_RESULT.AFFIRMATIVE) return operations;
    if (result === context.POPUP_RESULT.CUSTOM1) return smallOnly;
    return null;
  }

  /** Ask the user about unregistered scene participants. Returns [] / accepted list, or null if analysis was cancelled. */
  async function confirmNewCharacters(characters, ctx) {
    if (!characters?.length) return [];
    // Popup text is HTML: names and notes come from the model and must be escaped.
    const lines = characters.map(character =>
      `<li>${escapeHtml(character.name)}${character.aliases.length ? ` (${escapeHtml(character.aliases.join(', '))})` : ''}${character.note ? ` — ${escapeHtml(character.note)}` : ''}</li>`).join('');
    const accepted = await ctx.Popup.show.confirm(
      'Новые персонажи в сцене',
      `<p>В этом ответе участвуют незарегистрированные персонажи:</p><ul style="text-align:left;margin:0;padding-left:18px">${lines}</ul><p>Добавить их и линии отношений с ними? Ответ «Нет» сохранит анализ только по известным персонажам.</p>`,
    );
    if (accepted !== ctx.POPUP_RESULT.AFFIRMATIVE) return [];
    return characters;
  }

  async function processMessage(messageIndex, force = false, expectedChatId, expectedEpoch = chatEpoch) {
    const ctx = SillyTavern.getContext();
    const sourceChatId = ctx.getCurrentChatId();
    const label = `Сообщение #${messageIndex}`;
    const skip = reason => { logEvent('info', `${label}: анализ пропущен — ${reason}`); return { applied: 0, skipped: reason }; };
    if ((expectedChatId != null && sourceChatId !== expectedChatId) || expectedEpoch !== chatEpoch) return skip('чат сменился до начала анализа');
    if (isGenerationActive()) await waitForGenerationEnd();
    if (expectedEpoch !== chatEpoch || SillyTavern.getContext().getCurrentChatId() !== sourceChatId) return skip('чат сменился во время генерации');
    const message = ctx.chat?.[messageIndex];
    if (!settings.enabled) return skip('расширение выключено');
    if (!message || message.is_user || !message.mes?.trim()) return skip('нет ответа бота с текстом');
    if (message.extra?.[MESSAGE_EXTRA_KEY]?.historyImported) {
      if (force) throw new Error('Это сообщение уже учтено в общем анализе истории. Для пересчёта используйте «Проанализировать историю».');
      return skip('уже учтено в анализе истории');
    }
    const textHash = fingerprint(message.mes);
    if (!force && message.extra?.[MESSAGE_EXTRA_KEY]?.fingerprint === textHash) return skip('этот текст уже проанализирован');
    if (!force) await waitUntilVisible();
    // Analyse against the state WITHOUT this message's earlier result. A re-check
    // (swipe back, edit, manual) told "already recorded" about the very memories
    // it is about to roll back would leave them out, and they would be lost.
    const sourceState = state.operations.some(operation => operation.messageId === String(messageIndex))
      ? rollbackMessage(state, String(messageIndex)) : state;
    const loreContext = await loadLinkedLore(ctx, sourceState);
    if (expectedEpoch !== chatEpoch) return skip('чат сменился');
    logEvent('info', `${label}: анализ начат${force ? ' (вручную)' : ''}`);
    const headcanonKeys = autoHeadcanonKeys(sourceState, message.mes);
    const result = await analyzeWithResume(ctx, sourceState, message, loreContext, { headcanonPairs: headcanonKeys });
    // Analysis yields relative deltas, so a newer state (a moved slider, a selected
    // pair) is fine to apply them to. Only a different chat or message text is stale.
    const isStale = () => expectedEpoch !== chatEpoch || SillyTavern.getContext().getCurrentChatId() !== sourceChatId
      || fingerprint(SillyTavern.getContext().chat?.[messageIndex]?.mes) !== textHash;
    if (isStale()) return skip('чат или текст сообщения изменились, пока модель отвечала');
    const confirmedOperations = await confirmLargeChanges(result.operations);
    if (!confirmedOperations) return skip('скачок отклонён пользователем');
    if (confirmedOperations.length !== result.operations.length) logEvent('info', `${label}: крупные изменения отброшены, применяются только мелкие`);
    result.operations = confirmedOperations;
    if (isStale()) return skip('чат или текст сообщения изменились');
    const acceptedNewCharacters = await confirmNewCharacters(result.newCharacters, ctx);
    if (acceptedNewCharacters === null) return skip('анализ отменён');
    if (isStale()) return skip('чат или текст сообщения изменились');
    const transactionId = `message:${messageIndex}:${textHash}`;
    let next = state.operations.some(operation => operation.messageId === String(messageIndex))
      ? rollbackMessage(state, String(messageIndex)) : state;
    // Re-analysis replaces this message's automatic headcanons too.
    next = withoutAutoHeadcanons(next, String(messageIndex));
    const allowNewPair = await confirmNewPairs(next, result, acceptedNewCharacters);
    if (!allowNewPair) return skip('анализ отменён');
    if (isStale()) return skip('чат или текст сообщения изменились');
    const applied = applyAnalysisResult(next, result, { transactionId, messageId: String(messageIndex), messageIndex }, acceptedNewCharacters,
      { linkedScales: settings.linkedScales !== false, allowNewPair, headcanonKeys });
    next = applied.state;
    const operations = applied.operations;
    const headcanonIds = [];
    for (const { key, text } of applied.headcanons ?? []) {
      const added = addHeadcanons(next, key, [text], { source: 'auto', messageId: messageIndex });
      next = { ...next, ui: { ...next.ui, headcanons: added.headcanons } };
      headcanonIds.push(...added.ids);
    }
    if (!operations.length && !headcanonIds.length) return skip('модель не нашла изменений в отношениях');
    message.extra ??= {};
    message.extra[MESSAGE_EXTRA_KEY] = {
      fingerprint: textHash,
      transactionId,
      operationIds: operations.map(operation => operation.id),
      ...(headcanonIds.length ? { headcanonIds } : {}),
      analyzedAt: new Date().toISOString(),
    };
    await commit(next, true);
    if (headcanonIds.length) { await prepareHeadcanons(); refreshPrompt(); }
    logEvent('info', `${label}: применено изменений — ${operations.length}${headcanonIds.length ? `, новых хедканонов — ${headcanonIds.length}` : ''}, состояние сохранено`);
    if (isGenerationActive()) await waitForGenerationEnd();
    await SillyTavern.getContext().saveChat();
    return { applied: operations.length + headcanonIds.length };
  }

  /** Pairs whose automatic headcanons the analyzer may extend: auto on, both members in the reply. */
  function autoHeadcanonKeys(targetState, text) {
    if (!settings.autoHeadcanons) return [];
    const present = [...mentionedEntities(targetState, text)];
    const keys = [];
    for (let left = 0; left < present.length; left += 1) {
      for (let right = left + 1; right < present.length; right += 1) {
        const key = headcanonKey(present[left], present[right]);
        if (isAutoHeadcanons(targetState, key)) keys.push(key);
      }
    }
    return keys.slice(0, 12);
  }

  function withoutAutoHeadcanons(targetState, messageId) {
    const { headcanons, dropped } = dropAutoHeadcanons(targetState, id => id === messageId);
    return dropped ? { ...targetState, ui: { ...targetState.ui, headcanons } } : targetState;
  }

  /**
   * #25: new lines between two characters can be switched off, new lines toward
   * the persona are confirmed. A dry run (applyAnalysisResult is pure) tells which
   * lines the result would create. Returns a predicate, or null when cancelled.
   */
  async function confirmNewPairs(baseState, result, acceptedNewCharacters) {
    const personaId = baseState.ui?.personaId || '';
    const allowCharacterLines = settings.autoCharacterLines !== false;
    const basePolicy = (subjectId, objectId) => allowCharacterLines || (personaId && objectId === personaId);
    const dryRun = applyAnalysisResult(baseState, result, {}, acceptedNewCharacters, { linkedScales: false, allowNewPair: basePolicy }).state;
    const created = Object.values(dryRun.relationships).filter(relation => !baseState.relationships[relation.id]);
    const personaLines = settings.confirmPersonaLines === false ? [] : created.filter(relation => personaId && relation.to === personaId);
    let rejected = new Set();
    if (personaLines.length) {
      // One checkbox per line (all checked): create only the ticked ones; "Без них" creates none.
      const nameOf = id => dryRun.entities[id]?.name ?? id;
      const ctx = SillyTavern.getContext();
      const inputs = personaLines.map((relation, index) => ({
        id: `relationship-engine-persona-line-${index}`,
        label: `${nameOf(relation.from)} → ${nameOf(relation.to)}`,
        defaultState: true,
      }));
      const popup = new ctx.Popup(
        '<h3>Новые линии с персоной</h3><p>Анализ хочет начать отслеживать чувства к персоне. Отметьте линии, которые нужно создать; анализ применится и без остальных.</p>',
        ctx.POPUP_TYPE.CONFIRM, null,
        { okButton: 'Создать отмеченные', cancelButton: 'Без них', customInputs: inputs },
      );
      const answer = await popup.show();
      rejected = new Set(personaLines
        .filter((relation, index) => answer !== ctx.POPUP_RESULT.AFFIRMATIVE || !popup.inputResults?.get(inputs[index].id))
        .map(relation => relation.id));
      if (rejected.size) logEvent('info', `Новые линии с персоной отклонены: ${rejected.size} из ${personaLines.length}`);
    }
    return (subjectId, objectId) => basePolicy(subjectId, objectId) && !rejected.has(relationshipId(subjectId, objectId));
  }

  function lastBotMessageIndex() {
    const chat = SillyTavern.getContext().chat ?? [];
    for (let index = chat.length - 1; index >= 0; index -= 1) {
      if (!chat[index]?.is_user && !chat[index]?.is_system && chat[index]?.mes?.trim()) return index;
    }
    return -1;
  }

  /** Manual check from a message button, the widget or the Studio, with a visible outcome. */
  async function runManualCheck(index) {
    const toast = globalThis.toastr;
    if (!Number.isInteger(index) || index < 0) {
      toast?.warning?.('В чате нет ответа бота для проверки.', 'Движок отношений');
      return null;
    }
    toast?.info?.(`Проверяю ответ #${index}…`, 'Движок отношений', { timeOut: 2500 });
    const result = await enqueueAnalysis(index, true);
    if (!result) return null; // the failure toast is shown by enqueueAnalysis
    if (result.applied) toast?.success?.(`Применено изменений: ${result.applied}. Подробности — во вкладке «История».`, 'Движок отношений');
    else toast?.info?.(`Без изменений: ${result.skipped}.`, 'Движок отношений');
    return result;
  }

  function enqueueAnalysis(messageIndex, force = false) {
    const queuedContext = SillyTavern.getContext();
    const expectedChatId = queuedContext.getCurrentChatId();
    const expectedEpoch = chatEpoch;
    analysisQueue = analysisQueue.then(() => processMessage(Number(messageIndex), force, expectedChatId, expectedEpoch)).catch(error => {
      logEvent('error', `Сообщение #${messageIndex}: анализ не удался`, error);
      globalThis.toastr?.error?.(error.message, 'Движок отношений');
    });
    return analysisQueue;
  }

  async function reconcileMessageTransactions(expectedChatId, expectedEpoch) {
    const current = SillyTavern.getContext();
    if (expectedEpoch !== chatEpoch || current.getCurrentChatId() !== expectedChatId) return;
    const chat = current.chat ?? [];
    const liveOperations = new Map();
    const liveHeadcanons = new Map();
    chat.forEach((message, index) => {
      const marker = message.extra?.[MESSAGE_EXTRA_KEY];
      for (const operationId of marker?.operationIds ?? []) liveOperations.set(operationId, index);
      for (const headcanonId of marker?.headcanonIds ?? []) liveHeadcanons.set(headcanonId, index);
    });
    // Automatic headcanons follow their message to its new index, or leave with it.
    const remapped = remapAutoHeadcanons(state, id => liveHeadcanons.get(id) ?? null);
    const kept = state.operations
      .filter(operation => !operation.messageId || liveOperations.has(operation.id))
      .map(operation => {
        if (!operation.messageId) return operation;
        const index = liveOperations.get(operation.id);
        return { ...operation, messageId: String(index), messageIndex: index };
      });
    if (kept.length === state.operations.length
      && kept.every((operation, index) => operation.messageIndex === state.operations[index].messageIndex)) {
      if (remapped.changed) await commitHeadcanons(remapped.headcanons);
      return;
    }
    let next = createDefaultState({ scales: state.config.scales });
    next.baseline = structuredClone(state.baseline);
    next.entities = structuredClone(state.baseline.entities ?? {});
    next.relationships = structuredClone(state.baseline.relationships ?? {});
    next.records = structuredClone(state.baseline.records ?? { memories: [], tensions: [] });
    next.snapshots = structuredClone(state.snapshots ?? []);
    next.ui = { ...structuredClone(state.ui ?? { activeRelationshipId: '' }), headcanons: remapped.headcanons };
    next = applyOperations(next, kept);
    if (expectedEpoch !== chatEpoch || SillyTavern.getContext().getCurrentChatId() !== expectedChatId) return;
    await commit(next, true);
    if (remapped.changed) { await prepareHeadcanons(); refreshPrompt(); }
  }

  const events = context.eventTypes ?? context.event_types;
  listen(events.CHAT_CHANGED, () => {
    chatEpoch += 1;
    state = storage.load();
    autoBindPersona(state).catch(error => console.error('[Relationship Engine] Persona auto-bind failed.', error));
    sceneHeadcanons = [];
    refreshPrompt();
    notify();
    const epoch = chatEpoch;
    prepareHeadcanons().then(() => { if (epoch === chatEpoch) refreshPrompt(); });
  });
  listen(events.MESSAGE_RECEIVED, messageIndex => {
    if (settings.autoAnalyze) enqueueAnalysis(messageIndex);
  });
  listen(events.MESSAGE_EDITED, messageIndex => {
    const expectedChatId = SillyTavern.getContext().getCurrentChatId();
    const expectedEpoch = chatEpoch;
    analysisQueue = analysisQueue.then(async () => {
      if (expectedEpoch !== chatEpoch || SillyTavern.getContext().getCurrentChatId() !== expectedChatId) return;
      const hasOperations = state.operations.some(operation => operation.messageId === String(messageIndex));
      const withoutHeads = withoutAutoHeadcanons(hasOperations ? rollbackMessage(state, String(messageIndex)) : state, String(messageIndex));
      if (hasOperations || withoutHeads !== state) await commit(withoutHeads, true);
      if (settings.autoAnalyze) await processMessage(Number(messageIndex), true, expectedChatId, expectedEpoch);
    }).catch(error => console.error('[Relationship Engine] Edited message processing failed.', error));
  });
  listen(events.MESSAGE_SWIPED, messageIndex => {
    // A swipe often starts a new generation right after this event; wait for MESSAGE_RECEIVED
    // instead of racing the main generation with a background analysis.
    if (isGenerationActive()) return;
    if (settings.autoAnalyze) enqueueAnalysis(messageIndex, true);
  });
  listen(events.MESSAGE_DELETED, () => {
    const expectedChatId = SillyTavern.getContext().getCurrentChatId();
    const expectedEpoch = chatEpoch;
    analysisQueue = analysisQueue.then(() => reconcileMessageTransactions(expectedChatId, expectedEpoch))
      .catch(error => console.error('[Relationship Engine] Message reconciliation failed.', error));
  });

  const messageButtons = mountMessageButtons(index => { runManualCheck(index); });
  for (const type of [events.CHARACTER_MESSAGE_RENDERED, events.MORE_MESSAGES_LOADED, events.CHAT_CHANGED]) {
    if (type) listen(type, () => messageButtons.refresh());
  }

  mountShell();
  refreshPrompt();
  notify();

  controller = {
    open: () => studio.open(),
    analyzeCurrent: () => runManualCheck(lastBotMessageIndex()),
    getState: () => structuredClone(state),
    destroy() {
      listeners.splice(0).forEach(remove => remove());
      messageButtons.unmount();
      unmountShell();
      studio.destroy();
      widget.destroy();
      clearRelationshipPrompt(SillyTavern.getContext());
      delete globalThis.relationshipEngineInterceptor;
      controller = null;
    },
  };
  globalThis.RelationshipEngine = controller;
  // manifest.json → generate_interceptor: runs before SillyTavern assembles the prompt,
  // so headcanons are picked for the scene that is about to be written.
  globalThis.relationshipEngineInterceptor = async (chat, contextSize, abort, type) => {
    if (type === 'quiet' || !controller) return;
    await prepareHeadcanons(chat);
    refreshPrompt();
  };
  return controller;
}

export function getController() {
  return controller;
}
