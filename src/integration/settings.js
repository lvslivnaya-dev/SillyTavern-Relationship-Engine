export const MODULE_ID = 'relationshipEngine';
export const METADATA_KEY = 'relationshipEngine.v1';
export const PROMPT_KEY = 'relationship-engine-runtime';

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  autoAnalyze: false,
  injectPrompt: true,
  confirmLargeChanges: true,
  largeChangeThreshold: 12,
  linkedScales: true,
  autoCharacterLines: true,
  confirmPersonaLines: true,
  sendMemories: true,
  sendTensions: true,
  sendFactors: true,
  sendHeadcanons: true,
  autoHeadcanons: false,
  headcanonLimit: 8,
  maxPromptCharacters: 4000,
  analysisMaxCharacters: 12000,
  // Auxiliary model for the extension's own requests (see llm.js). The key of the
  // 'custom' mode is stored here, in SillyTavern's extension settings.
  aux: {
    mode: 'off',
    profileId: '',
    url: '',
    key: '',
    model: '',
    maxTokens: 4096,
    fallbackToMain: false,
    purposes: { analysis: true, discovery: true, generation: true },
  },
  // Semantic choice of headcanons (see embeddings.js); off = pick by mentions.
  embeddings: {
    mode: 'off',
    localModel: 'Xenova/multilingual-e5-small',
    dtype: 'q8',
    format: 'openai',
    url: '',
    key: '',
    model: '',
    threshold: 0,
  },
  widget: {
    visible: true,
    expanded: false,
    x: null,
    y: 96,
    opacity: 0.96,
    showNumbers: true,
  },
});

export function getSettings(context) {
  const settingsRoot = context.extensionSettings;
  settingsRoot[MODULE_ID] ??= structuredClone(DEFAULT_SETTINGS);
  const settings = settingsRoot[MODULE_ID];
  mergeMissing(settings, DEFAULT_SETTINGS);
  // 2400 was the old built-in limit and was never editable, so it is never a user's choice.
  if (settings.maxPromptCharacters === 2400) settings.maxPromptCharacters = DEFAULT_SETTINGS.maxPromptCharacters;
  return settings;
}

export function mergeMissing(target, defaults) {
  for (const [key, value] of Object.entries(defaults)) {
    if (!Object.hasOwn(target, key)) {
      target[key] = structuredClone(value);
    } else if (isPlainObject(value) && isPlainObject(target[key])) {
      mergeMissing(target[key], value);
    }
  }
  return target;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
