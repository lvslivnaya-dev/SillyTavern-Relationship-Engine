import {
  applyOperation,
  applyOperations,
  createDefaultState,
  createEntity,
  createOperation,
  importState,
  relationshipId,
  rollbackMessage,
  selectRuntimePrompt,
  uniqueId,
} from './src/core/index.js';
import { analyzeHistoryBatch, analyzeMessage, discoverHistoryCharacters } from './src/integration/analyzer.js';
import { detectConflicts } from './src/integration/conflicts.js';
import { clearRelationshipPrompt, updateRelationshipPrompt } from './src/integration/prompt.js';
import { getSettings } from './src/integration/settings.js';
import { createHistoryBatches, rebuildWithoutAutomaticHistory, historyFingerprint, sampleHistory } from './src/integration/history.js';
import { applyAnalysisResult } from './src/integration/analysis-operations.js';
import { loadLinkedLore, analyzeLorebookCharacters, canonKeys, namesMatch } from './src/integration/lorebooks.js';
import { generateGrowthFactors, directionPresets } from './src/integration/growth.js';
import { getAnalysisTokenUsage } from './src/integration/analyzer.js';
import { onChangeBusy, getBusy, resetBusy } from './src/integration/busy.js';
import { triangleEdges } from './src/core/records.js';
import { mountExtensionShell } from './src/integration/shell.js';
import { createChatStorage } from './src/integration/storage.js';
import { createRelationshipStudio } from './src/ui/studio.js';
import { createRelationshipWidget } from './src/ui/widget.js';

