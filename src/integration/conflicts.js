export function detectConflicts(context) {
  const disabled = new Set(context.extensionSettings?.disabledExtensions ?? []);
  const candidates = ['love-score', 'third-party/love-score'];
  const manifest = context.getExtensionManifest?.('love-score');
  if (!manifest || candidates.some(name => disabled.has(name))) return [];
  return [{
    id: 'love-score',
    title: 'Возможно, Love Score всё ещё включён',
    message: 'Два движка отношений могут давать модели противоречивые инструкции. Отключите Love Score, пока используется Движок отношений.',
  }];
}
