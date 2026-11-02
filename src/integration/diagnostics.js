/**
 * A small ring-buffer log that users can copy from the settings and send to
 * the developer. Phone browsers rarely give access to a console, so every
 * skipped analysis, save and failure is recorded here with a plain reason.
 *
 * The buffer survives page reloads through localStorage when it is available;
 * without storage (private mode, blocked site data) it simply lives in memory.
 */
const STORAGE_KEY = 'relationshipEngine.diagnostics';
const LIMIT = 150;
let entries = restore();

function restore() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(-LIMIT) : [];
  } catch {
    return [];
  }
}

function persist() {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(entries)); }
  catch { /* storage full or blocked: the in-memory log still works */ }
}

function detailText(details) {
  if (details == null) return '';
  if (details instanceof Error) return details.message;
  if (typeof details === 'string') return details;
  try { return JSON.stringify(details); } catch { return String(details); }
}

/** level: 'info' | 'warn' | 'error'. */
export function logEvent(level, message, details) {
  const entry = { time: new Date().toISOString(), level, message: String(message) };
  const extra = detailText(details);
  if (extra) entry.details = extra.slice(0, 500);
  entries.push(entry);
  if (entries.length > LIMIT) entries = entries.slice(-LIMIT);
  persist();
  if (level === 'error') console.error(`[Relationship Engine] ${message}`, details ?? '');
  else if (level === 'warn') console.warn(`[Relationship Engine] ${message}`, details ?? '');
  return entry;
}

export function getLog() {
  return entries.map(entry => ({ ...entry }));
}

export function clearLog() {
  entries = [];
  persist();
}

/** Plain-text report with environment info for bug reports. */
export function formatLog(environment = {}) {
  const header = Object.entries(environment).map(([key, value]) => `${key}: ${value}`).join('\n');
  const lines = entries.map(entry => `${entry.time} [${entry.level}] ${entry.message}${entry.details ? ` — ${entry.details}` : ''}`);
  return [header, '', ...(lines.length ? lines : ['(журнал пуст)'])].join('\n').trim();
}
