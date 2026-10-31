const SHELL_ID = 're-extension-settings';
const MENU_ID = 're-menu-entry';

export function mountExtensionShell({ settings, onOpenStudio, onSettingsChanged, conflicts = [] }) {
  document.getElementById(SHELL_ID)?.remove();
  document.getElementById(MENU_ID)?.remove();

  const menu = document.createElement('div');
  menu.id = MENU_ID;
  menu.className = 'list-group-item flex-container flexGap5 interactable';
  menu.tabIndex = 0;
  menu.setAttribute('role', 'button');
  menu.innerHTML = '<i class="fa-solid fa-people-arrows"></i><span>Движок отношений</span>';
  menu.addEventListener('click', onOpenStudio);
  menu.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') onOpenStudio();
  });
  document.querySelector('#extensionsMenu')?.append(menu);

  const root = document.createElement('div');
  root.id = SHELL_ID;
  root.innerHTML = `
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>Движок отношений</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
      <div class="inline-drawer-content">
        <label class="checkbox_label"><input type="checkbox" data-setting="enabled"><span>Включить движок</span></label>
        <label class="checkbox_label"><input type="checkbox" data-setting="injectPrompt"><span>Учитывать отношения при генерации ответа</span></label>
        <label class="checkbox_label"><input type="checkbox" data-setting="autoAnalyze"><span>Автоматически анализировать новые ответы</span></label>
        <label class="checkbox_label"><input type="checkbox" data-setting="widget.visible"><span>Показывать компактный виджет</span></label>
        <label class="re-label"><span>Порог подтверждения крупных изменений</span><input class="text_pole" type="number" min="1" max="25" data-setting="largeChangeThreshold"></label>
        <button type="button" class="menu_button" data-action="open-studio"><i class="fa-solid fa-up-right-from-square"></i> Открыть Студию отношений</button>
        <div data-conflicts></div>
      </div>
    </div>`;

  root.querySelectorAll('[data-setting]').forEach(input => {
    const path = input.dataset.setting.split('.');
    const current = getNested(settings, path);
    if (input.type === 'checkbox') input.checked = Boolean(current);
    else input.value = current ?? '';
    input.addEventListener('change', () => {
      const value = input.type === 'checkbox' ? input.checked : Number(input.value);
      setNested(settings, path, value);
      onSettingsChanged(settings);
    });
  });
  root.querySelector('[data-action="open-studio"]')?.addEventListener('click', onOpenStudio);
  const warningHost = root.querySelector('[data-conflicts]');
  for (const conflict of conflicts) {
    const warning = document.createElement('div');
    warning.className = 're-warning';
    warning.textContent = conflict.message;
    warningHost.append(warning);
  }
  (document.querySelector('#extensions_settings2') ?? document.querySelector('#extensions_settings'))?.append(root);

  return () => {
    root.remove();
    menu.remove();
  };
}

function getNested(object, path) {
  return path.reduce((value, key) => value?.[key], object);
}

function setNested(object, path, value) {
  const last = path.at(-1);
  const parent = path.slice(0, -1).reduce((current, key) => current[key] ??= {}, object);
  parent[last] = value;
}
