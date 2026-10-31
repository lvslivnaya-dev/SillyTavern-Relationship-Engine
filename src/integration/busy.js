/**
 * A tiny reference-counted "the model is thinking" signal.
 *
 * Only actual quiet generation requests mark busy — never popups or the wait
 * for user confirmation — so the indicator truthfully reflects a live request
 * to the language model, whatever triggered it (a button or auto analysis).
 */
let count = 0;
let label = null;
const listeners = new Set();

function emit() {
  for (const listener of listeners) {
    try { listener(getBusy()); }
    catch (error) { console.error('[Relationship Engine] Busy listener failed.', error); }
  }
}

export function onChangeBusy(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getBusy() {
  return { busy: count > 0, label };
}

/** Update the visible label while a request is in flight. */
export function setBusyLabel(next) {
  if (next === label) return;
  label = next;
  emit();
}

export async function withBusy(busyLabel, task) {
  count += 1;
  if (busyLabel) label = busyLabel;
  emit();
  try { return await task(); }
  finally {
    count = Math.max(0, count - 1);
    if (!count) label = null;
    emit();
  }
}

export function resetBusy() {
  count = 0;
  label = null;
  emit();
}
