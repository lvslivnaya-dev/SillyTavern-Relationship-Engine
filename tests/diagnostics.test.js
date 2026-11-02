import test from 'node:test';
import assert from 'node:assert/strict';
import { clearLog, formatLog, getLog, logEvent } from '../src/integration/diagnostics.js';

test('diagnostics log keeps the newest entries and formats a copyable report', () => {
  clearLog();
  for (let index = 0; index < 160; index += 1) logEvent('info', `событие ${index}`);
  const entries = getLog();
  assert.equal(entries.length, 150);
  assert.equal(entries[0].message, 'событие 10');
  assert.equal(entries.at(-1).message, 'событие 159');

  clearLog();
  const originalError = console.error;
  console.error = () => {};
  try { logEvent('error', 'Сохранение не удалось', new Error('quota')); }
  finally { console.error = originalError; }
  const report = formatLog({ 'Автоанализ': 'вкл' });
  assert.match(report, /^Автоанализ: вкл/);
  assert.match(report, /\[error\] Сохранение не удалось — quota/);
});

test('diagnostics report says the log is empty after clearing', () => {
  clearLog();
  assert.match(formatLog(), /журнал пуст/);
});