const MESSAGE_EXTRA_KEY = 'relationshipEngineV1';
let controller = null;

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
      settings: { autoTrack: settings.autoAnalyze, widgetEnabled: settings.widget.visible },
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
    await storage.save(state);
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
    return selectRuntimePrompt({ ...targetState, ui: { ...targetState.ui, personaId: persona } }, {
      maxRelationships: Math.min(Object.keys(targetState.relationships).length, 8),
      memoryLimit: 2,
      tensionLimit: 2,
    }).slice(0, settings.maxPromptCharacters);
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
      next = applyOperation(next, createOperation('relationship.upsert', { from: sourceId, to: targetId }, { id: `relationship:${id}` }));
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
    await commit(importState(data?.state ?? data), true);
  }

  function exportForStudio() {
    return { kind: 'sillytavern-relationship-engine', exportedAt: new Date().toISOString(), state };
  }

  async function changeSettings({ settings: patch }) {
    if (Object.hasOwn(patch, 'autoTrack')) settings.autoAnalyze = Boolean(patch.autoTrack);
    if (Object.hasOwn(patch, 'widgetEnabled')) settings.widget.visible = Boolean(patch.widgetEnabled);
    context.saveSettingsDebounced();
    widget.element.hidden = !settings.widget.visible;
    refreshPrompt();
    notify();
  }

  /** Lorebooks bound to the current card(s) in SillyTavern (card's "world"). */
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
      const { characters, knownAliases } = await analyzeLorebookCharacters(ctx, book, bookName, knownEntities);
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
    const { characters: discovered, knownAliases } = await discoverHistoryCharacters(ctx, sampleHistory(messages, settings.analysisMaxCharacters * 2), settings, knownEntities, cardContext(ctx));
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
      const result = await analyzeHistoryBatch(ctx, next, batches[batchIndex], settings, loreContext);
      assertCurrent();
      next = applyAnalysisResult(next, result, { transactionId: 'history-import' }).state;
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
        if (!next.relationships[id]) next = applyOperation(next, createOperation('relationship.upsert', { from: a, to: b }, { id: `relationship:${id}` }));
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
    onSelectPair: selectPair,
    onSetFactors: async ({ sourceId, targetId, factors }) => {
      const id = relationshipId(sourceId, targetId);
      if (!state.relationships[id]) throw new Error('Линия не найдена.');
      await commit(applyOperation(state, createOperation('factors.set', {
        relationshipId: id, factors,
      }, { transactionId: uniqueId('manual'), reason: 'Ручное изменение факторов', timestamp: new Date().toISOString() })), true);
    },
    onGenerateFactors: async ({ sourceId, targetId, directionId, customDirection, replace }) => {
      if (isGenerationActive()) await waitForGenerationEnd();
      const id = relationshipId(sourceId, targetId);
      if (!state.relationships[id]) throw new Error('Сначала создайте линию.');
      const loreContext = await loadLinkedLore(SillyTavern.getContext(), state);
      const factors = await generateGrowthFactors(SillyTavern.getContext(), state, sourceId, targetId, {
        directionId, customDirection, loreContext,
      });
      const merged = replace ? factors : [...(state.relationships[id].factors ?? []), ...factors];
      await commit(applyOperation(state, createOperation('factors.set', {
        relationshipId: id, factors: merged,
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
        `Линия «${state.entities[sourceId].name} → ${state.entities[targetId].name}» и её шкалы, воспоминания и напряжения будут удалены. Продолжить?`,
      );
      if (confirmed !== context.POPUP_RESULT.AFFIRMATIVE) return;
      await commit(applyOperation(state, createOperation('relationship.remove', {
        relationshipId: id, from: sourceId, to: targetId,
      }, { transactionId: uniqueId('manual'), reason: 'Ручное удаление линии', timestamp: new Date().toISOString() })), true);
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
    onAnalyzeCurrent: () => enqueueAnalysis(SillyTavern.getContext().chat.length - 1, true),
    onAnalyzeHistory: enqueueHistory,
    onAnalyzeLorebooks: analyzeLorebooksForCharacters,
  };

  studio = createRelationshipStudio({
    store, callbacks, open: false,
    directionPresets,
    settingsFields: [
      { key: 'autoTrack', label: 'Автоматически анализировать новые ответы', type: 'checkbox' },
      { key: 'widgetEnabled', label: 'Показывать компактный виджет', type: 'checkbox' },
    ],
  });
  widget = createRelationshipWidget({
    store,
    expanded: settings.widget.expanded,
    position: { x: settings.widget.x ?? Math.max(8, window.innerWidth - 350), y: settings.widget.y ?? 96 },
    callbacks: {
      onOpenStudio: () => studio.open(),
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

  async function waitForGenerationEnd(timeoutMs = 180000) {
    const deadline = Date.now() + timeoutMs;
    while (isGenerationActive() && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (isGenerationActive()) throw new Error('Основная генерация не завершилась вовремя; анализ отменён.');
  }

  async function confirmLargeChanges(operations) {
    if (!settings.confirmLargeChanges || !operations.some(item => Math.abs(Number(item.delta)) >= settings.largeChangeThreshold)) return true;
    const result = await context.Popup.show.confirm(
      'Движок отношений',
      'Анализатор предложил крупное изменение отношений. Применить его?',
    );
    return result === context.POPUP_RESULT.AFFIRMATIVE;
  }

  /** Ask the user about unregistered scene participants. Returns [] / accepted list, or null if analysis was cancelled. */
  async function confirmNewCharacters(characters, ctx) {
    if (!characters?.length) return [];
    const lines = characters.map(character =>
      `• ${character.name}${character.aliases.length ? ` (${character.aliases.join(', ')})` : ''}${character.note ? ` — ${character.note}` : ''}`).join('\n');
    const accepted = await ctx.Popup.show.confirm(
      'Новые персонажи в сцене',
      `В этом ответе участвуют незарегистрированные персонажи:\n\n${lines}\n\nДобавить их и линии отношений с ними? Ответ «Нет» сохранит анализ только по известным персонажам.`,
    );
    if (accepted !== ctx.POPUP_RESULT.AFFIRMATIVE) return [];
    return characters;
  }

  async function processMessage(messageIndex, force = false, expectedChatId, expectedEpoch = chatEpoch) {
    const ctx = SillyTavern.getContext();
    const sourceChatId = ctx.getCurrentChatId();
    if ((expectedChatId != null && sourceChatId !== expectedChatId) || expectedEpoch !== chatEpoch) return;
    if (isGenerationActive()) await waitForGenerationEnd();
    if (expectedEpoch !== chatEpoch || SillyTavern.getContext().getCurrentChatId() !== sourceChatId) return;
    const message = ctx.chat?.[messageIndex];
    if (!message || message.is_user || !message.mes?.trim() || !settings.enabled) return;
    if (message.extra?.[MESSAGE_EXTRA_KEY]?.historyImported) {
      if (force) throw new Error('Это сообщение уже учтено в общем анализе истории. Для пересчёта используйте «Проанализировать историю».');
      return;
    }
    const textHash = fingerprint(message.mes);
    if (!force && message.extra?.[MESSAGE_EXTRA_KEY]?.fingerprint === textHash) return;
    const sourceState = state;
    const loreContext = await loadLinkedLore(ctx, sourceState);
    if (expectedEpoch !== chatEpoch || state !== sourceState) return;
    const result = await analyzeMessage(ctx, sourceState, message, settings, loreContext);
    const current = SillyTavern.getContext();
    if (state !== sourceState || expectedEpoch !== chatEpoch || current.getCurrentChatId() !== sourceChatId || fingerprint(current.chat?.[messageIndex]?.mes) !== textHash) {
      console.info('[Relationship Engine] Discarded stale analysis after chat or message change.');
      return;
    }
    if (!await confirmLargeChanges(result.operations)) return;
    if (expectedEpoch !== chatEpoch || SillyTavern.getContext().getCurrentChatId() !== sourceChatId
      || fingerprint(SillyTavern.getContext().chat?.[messageIndex]?.mes) !== textHash) return;
    const acceptedNewCharacters = await confirmNewCharacters(result.newCharacters, ctx);
    if (acceptedNewCharacters === null) return;
    if (expectedEpoch !== chatEpoch || SillyTavern.getContext().getCurrentChatId() !== sourceChatId
      || fingerprint(SillyTavern.getContext().chat?.[messageIndex]?.mes) !== textHash) return;
    const transactionId = `message:${messageIndex}:${textHash}`;
    let next = state.operations.some(operation => operation.messageId === String(messageIndex))
      ? rollbackMessage(state, String(messageIndex)) : state;
    const applied = applyAnalysisResult(next, result, { transactionId, messageId: String(messageIndex), messageIndex }, acceptedNewCharacters);
    next = applied.state;
    const operations = applied.operations;
    if (!operations.length) return;
    message.extra ??= {};
    message.extra[MESSAGE_EXTRA_KEY] = {
      fingerprint: textHash,
      transactionId,
      operationIds: operations.map(operation => operation.id),
      analyzedAt: new Date().toISOString(),
    };
    await commit(next, true);
    if (isGenerationActive()) await waitForGenerationEnd();
    await current.saveChat();
  }

  function enqueueAnalysis(messageIndex, force = false) {
    const queuedContext = SillyTavern.getContext();
    const expectedChatId = queuedContext.getCurrentChatId();
    const expectedEpoch = chatEpoch;
    analysisQueue = analysisQueue.then(() => processMessage(Number(messageIndex), force, expectedChatId, expectedEpoch)).catch(error => {
      console.error('[Relationship Engine] Message processing failed.', error);
      globalThis.toastr?.error?.(error.message, 'Движок отношений');
    });
    return analysisQueue;
  }

  async function reconcileMessageTransactions(expectedChatId, expectedEpoch) {
    const current = SillyTavern.getContext();
    if (expectedEpoch !== chatEpoch || current.getCurrentChatId() !== expectedChatId) return;
    const chat = current.chat ?? [];
    const liveOperations = new Map();
    chat.forEach((message, index) => {
      const marker = message.extra?.[MESSAGE_EXTRA_KEY];
      for (const operationId of marker?.operationIds ?? []) liveOperations.set(operationId, index);
    });
    const kept = state.operations
      .filter(operation => !operation.messageId || liveOperations.has(operation.id))
      .map(operation => {
        if (!operation.messageId) return operation;
        const index = liveOperations.get(operation.id);
        return { ...operation, messageId: String(index), messageIndex: index };
      });
    if (kept.length === state.operations.length
      && kept.every((operation, index) => operation.messageIndex === state.operations[index].messageIndex)) return;
    let next = createDefaultState({ scales: state.config.scales });
    next.baseline = structuredClone(state.baseline);
    next.entities = structuredClone(state.baseline.entities ?? {});
    next.relationships = structuredClone(state.baseline.relationships ?? {});
    next.records = structuredClone(state.baseline.records ?? { memories: [], tensions: [] });
    next.snapshots = structuredClone(state.snapshots ?? []);
    next.ui = structuredClone(state.ui ?? { activeRelationshipId: '' });
    next = applyOperations(next, kept);
    if (expectedEpoch !== chatEpoch || SillyTavern.getContext().getCurrentChatId() !== expectedChatId) return;
    await commit(next, true);
  }

  const events = context.eventTypes ?? context.event_types;
  listen(events.CHAT_CHANGED, () => {
    chatEpoch += 1;
    state = storage.load();
    autoBindPersona(state).catch(error => console.error('[Relationship Engine] Persona auto-bind failed.', error));
    refreshPrompt();
    notify();
  });
  listen(events.MESSAGE_RECEIVED, messageIndex => {
    if (settings.autoAnalyze) enqueueAnalysis(messageIndex);
  });
  listen(events.MESSAGE_EDITED, messageIndex => {
    const expectedChatId = SillyTavern.getContext().getCurrentChatId();
    const expectedEpoch = chatEpoch;
    analysisQueue = analysisQueue.then(async () => {
      if (expectedEpoch !== chatEpoch || SillyTavern.getContext().getCurrentChatId() !== expectedChatId) return;
      if (state.operations.some(operation => operation.messageId === String(messageIndex))) {
        await commit(rollbackMessage(state, String(messageIndex)), true);
      }
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

  mountShell();
  refreshPrompt();
  notify();

  controller = {
    open: () => studio.open(),
    analyzeCurrent: () => enqueueAnalysis(SillyTavern.getContext().chat.length - 1, true),
    getState: () => structuredClone(state),
    destroy() {
      listeners.splice(0).forEach(remove => remove());
      unmountShell();
      studio.destroy();
      widget.destroy();
      clearRelationshipPrompt(SillyTavern.getContext());
      controller = null;
    },
  };
  globalThis.RelationshipEngine = controller;
  return controller;
}

export function getController() {
  return controller;
}
