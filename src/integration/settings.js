export const MODULE_ID = 'relationshipEngine';
export const METADATA_KEY = 'relationshipEngine.v1';
export const PROMPT_KEY = 'relationship-engine-runtime';

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  autoAnalyze: false,
  injectPrompt: true,
  confirmLargeChanges: true,
  largeChangeThreshold: 12,
  maxPromptCharacters: 2400,
  analysisMaxCharacters: 12000,
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
