const EXPORT_KIND = 'sillytavern-relationship-engine';

export function downloadState(state, filename = 'relationship-engine-state.json') {
  try {
    const payload = {
      kind: EXPORT_KIND,
      exportedAt: new Date().toISOString(),
      state,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch (error) {
    console.error('[Relationship Engine] Export failed.', error);
    throw error;
  }
}

export async function readStateFile(file, validateState) {
  if (!(file instanceof File)) throw new TypeError('Выберите JSON-файл для импорта.');
  if (file.size > 5_000_000) throw new Error('Файл импорта больше 5 МБ.');
  try {
    const parsed = JSON.parse(await file.text());
    const state = parsed?.kind === EXPORT_KIND ? parsed.state : parsed;
    return validateState(structuredClone(state));
  } catch (error) {
    console.error('[Relationship Engine] Import failed.', error);
    throw new Error(`Не удалось импортировать состояние отношений: ${error?.message ?? error}`);
  }
}
