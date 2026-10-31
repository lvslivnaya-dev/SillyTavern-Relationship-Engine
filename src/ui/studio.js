import {
  button, characterId, characterName, clamp, createFacade, dispatch, downloadJson, element,
  ensureContainer, formatTime, getPair, metricDefinitions, nextControlId, normalizeSnapshot, pairId, pairLabel, pairSource, pairTarget,
} from './helpers.js';
import { collectRecords, filterRecords, triangleEdges } from '../core/records.js';

const STYLE = `
:host{all:initial;--rs-bg:color-mix(in srgb,var(--SmartThemeBlurTintColor,#11151c) 94%,var(--SmartThemeBodyColor,#eef2f6) 6%);--rs-panel:color-mix(in srgb,var(--SmartThemeBlurTintColor,#191f29) 88%,var(--SmartThemeBodyColor,#eef2f6) 12%);--rs-inset:color-mix(in srgb,var(--SmartThemeChatTintColor,#171c24) 45%,var(--SmartThemeBlurTintColor,#11151c));--rs-track:color-mix(in srgb,var(--SmartThemeBodyColor,#9ca9b8) 22%,transparent);--rs-line:var(--SmartThemeBorderColor,color-mix(in srgb,var(--SmartThemeBodyColor,#eef2f6) 26%,transparent));--rs-text:var(--SmartThemeBodyColor,#eef2f6);--rs-muted:color-mix(in srgb,var(--SmartThemeBodyColor,#9ca9b8) 62%,transparent);--rs-accent:var(--SmartThemeQuoteColor,#e6ad55);--rs-danger:#e07171;--rs-backdrop:color-mix(in srgb,var(--SmartThemeShadowColor,#07090d) 80%,transparent);font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:var(--rs-text)}
*,*:before,*:after{box-sizing:border-box}.backdrop{position:fixed;inset:0;z-index:2147483000;background:var(--rs-backdrop);display:grid;place-items:center;padding:clamp(8px,2vw,28px)}.backdrop[hidden]{display:none}.studio{width:min(1480px,100%);height:min(920px,100%);background:var(--rs-bg);border:1px solid var(--rs-line);border-radius:18px;box-shadow:0 30px 90px #000b;display:grid;grid-template-columns:260px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);overflow:hidden}.header{grid-column:1/-1;min-height:72px;border-bottom:1px solid var(--rs-line);display:flex;align-items:center;gap:14px;padding:14px 18px}.brand{margin-right:auto}.brand strong{display:block;font:700 20px/1.1 Georgia,serif}.brand span,.muted{color:var(--rs-muted);font-size:12px}.sidebar{border-right:1px solid var(--rs-line);padding:16px;overflow:auto}.content{min-width:0;overflow:auto;padding:clamp(16px,3vw,34px)}button,input,select,textarea{font:inherit}.btn,.nav button,.icon{border:1px solid var(--rs-line);background:var(--rs-panel);color:var(--rs-text);border-radius:9px;min-height:40px;padding:8px 12px;cursor:pointer}.btn:hover,.nav button:hover,.nav button.active{border-color:var(--rs-accent);background:color-mix(in srgb,var(--rs-panel) 86%,var(--rs-accent))}.btn.primary{background:color-mix(in srgb,var(--rs-accent) 30%,var(--rs-panel));border-color:var(--rs-accent);color:var(--rs-text);font-weight:700}.icon{width:42px;padding:6px;font-size:20px}.nav{display:grid;gap:7px;margin-bottom:24px}.nav button{text-align:left}.section-title{font:700 11px/1.2 inherit;letter-spacing:.13em;text-transform:uppercase;color:var(--rs-muted);margin:0 0 9px}.characters{display:grid;gap:7px}.character{display:flex;align-items:center;gap:9px;padding:8px;border-radius:9px;background:var(--rs-inset)}.avatar{width:30px;height:30px;border-radius:50%;object-fit:cover;background:color-mix(in srgb,var(--rs-line) 70%,var(--rs-bg));display:grid;place-items:center;font-weight:700}.character span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.toolbar{display:flex;align-items:end;gap:12px;flex-wrap:wrap;margin-bottom:26px}.field{display:grid;gap:6px;min-width:160px}.field.grow{flex:1}.field label{font-size:12px;color:var(--rs-muted)}select,input,textarea{width:100%;color:var(--rs-text);background:color-mix(in srgb,var(--rs-inset) 70%,var(--SmartThemeChatTintColor,#0e1218));border:1px solid var(--rs-line);border-radius:8px;padding:9px}textarea{min-height:90px;resize:vertical}.hero{margin-bottom:24px}.hero h2{font:700 clamp(24px,4vw,42px)/1.1 Georgia,serif;margin:0 0 7px}.grid{display:grid;grid-template-columns:repeat(2,minmax(240px,1fr));gap:14px}.card{background:var(--rs-panel);border:1px solid var(--rs-line);border-radius:13px;padding:16px}.card h3{margin:0 0 14px;font-size:15px}.metric{display:grid;grid-template-columns:minmax(110px,1fr) minmax(150px,2fr) 58px;gap:12px;align-items:center;margin:13px 0}.metric output{text-align:right;font-variant-numeric:tabular-nums;color:var(--rs-accent);font-weight:700}input[type=range]{padding:0;accent-color:var(--rs-accent)}.stack{display:grid;gap:10px}.item{border:1px solid var(--rs-line);border-radius:10px;padding:12px;background:color-mix(in srgb,var(--rs-inset) 80%,var(--rs-bg))}.item-head{display:flex;gap:10px;justify-content:space-between;margin-bottom:6px}.item p{margin:0;white-space:pre-wrap;color:color-mix(in srgb,var(--rs-text) 85%,transparent)}.item time{color:var(--rs-muted);font-size:11px}.empty{border:1px dashed var(--rs-line);border-radius:10px;padding:28px;text-align:center;color:var(--rs-muted)}.row{display:flex;gap:9px;align-items:center;flex-wrap:wrap}.journal-row{display:grid;grid-template-columns:150px minmax(120px,1fr) 2fr;gap:13px;border-bottom:1px solid var(--rs-line);padding:12px 3px}.settings{max-width:760px}.settings .field{margin:14px 0}.danger{color:var(--rs-danger)}.status{min-height:18px;color:var(--rs-muted);font-size:12px;margin-left:auto}
@media(max-width:760px){.backdrop{padding:0}.studio{height:100dvh;border-radius:0;grid-template-columns:1fr;grid-template-rows:auto auto minmax(0,1fr)}.header{min-height:62px}.sidebar{border-right:0;border-bottom:1px solid var(--rs-line);padding:8px 12px;overflow-x:auto;-webkit-overflow-scrolling:touch}.nav{display:flex;margin:0}.nav button{white-space:nowrap;min-height:44px}.characters,.sidebar .section-title{display:none}.content{padding:16px;-webkit-overflow-scrolling:touch}.grid{grid-template-columns:1fr}.metric{grid-template-columns:90px minmax(100px,1fr) 48px}.journal-row{grid-template-columns:1fr}.header{gap:8px;padding:10px 12px}.brand span{display:none}.btn,.nav button{min-height:44px;font-size:14px}.header .btn:not(.primary){display:none}.mobile-tools{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;justify-content:flex-end}.mobile-tools .btn{display:inline-flex;min-height:36px;font-size:12px;padding:6px 10px}.mobile-tools .icon{width:36px;min-height:36px;font-size:16px}.busy-pill{max-width:100%;overflow:hidden;text-overflow:ellipsis}}
`;

const TABS = [
  ['overview', 'Обзор'], ['memories', 'Воспоминания'], ['tensions', 'Напряжения'],
  ['triangles', 'Треугольники'], ['journal', 'История'], ['lorebooks', 'Лорбуки'], ['settings', 'Настройки'],
];

export function createRelationshipStudio(options = {}) {
  const facade = createFacade(options);
  const host = element('div', { className: 'relationship-studio-host' });
  const shadow = host.attachShadow({ mode: 'open' });
  const cleanups = [];
  let snapshot = normalizeSnapshot(options.initialState || facade.read());
  let selectedPairId = options.activePairId || snapshot.activePairId || pairId(snapshot.activePair);
  let tab = options.initialTab || 'overview';
  let isOpen = false;
  let returnFocus = null;
  let recordFilter = {};
  let factorsPairId = null;
  let selectedForRemoval = new Set();
  let toolsOpen = false; // phone only: persona/pair block is collapsible
  const isPhone = () => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 760px)').matches;

  const style = element('style', { text: STYLE + `
    .relationship-card{min-width:0;overflow:hidden}.relationship-card .grid{display:flex;flex-direction:column;gap:14px}.relationship-card .card{min-width:0;width:100%;position:static;grid-area:auto}.relationship-card .metric{grid-template-columns:minmax(80px,110px) minmax(0,1fr) 42px}.relationship-card input[type=range]{min-width:0;width:100%}.item p{overflow-wrap:anywhere}.chips{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}.chips .active{border-color:var(--rs-accent)}.triangle-edges{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:12px}.header{flex-wrap:wrap}
    input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:20px;background:transparent;cursor:pointer;accent-color:var(--rs-accent)}
    input[type=range]::-webkit-slider-runnable-track{height:6px;border-radius:4px;background:var(--rs-track);border:1px solid var(--rs-line)}
    input[type=range]::-moz-range-track{height:6px;border-radius:4px;background:var(--rs-track);border:1px solid var(--rs-line)}
    input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:16px;height:16px;border-radius:50%;background:var(--rs-accent);border:2px solid var(--rs-bg);margin-top:-6px;box-shadow:0 1px 4px rgba(0,0,0,.4)}
    input[type=range]::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:var(--rs-accent);border:2px solid var(--rs-bg);box-shadow:0 1px 4px rgba(0,0,0,.4)}
    input[type=range]:focus-visible{outline:2px solid var(--rs-accent);outline-offset:2px}
    input[type=checkbox]{accent-color:var(--rs-accent)}
    .recent-context summary::-webkit-details-marker{display:none}
    .recent-context summary::before{content:'▸';display:inline-block;transition:transform .15s}
    .recent-context[open] summary::before{transform:rotate(90deg)}
    *{scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--rs-accent) 45%,var(--rs-line)) transparent}
    *::-webkit-scrollbar{width:10px;height:10px}
    *::-webkit-scrollbar-track{background:color-mix(in srgb,var(--rs-bg) 70%,transparent)}
    *::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--rs-accent) 40%,var(--rs-line));border-radius:8px;border:2px solid transparent;background-clip:content-box}
    *::-webkit-scrollbar-thumb:hover{background:var(--rs-accent);background-clip:content-box}
    *::-webkit-scrollbar-corner{background:transparent}
    input[type=text],input[type=number],input[type=file],select,textarea{background:color-mix(in srgb,var(--rs-inset) 70%,var(--rs-bg));color:var(--rs-text);border:1px solid var(--rs-line);border-radius:8px;padding:8px 10px;width:100%}
    input:focus-visible,select:focus-visible,textarea:focus-visible{border-color:var(--rs-accent);outline:none}
    @keyframes rs-spin{to{transform:rotate(360deg)}}
    .busy-pill{display:inline-flex;align-items:center;gap:8px;padding:5px 12px;border:1px solid var(--rs-accent);border-radius:999px;background:color-mix(in srgb,var(--rs-accent) 18%,var(--rs-panel));font-size:12px;font-weight:600;white-space:nowrap}
    .busy-pill[hidden]{display:none}
    .busy-pill .dot{width:12px;height:12px;border-radius:50%;border:2px solid color-mix(in srgb,var(--rs-accent) 40%,transparent);border-top-color:var(--rs-accent);animation:rs-spin .8s linear infinite;flex:0 0 auto}
    .mobile-tools{display:none}
    .sidebar-tools>summary{display:none}
    @media(max-width:760px){
      .mobile-tools{display:flex}
      /* One scroll container for the whole studio: nothing scrolls sideways,
         the tab strip stays pinned, the content gets the full screen. */
      .studio{display:flex;flex-direction:column;height:100dvh;max-height:100dvh;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
      .header{flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 12px;min-height:0}
      .header .brand{order:0;flex:1 1 calc(100% - 56px);min-width:0;margin:0}
      .header .brand strong{font-size:18px}
      .header>.icon{order:1;width:40px;min-height:40px;flex:0 0 auto}
      .header>.busy-pill{order:2;flex:1 1 100%}
      .header>.btn.primary{order:3;flex:1 1 140px;min-height:40px;padding:6px 8px;font-size:13px;white-space:normal;line-height:1.2}
      .header>.mobile-tools{order:4;flex:1 1 100%;margin:0;justify-content:flex-start}
      .header>.status{order:5;flex:1 1 100%;margin:0;min-height:0}
      .header>.status:empty{display:none}
      .sidebar{display:contents}
      .nav{position:sticky;top:0;z-index:5;display:flex;flex-wrap:nowrap;gap:6px;margin:0;padding:8px 12px;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:none;background:var(--rs-bg);border-bottom:1px solid var(--rs-line);flex:0 0 auto}
      .nav::-webkit-scrollbar{display:none}
      .nav button{flex:0 0 auto;min-height:40px;padding:6px 12px;font-size:14px}
      .sidebar-tools{flex:0 0 auto;margin:10px 12px 0;padding:0 12px;border:1px solid var(--rs-line);border-radius:10px;background:var(--rs-panel)}
      .sidebar-tools>summary{display:block;cursor:pointer;padding:11px 0;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;list-style:none}
      .sidebar-tools>summary::-webkit-details-marker{display:none}
      .sidebar-tools>summary::before{content:'▸';display:inline-block;margin-right:6px;transition:transform .15s}
      .sidebar-tools[open]>summary::before{transform:rotate(90deg)}
      .sidebar-tools[open]{padding-bottom:10px}
      .sidebar-tools .field{min-width:0}
      .content{flex:0 0 auto;overflow:visible;padding:12px;min-width:0}
      .hero{margin-bottom:12px}
      .hero h2{font-size:22px}
      .card{padding:12px;border-radius:11px}
      .relationship-cards{gap:12px!important}
      .relationship-card .card{padding:0;border:0;background:none}
      .relationship-card .card h3{font-size:13px;color:var(--rs-muted);margin:0 0 4px}
      .metric,.relationship-card .metric{grid-template-columns:minmax(84px,104px) minmax(0,1fr) 40px;gap:8px;margin:8px 0;font-size:14px}
      .metric label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .grid{grid-template-columns:minmax(0,1fr)}
      .field{min-width:0}
      .toolbar{margin-bottom:0}
      .chips{flex-wrap:nowrap;overflow-x:auto;padding-bottom:4px}
      .chips .btn{flex:0 0 auto;min-height:34px;font-size:12px;padding:4px 10px}
      .item-head{flex-wrap:wrap}
      /* vertical swipes over sliders scroll the page instead of yanking values */
      input[type=range]{touch-action:pan-y}
    }
  ` });
  const backdrop = element('div', { className: 'backdrop', hidden: true });
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', options.label || 'Студия отношений');
  const panel = element('section', { className: 'studio', tabIndex: -1 });
  backdrop.append(panel);
  shadow.append(style, backdrop);
  ensureContainer(options.container).append(host);

  function emit(name, detail) {
    dispatch(host, `relationship-studio:${name}`, detail);
  }

  function act(name, payload, eventName = name) {
    const result = facade.invoke(name, payload);
    emit(eventName, payload);
    if (result?.then) result.catch((error) => setStatus(error?.message || String(error), true));
    return result;
  }

  function setStatus(message, danger = false) {
    const status = shadow.querySelector('.status');
    if (status) {
      status.textContent = message || '';
      status.classList.toggle('danger', danger);
    }
  }

  function render() {
    const pair = getPair(snapshot, selectedPairId);
    if (pair) selectedPairId = pairId(pair);
    panel.replaceChildren(renderHeader(), renderSidebar(), renderContent(pair));
    const factorsPair = factorsPairId ? getPair(snapshot, factorsPairId) : null;
    const existing = shadow.querySelector('.factors-dialog');
    if (factorsPair && !existing) {
      const backdrop = element('div', { className: 'factors-dialog', style: {
        position: 'fixed', inset: '0', zIndex: '60', display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.45)',
      } });
      backdrop.addEventListener('click', event => { if (event.target === backdrop) { factorsPairId = null; render(); } });
      backdrop.append(renderFactorsDialog(factorsPair));
      shadow.querySelector('.studio')?.append(backdrop);
    } else if (!factorsPair && existing) existing.remove();
  }

  function renderFactorsDialog(pair) {
    const dialog = element('div', { role: 'dialog', 'aria-label': 'Факторы роста', style: {
      width: 'min(680px, 94vw)', maxHeight: '88vh', overflow: 'auto', background: 'var(--rs-bg, #141923)',
      border: '1px solid var(--rs-line, #333c4a)', borderRadius: '12px', padding: '18px',
    } });
    const factors = [...(pair.factors ?? [])];
    dialog.append(element('h3', { text: `Факторы роста: ${pairLabel(snapshot, pair)}` }));
    dialog.append(element('p', { className: 'muted', style: { fontSize: '11px' }, text: 'Что приближает или отдаляет эту связь. Факторы передаются анализатору: сцена, совпавшая с фактором, даёт изменение соответствующей шкалы в выбранную сторону.' }));

    const list = element('div');
    function renderRows() {
      list.replaceChildren();
      factors.forEach((factor, index) => {
        const scale = element('select', { 'aria-label': 'Шкала' });
        for (const definition of metricDefinitions(snapshot, pair)) scale.append(element('option', { value: definition.key, text: definition.label, selected: definition.key === factor.scaleId }));
        const direction = element('select', { 'aria-label': 'Направление' });
        direction.append(element('option', { value: 'up', text: '+ рост', selected: factor.direction === 'up' }));
        direction.append(element('option', { value: 'down', text: '− падение', selected: factor.direction === 'down' }));
        const text = element('textarea', { value: factor.text, 'aria-label': 'Условие', placeholder: 'Например: делится личными тайнами', rows: 2 });
        text.style.cssText = 'flex:1;min-width:200px;width:100%;resize:vertical;overflow-wrap:anywhere;white-space:pre-wrap;font:inherit;line-height:1.35';
        const autoGrow = () => { text.style.height = 'auto'; text.style.height = `${Math.max(44, text.scrollHeight + 4)}px`; };
        text.addEventListener('input', autoGrow);
        requestAnimationFrame(autoGrow);
        const remove = button('×', 'btn icon', () => { factors.splice(index, 1); renderRows(); }, 'Удалить фактор');
        const row = element('div', { style: { display: 'flex', gap: '6px', margin: '6px 0', alignItems: 'flex-start' } }, [
          element('div', { style: { display: 'grid', gap: '6px', flex: '0 0 auto' } }, [scale, direction]),
          element('div', { style: { flex: '1', minWidth: '0' } }, [text]),
          remove,
        ]);
        remove.style.alignSelf = 'flex-start';
        list.append(row);
      });
      if (!factors.length) list.append(element('p', { className: 'muted', text: 'Факторов пока нет.' }));
    }
    renderRows();

    const addRow = button('+ Добавить фактор', 'btn', () => {
      factors.push({ scaleId: metricDefinitions(snapshot, pair)[0]?.key ?? 'trust', direction: 'up', text: '' });
      renderRows();
    });

    const directionSelect = element('select', { 'aria-label': 'Направление развития' });
    const presets = options.directionPresets ? options.directionPresets() : [
      { id: 'romance', label: 'Романтика' }, { id: 'friendship', label: 'Дружба' },
      { id: 'rivalry', label: 'Вражда' }, { id: 'obsession', label: 'Одержимость' },
      { id: 'fear', label: 'Страх' }, { id: 'custom', label: 'Своё направление' },
    ];
    for (const preset of presets) directionSelect.append(element('option', { value: preset.id, text: preset.label }));
    const customDirection = element('input', { type: 'text', placeholder: 'Опишите желаемое направление развития', 'aria-label': 'Своё направление' });
    const generate = button('Сгенерировать по персонажу', 'btn', async () => {
      generate.disabled = true;
      setStatus('Генерирую факторы по лору и сценам…');
      try {
        await act('onGenerateFactors', {
          sourceId: pairSource(pair), targetId: pairTarget(pair),
          directionId: directionSelect.value, customDirection: customDirection.value, replace: true,
        }, 'factors-generate');
        setStatus('Факторы сгенерированы');
        factorsPairId = null;
        render();
      } finally { generate.disabled = false; }
    });
    const save = button('Сохранить', 'btn primary', async () => {
      await act('onSetFactors', {
        sourceId: pairSource(pair), targetId: pairTarget(pair),
        factors: factors.filter(factor => factor.text.trim()),
      }, 'factors-save');
      setStatus('Факторы сохранены');
      factorsPairId = null;
      render();
    });
    const close = button('Закрыть', 'btn', () => { factorsPairId = null; render(); });

    dialog.append(
      list, addRow,
      element('div', { style: { borderTop: '1px solid var(--rs-line, #333c4a)', margin: '12px 0', paddingTop: '12px' } }, [
        element('p', { className: 'muted', style: { fontSize: '11px' }, text: 'Автогенерация: учитывает лор подключённых книг и сцены с обоими персонажами. «Своё направление» — впишите текстом.' }),
        element('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, [directionSelect, customDirection, generate]),
      ]),
      element('div', { style: { display: 'flex', gap: '8px', marginTop: '14px' } }, [save, close]),
    );
    return dialog;
  }

  function renderHeader() {
    const brand = element('div', { className: 'brand' }, [
      element('strong', { text: options.title || 'Студия отношений' }),
      element('span', { text: options.subtitle || 'Чувства, воспоминания и противоречия персонажей' }),
    ]);
    const importInput = element('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    importInput.addEventListener('change', async () => {
      const file = importInput.files?.[0];
      if (!file) return;
      try {
        if (file.size > 5_000_000) throw new Error('Файл импорта больше 5 МБ.');
        const data = JSON.parse(await file.text());
        await act('onImport', { data, file }, 'import');
        setStatus('Импорт завершён');
      } catch (error) {
        setStatus(error?.message || 'Не удалось импортировать данные', true);
      } finally {
        importInput.value = '';
      }
    });
    const importButton = button('Импорт', 'btn', () => importInput.click());
    const historyButton = button('Проанализировать историю', 'btn primary', async () => {
      historyButton.disabled = true;
      try {
        await act('onAnalyzeHistory', {
          onProgress(message) { setStatus(message); },
        }, 'analyze-history');
        setStatus('История чата проанализирована');
      } catch (error) { setStatus(error?.message || 'Не удалось проанализировать историю', true); }
      finally { historyButton.disabled = false; }
    });
    const analyzeButton = button('Проверить последний ответ', 'btn primary', async () => {
      try {
        await act('onAnalyzeCurrent', {}, 'analyze-current');
        setStatus('Анализ завершён');
      } catch (error) { setStatus(error?.message || 'Не удалось проанализировать ответ', true); }
    });
    const exportButton = button('Экспорт', 'btn', async () => {
      try {
        const result = await act('onExport', { snapshot }, 'export');
        if (result !== false) downloadJson(result ?? snapshot, options.exportFilename);
        setStatus('Экспорт завершён');
      } catch (error) { setStatus(error?.message || 'Не удалось экспортировать данные', true); }
    });
    if (snapshot.modelBusy) {
      historyButton.disabled = true;
      analyzeButton.disabled = true;
    }
    const busyPill = element('span', { className: 'busy-pill', role: 'status', 'aria-live': 'polite',
      title: 'Расширение отправило запрос модели и ждёт ответа' });
    if (snapshot.modelBusy) {
      busyPill.append(element('span', { className: 'dot' }), element('span', { text: `Модель думает: ${snapshot.modelBusyLabel || 'запрос к модели…'}` }));
    } else {
      busyPill.hidden = true;
    }
    // Compact secondary toolbar: on phones the non-primary header buttons are
    // hidden by the mobile CSS, so import/export live here instead.
    const mobileTools = element('div', { className: 'mobile-tools' }, [
      importButton, exportButton,
    ]);
    return element('header', { className: 'header' }, [
      brand, busyPill, importInput, historyButton, analyzeButton, mobileTools,
      element('span', { className: 'status', role: 'status', 'aria-live': 'polite' }),
      button('×', 'icon', close, 'Закрыть Студию отношений'),
    ]);
  }

  function renderSidebar() {
    const nav = element('nav', { className: 'nav', 'aria-label': 'Разделы Студии' });
    for (const [id, label] of TABS) {
      const item = button(label, id === tab ? 'active' : '', () => { tab = id; render(); });
      item.setAttribute('aria-current', id === tab ? 'page' : 'false');
      nav.append(item);
    }
    const personaForm = element('div', { className: 'field' });
    const tavernPersonas = snapshot.tavernPersonas || [];
    const personaSelect = element('select', { 'aria-label': 'Персона SillyTavern для этого чата' });
    personaSelect.append(element('option', { value: '', text: tavernPersonas.length ? 'Выберите персону' : 'Персон в Tavern не найдено' }));
    for (const persona of tavernPersonas) personaSelect.append(element('option', {
      value: persona.avatarId,
      text: persona.lockedToChat ? `${persona.name} (привязана к чату)` : persona.name,
      selected: Boolean(snapshot.personaBoundName && persona.name.toLocaleLowerCase('ru-RU') === snapshot.personaBoundName.toLocaleLowerCase('ru-RU')),
    }));
    personaForm.append(
      element('label', { text: 'Персона SillyTavern' }),
      personaSelect,
      button('Привязать', 'btn', () => {
        if (personaSelect.value) act('onSetTavernPersona', { avatarId: personaSelect.value }, 'persona-set');
        else setStatus('Сначала выберите персону из списка', true);
      }),
      ...(snapshot.personaBoundName ? [button('Отвязать', 'btn', () => act('onSetTavernPersona', { avatarId: '' }, 'persona-clear'))] : []),
    );
    if (snapshot.personaBoundName) {
      personaForm.append(element('p', { className: 'muted', style: { fontSize: '11px' }, text: `Привязана: ${snapshot.personaBoundName}. Исходящие линии персоны скрыты.` }));
      if (snapshot.personaMismatch) personaForm.append(element('p', { className: 'muted', style: { fontSize: '11px', color: '#e6b45f' }, text: `Внимание: персона чата в Tavern — «${snapshot.chatPersonaName}», а привязана «${snapshot.personaBoundName}». Проверьте выбор.` }));
    } else if (snapshot.chatPersonaName) {
      personaForm.append(element('p', { className: 'muted', style: { fontSize: '11px' }, text: `Персона этого чата в Tavern — «${snapshot.chatPersonaName}». Нажмите «Привязать» с выбранным именем, чтобы скрыть её исходящие линии.` }));
    }
    const pairForm = element('div', { className: 'field', style: { borderTop: '1px solid var(--rs-line, #303a49)', marginTop: '12px', paddingTop: '12px' } });
    const pair = getPair(snapshot, selectedPairId);
    pairForm.append(element('p', { className: 'section-title', style: { margin: '0 0 4px' }, text: 'Редактируемая пара' }), pairToolbar(pair));
    // On phones this block collapses so the selected tab is visible right away
    // instead of being pushed below half a screen of form controls.
    const tools = element('details', { className: 'sidebar-tools' });
    tools.open = !isPhone() || toolsOpen;
    const summaryText = pair ? `Персона и пара: ${pairLabel(snapshot, pair)}` : 'Персона и редактируемая пара';
    tools.append(
      element('summary', { text: summaryText }),
      personaForm,
      pairForm,
      element('p', { className: 'muted', style: { fontSize: '11px' }, text: 'Персона выбирается из вкладки «Персоны» SillyTavern: её исходящие чувства не отслеживаются, входящие к ней — отслеживаются.' }),
    );
    tools.addEventListener('toggle', () => { if (isPhone()) toolsOpen = tools.open; });
    return element('aside', { className: 'sidebar' }, [nav, tools]);
  }

  function renderCharacterManager() {
    const box = element('div', { className: 'card' }, [element('h3', { text: 'Персонажи' })]);
    const list = element('div', { className: 'characters', style: { display: 'grid', gap: '6px' } });
    const personaId = snapshot.personaId || snapshot.ui?.personaId || '';
    const removableCharacters = (snapshot.characters || []).filter(character => characterId(character) !== personaId);
    // Drop selections that no longer exist (deleted characters, switched chats).
    selectedForRemoval = new Set([...selectedForRemoval].filter(id => removableCharacters.some(character => characterId(character) === id)));
    const rowLayout = { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', border: '1px solid var(--rs-line, #303a49)', borderRadius: '8px' };
    for (const character of snapshot.characters || []) {
      const name = characterName(character);
      const avatar = character.avatar || character.avatarUrl
        ? element('img', { className: 'avatar', src: character.avatar || character.avatarUrl, alt: '' })
        : element('span', { className: 'avatar', text: name.slice(0, 1).toUpperCase() });
      const isPersona = characterId(character) === personaId;
      const characterRow = element('div', { className: 'character', style: rowLayout, title: isPersona ? `${name} — персона этого чата` : name }, [
        avatar,
        element('span', { style: { flex: '1', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: name }),
        ...(isPersona ? [element('em', { className: 'muted', text: 'персона' })] : []),
      ]);
      if (!isPersona) {
        const checkbox = element('input', { type: 'checkbox', 'aria-label': `Выбрать ${name} для удаления` });
        checkbox.checked = selectedForRemoval.has(characterId(character));
        checkbox.style.cssText = 'flex:0 0 auto;width:14px;height:14px;accent-color:var(--rs-accent,#e6ad55);margin:0';
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selectedForRemoval.add(characterId(character));
          else selectedForRemoval.delete(characterId(character));
          bulkRemoveButton.disabled = selectedForRemoval.size === 0;
          selectAllButton.textContent = selectedForRemoval.size === removableCharacters.length && removableCharacters.length
            ? 'Снять всех' : 'Выбрать всех';
        });
        characterRow.append(checkbox);
        const removeButton = button('×', 'btn icon', () => act('onRemoveCharacter', { characterId: characterId(character) }, 'character-remove'), `Удалить персонажа ${name}`);
        removeButton.style.cssText = 'flex:0 0 26px;width:26px;height:26px;min-height:26px;padding:0;font-size:13px;line-height:1;border-radius:6px;display:grid;place-items:center';
        characterRow.append(removeButton);
      } else {
        characterRow.append(element('span', { style: { flex: '0 0 26px', width: '26px' }, text: '' }));
      }
      list.append(characterRow);
    }
    const bulkBar = element('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '10px 0 0' } });
    const allSelected = removableCharacters.length > 0 && selectedForRemoval.size === removableCharacters.length;
    const selectAllButton = button(allSelected ? 'Снять всех' : 'Выбрать всех', 'btn', () => {
      if (selectedForRemoval.size === removableCharacters.length && removableCharacters.length) selectedForRemoval.clear();
      else selectedForRemoval = new Set(removableCharacters.map(character => characterId(character)));
      render();
    });
    selectAllButton.style.cssText = 'min-height:30px;padding:4px 10px;font-size:12px';
    const bulkRemoveButton = button('Удалить выбранных', 'btn', () => {
      if (!selectedForRemoval.size) return;
      act('onRemoveCharactersBulk', { characterIds: [...selectedForRemoval] }, 'characters-bulk-remove');
    });
    bulkRemoveButton.disabled = selectedForRemoval.size === 0;
    bulkRemoveButton.style.cssText = 'min-height:30px;padding:4px 10px;font-size:12px';
    if (removableCharacters.length) bulkBar.append(selectAllButton, bulkRemoveButton);
    else bulkBar.append(element('p', { className: 'muted', style: { fontSize: '11px', margin: '0' }, text: 'Нет персонажей для удаления.' }));
    const addForm = element('form', { className: 'field', style: { marginTop: '12px' } });
    const addInput = element('input', { type: 'text', placeholder: 'Имя персонажа', 'aria-label': 'Имя нового персонажа', required: true });
    const aliasInput = element('input', { type: 'text', placeholder: 'Псевдонимы через запятую', 'aria-label': 'Псевдонимы персонажа' });
    const addButton = button('Добавить персонажа', 'btn', () => {});
    addButton.type = 'submit';
    addForm.append(addInput, aliasInput, addButton);
    addForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = addInput.value.trim();
      if (!name) return;
      const aliases = aliasInput.value.split(',').map(value => value.trim()).filter(Boolean);
      await act('onAddCharacter', { name, aliases }, 'character-add');
      addInput.value = '';
      aliasInput.value = '';
    });
    box.append(list, bulkBar, addForm);
    return box;
  }

  function pairToolbar(pair) {
    const personaId = snapshot.personaId || snapshot.ui?.personaId || '';
    const characters = snapshot.characters || [];
    const sourceCharacters = characters.filter(character => characterId(character) !== personaId);
    const currentPair = getPair(snapshot, selectedPairId);
    const sourceSelect = characterSelect('Кто испытывает', currentPair ? pairSource(currentPair) : '', sourceCharacters);
    const targetSelect = characterSelect('К кому', currentPair ? pairTarget(currentPair) : '', characters);
    const apply = () => {
      if (!sourceSelect.select.value || !targetSelect.select.value || sourceSelect.select.value === targetSelect.select.value) return;
      const found = (snapshot.pairs || []).find((candidate) => pairSource(candidate) === sourceSelect.select.value && pairTarget(candidate) === targetSelect.select.value);
      selectedPairId = found ? pairId(found) : `${sourceSelect.select.value}->${targetSelect.select.value}`;
      act('onSelectPair', { pairId: selectedPairId, sourceId: sourceSelect.select.value, targetId: targetSelect.select.value }, 'pair-select');
      render();
    };
    sourceSelect.select.addEventListener('change', apply);
    targetSelect.select.addEventListener('change', apply);
    return element('div', { className: 'toolbar', style: { display: 'grid', gap: '8px' } }, [sourceSelect.field, targetSelect.field]);
  }

  function characterSelect(label, value, characters) {
    const select = element('select', { id: nextControlId('rs-character'), 'aria-label': label });
    select.append(element('option', { value: '', text: 'Выберите персонажа' }));
    for (const character of characters) select.append(element('option', {
      value: characterId(character), text: characterName(character), selected: characterId(character) === value,
    }));
    return { select, field: element('div', { className: 'field' }, [element('label', { text: label, htmlFor: select.id }), select]) };
  }

  function renderContent(pair) {
    const content = element('main', { className: 'content' });
    const hero = element('div', { className: 'hero' }, [
      element('p', { className: 'section-title', text: TABS.find(([id]) => id === tab)?.[1] || tab }),
      element('h2', { text: tab === 'overview' ? 'Все отношения' : tab === 'lorebooks' ? 'Подключённые лорбуки' : tab === 'journal' ? 'История изменений' : tab === 'settings' ? 'Настройки' : pairLabel(snapshot, pair) }),
      ...(tab === 'overview' ? [element('span', { className: 'muted', text: 'Направление важно: обратная связь редактируется отдельно.' })] : []),
    ]);
    content.append(hero);
    if (!pair && !['overview', 'journal', 'settings', 'lorebooks', 'memories', 'tensions', 'triangles'].includes(tab)) {
      content.append(element('div', { className: 'empty', text: 'Для начала выберите двух разных персонажей.' }));
      return content;
    }
    const view = tab === 'overview' ? renderAllRelationships()
      : tab === 'memories' ? renderCollection(pair, 'memories')
        : tab === 'tensions' ? renderCollection(pair, 'tensions')
          : tab === 'journal' ? renderJournal()
            : tab === 'lorebooks' ? renderLorebooks()
              : tab === 'triangles' ? renderTriangles()
            : renderSettings();
    content.append(view);
    return content;
  }

  function renderAllRelationships() {
    const container = element('div', { style: { display: 'grid', gap: '16px' } });
    container.append(renderCharacterManager());
    const grid = element('div', { className: 'relationship-cards', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,350px),1fr))', gap: '16px' } });
    for (const pair of snapshot.pairs || []) {
      const hiddenFromWidget = (snapshot.ui?.hiddenRelationshipIds ?? []).includes(pairId(pair));
      const card = element('article', { className: 'card relationship-card' }, [
        element('h3', { text: pairLabel(snapshot, pair) }),
        renderOverview(pair),
        element('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--rs-line, #303a49)' } }, [
          button('Факторы роста', 'btn', () => { factorsPairId = pairId(pair); render(); }),
          button(hiddenFromWidget ? 'Показать в виджете' : 'Скрыть из виджета', 'btn', () => act('onToggleWidgetPair', { relationshipId: pairId(pair) }, 'widget-pair-toggle')),
          button('Удалить линию', 'btn', () => act('onRemovePair', {
            sourceId: pairSource(pair), targetId: pairTarget(pair),
          }, 'pair-remove')),
        ]),
      ]);
      grid.append(card);
    }
    if (!snapshot.pairs?.length) grid.append(element('p', { className: 'empty', text: 'Пока нет связей: выберите пару в левой панели или запустите анализ истории.' }));
    container.append(grid);
    return container;
  }

  function renderLorebooks() {
    const lorebooks = snapshot.lorebooks || {};
    const card = element('div', { className: 'card' }, [element('h3', { text: 'Лорбуки текущего чата' }), element('p', { text: lorebooks.status || '' })]);
    const select = element('select', { 'aria-label': 'Доступные лорбуки', style: { flex: '1', minWidth: '160px' } });
    select.append(element('option', { value: '', text: 'Выберите книгу' }));
    for (const name of lorebooks.available || []) if (!(lorebooks.selected || []).includes(name)) select.append(element('option', { value: name, text: name }));
    const lorebookSearchButton = button('Найти персонажей в лорбуках', 'btn', () => act('onAnalyzeLorebooks', {}, 'lorebooks-analyze'));
    if (snapshot.modelBusy) lorebookSearchButton.disabled = true;
    const actions = element('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '12px 0' } }, [
      button('Подключить', 'btn primary', () => { if (select.value) act('onLinkLorebook', { name: select.value }); }),
      button('Обновить список', 'btn', () => act('onRefreshLorebooks', {})),
      lorebookSearchButton,
    ]);
    card.append(element('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } }, [select]), actions);
    for (const name of lorebooks.selected || []) {
      const row = element('div', { className: 'item', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', margin: '8px 0' } }, [
        element('strong', { text: name }),
      ]);
      const unlink = button('×', 'btn icon', () => act('onUnlinkLorebook', { name }), `Отвязать ${name}`);
      unlink.style.cssText = 'flex:0 0 auto;width:26px;height:26px;min-height:26px;padding:0;font-size:13px;line-height:1;border-radius:6px';
      row.append(unlink);
      card.append(row);
    }
    return card;
  }

  function renderOverview(pair) {
    const metrics = element('div', { className: 'card' }, [element('h3', { text: 'Показатели отношений' })]);
    const values = pair.metrics || pair.scales || {};
    for (const definition of metricDefinitions(snapshot, pair)) {
      const value = Number(values[definition.key] ?? definition.default ?? 0);
      const range = element('input', { id: nextControlId('rs-metric'), type: 'range', min: definition.min, max: definition.max, step: definition.step || 1, value });
      const output = element('output', { text: value });
      range.addEventListener('input', () => { output.textContent = range.value; });
      range.addEventListener('change', () => act('onMetricChange', {
        pairId: pairId(pair), sourceId: pairSource(pair), targetId: pairTarget(pair), metric: definition.key,
        value: clamp(range.value, Number(definition.min), Number(definition.max)), previousValue: value,
      }, 'metric-change'));
      metrics.append(element('div', { className: 'metric' }, [element('label', { text: definition.label, htmlFor: range.id }), range, output]));
    }
    return element('div', { className: 'grid' }, [metrics]);
  }

  function renderCollection(pair, type) {
    const singular = type === 'memories' ? 'воспоминание' : 'напряжение';
    const form = element('form', { className: 'card' });
    const text = element('textarea', { placeholder: `Опишите ${singular}…`, required: true, 'aria-label': `Текст: ${singular}` });
    const intensity = element('input', { id: nextControlId('rs-intensity'), type: 'range', min: 1, max: 5, value: 3, 'aria-label': 'Интенсивность' });
    const submit = button(`Добавить: ${singular}`, 'btn primary', () => {});
    const makeRoster = (legendText) => {
      const box = element('div', { style: { border: '1px solid var(--rs-line, #303a49)', borderRadius: '8px', padding: '8px 10px', margin: '10px 0' } });
      box.append(element('p', { className: 'muted', style: { fontSize: '11px', margin: '0 0 6px' }, text: legendText }));
      const list = element('div', { style: { maxHeight: '150px', overflowY: 'auto', display: 'grid', gap: '4px', paddingRight: '4px' } });
      for (const character of snapshot.characters || []) {
        const input = element('input', { type: 'checkbox', value: characterId(character) });
        input.style.cssText = 'width:14px;height:14px;flex:0 0 auto;accent-color:var(--rs-accent,#e6ad55);margin:0';
        list.append(element('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', margin: '0', cursor: 'pointer', padding: '2px 0' } }, [input, characterName(character)]));
      }
      box.append(list);
      return { box, list };
    };
    const participants = makeRoster('Участники записи (никто не выбран — общая для чата)');
    const knownBy = makeRoster('Кому известно (пусто — только участникам; остальные не должны упоминать это)');
    participants.list.addEventListener('change', () => {
      const selected = [...participants.list.querySelectorAll('input:checked')].map(input => input.value);
      for (const input of knownBy.list.querySelectorAll('input')) {
        if (selected.includes(input.value)) { input.checked = true; input.disabled = true; }
        else { input.disabled = false; }
      }
    });
    submit.type = 'submit';
    const intensityRow = element('div', { className: 'metric' }, [
      element('label', { text: 'Интенсивность', htmlFor: intensity.id }), intensity, element('output', { text: '3' }),
    ]);
    intensityRow.append(element('p', { className: 'muted', style: { fontSize: '11px', margin: '2px 0 0', gridColumn: '1 / -1' }, text: '1 — фон, почти не влияет; 3 — заметно; 5 — определяет поведение' }));
    form.append(element('h3', { text: `Новое ${singular}` }), text, participants.box, knownBy.box, intensityRow, submit);
    intensity.addEventListener('input', () => { intensity.nextElementSibling.textContent = intensity.value; });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!text.value.trim()) return;
      act(type === 'memories' ? 'onAddMemory' : 'onAddTension', {
        participantIds: [...participants.list.querySelectorAll('input:checked')].map(input => input.value),
        knownBy: [...knownBy.list.querySelectorAll('input:checked')].map(input => input.value),
        text: text.value.trim(), intensity: Number(intensity.value),
      }, type === 'memories' ? 'memory-add' : 'tension-add');
      text.value = '';
    });
    const chips = element('div', { className: 'chips' });
    const chip = (label, filter, active) => chips.append(button(label, `btn${active ? ' active' : ''}`, () => { recordFilter = filter; render(); }));
    chip('Все', {}, !recordFilter.characterId && !recordFilter.relationshipId);
    for (const character of snapshot.characters || []) chip(characterName(character), { characterId: characterId(character) }, recordFilter.characterId === characterId(character));
    for (const relation of snapshot.pairs || []) chip(pairLabel(snapshot, relation), { relationshipId: pairId(relation), pairIds: [pairSource(relation), pairTarget(relation)] }, recordFilter.relationshipId === pairId(relation));
    const records = filterRecords(collectRecords(snapshot, type), recordFilter);
    const list = element('div', { className: 'card' }, [element('h3', { text: type === 'memories' ? 'Воспоминания' : 'Активные напряжения' }), chips, renderRecords(records, type)]);
    return element('div', { className: 'grid' }, [form, list]);
  }

  function renderRecords(items, type) {
    if (!items.length) return element('div', { className: 'empty', text: 'Здесь пока ничего нет.' });
    const stack = element('div', { className: 'stack' });
    for (const item of items) {
      const article = element('article', { className: 'item', style: item.disabled ? 'opacity:.45' : '' }, [
        ...(Array.isArray(item.participantIds) ? [element('p', { className: 'muted', text: item.participantIds.length ? item.participantIds.map(id => characterName(snapshot.characters.find(character => characterId(character) === id), id)).join(', ') : 'Общее для чата' })] : []),
        ...((item.knownBy ?? []).length !== (item.participantIds ?? []).length || (item.knownBy ?? []).some(id => !(item.participantIds ?? []).includes(id))
          ? [element('p', { className: 'muted', text: `Известно только: ${(item.knownBy ?? []).map(id => characterName(snapshot.characters.find(character => characterId(character) === id), id)).join(', ')}` })] : []),
        element('div', { className: 'item-head' }, [
          element('strong', { text: `${item.disabled ? '⏻ откл. · ' : ''}${item.title || (item.intensity ? `Интенсивность: ${item.intensity}/5` : 'Запись')}` }),
          element('time', { text: formatTime(item.timestamp || item.createdAt || item.date) }),
        ]),
        element('p', { text: item.text || item.description || item.content || String(item) }),
      ]);
      const controls = element('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } }, [
        button(item.disabled ? 'Включить' : 'Отключить', 'btn', () => act('onToggleRecord', {
          kind: type === 'memories' ? 'memory' : 'tension', shared: !item.relationshipId,
          relationshipId: item.relationshipId ?? undefined, itemId: item.id, disabled: !item.disabled,
        }, 'record-toggle'), item.disabled ? 'Включить запись' : 'Отключить запись: не попадёт в промпт'),
        button('Удалить', 'btn', () => act('onRemoveRecord', {
          kind: type === 'memories' ? 'memory' : 'tension', shared: !item.relationshipId,
          relationshipId: item.relationshipId ?? undefined, itemId: item.id,
        }, 'record-remove'), 'Удалить запись'),
      ]);
      for (const control of controls.children) control.style.cssText += ';min-height:28px;padding:3px 8px;font-size:12px';
      article.append(controls);
      stack.append(article);
    }
    return stack;
  }

  function renderItems(items) {
    if (!items.length) return element('div', { className: 'empty', text: 'Здесь пока ничего нет.' });
    const stack = element('div', { className: 'stack' });
    for (const item of items) {
      stack.append(element('article', { className: 'item' }, [
        ...(Array.isArray(item.participantIds) ? [element('p', { className: 'muted', text: item.participantIds.length ? item.participantIds.map(id => characterName(snapshot.characters.find(character => characterId(character) === id), id)).join(', ') : 'Общее для чата' })] : []),
        ...((item.knownBy ?? []).length !== (item.participantIds ?? []).length || (item.knownBy ?? []).some(id => !(item.participantIds ?? []).includes(id))
          ? [element('p', { className: 'muted', text: `Известно только: ${(item.knownBy ?? []).map(id => characterName(snapshot.characters.find(character => characterId(character) === id), id)).join(', ')}` })] : []),
        element('div', { className: 'item-head' }, [
          element('strong', { text: item.title || (item.intensity ? `Интенсивность: ${item.intensity}/5` : 'Запись') }),
          element('time', { text: formatTime(item.timestamp || item.createdAt || item.date) }),
        ]),
        element('p', { text: item.text || item.description || item.content || String(item) }),
      ]));
    }
    return stack;
  }

  function renderTriangles() {
    const container = element('div');
    const form = element('form', { className: 'card' });
    const name = element('input', { placeholder: 'Название треугольника', 'aria-label': 'Название треугольника' });
    const center = characterSelect('Центр (персонаж 2)', '', snapshot.characters);
    const first = characterSelect('Персонаж 1', '', snapshot.characters);
    const second = characterSelect('Персонаж 3', '', snapshot.characters);
    const submit = button('Создать треугольник', 'btn primary', () => {}); submit.type = 'submit';
    submit.style.cssText = 'margin-top:12px';
    form.append(name, center.field, first.field, second.field, submit);
    form.addEventListener('submit', event => {
      event.preventDefault();
      try {
        triangleEdges(center.select.value, first.select.value, second.select.value);
        act('onAddTriangle', { name: name.value, centerId: center.select.value, firstId: first.select.value, secondId: second.select.value });
      } catch (error) { setStatus(error.message, true); }
    });
    container.append(form);
    for (const triangle of snapshot.ui?.triangles || []) {
      const group = element('section', { className: 'card triangle-group' }, [element('h3', { text: triangle.name }), button('Удалить группу', 'btn', () => act('onRemoveTriangle', { id: triangle.id }))]);
      const edges = element('div', { className: 'triangle-edges' });
      for (const [a, b] of triangleEdges(triangle.centerId, triangle.firstId, triangle.secondId)) {
        const label = `${characterName(snapshot.characters.find(c => characterId(c) === a), a)} ↔ ${characterName(snapshot.characters.find(c => characterId(c) === b), b)}`;
        const card = element('article', { className: 'relationship-card card' }, [element('h3', { text: label })]);
        for (const [from, to] of [[a, b], [b, a]]) {
          const relation = snapshot.pairs.find(item => pairSource(item) === from && pairTarget(item) === to);
          if (!relation) continue;
          const details = element('details', { open: from === a });
          details.append(element('summary', { text: pairLabel(snapshot, relation) }), renderOverview(relation));
          card.append(details);
        }
        edges.append(card);
      }
      group.append(edges); container.append(group);
    }
    return container;
  }

  function renderJournal() {
    const card = element('div', { className: 'card' }, [element('h3', { text: 'История изменений' })]);
    const entries = snapshot.journal || snapshot.history || [];
    if (!entries.length) card.append(element('div', { className: 'empty', text: 'Изменений отношений пока нет.' }));
    for (const entry of entries) {
      const row = element('div', { className: 'journal-row', style: { padding: '8px 0', borderBottom: '1px solid var(--rs-line, #303a49)' } }, [
        element('time', { text: formatTime(entry.timestamp || entry.createdAt) }),
        element('strong', { text: entry.label || entry.type || 'Изменение' }),
        element('span', { text: entry.description || entry.reason || entry.text || `${entry.metric || ''} ${entry.delta > 0 ? '+' : ''}${entry.delta ?? ''}`.trim() }),
      ]);
      card.append(row);
    }
    return card;
  }

  function renderSettings() {
    const current = snapshot.settings || {};
    const form = element('form', { className: 'card settings' }, [element('h3', { text: 'Настройки движка' })]);
    const fields = options.settingsFields || [
      { key: 'autoTrack', label: 'Автоматически отслеживать изменения отношений', type: 'checkbox' },
      { key: 'journalLimit', label: 'Максимум записей в истории', type: 'number', min: 10, max: 5000 },
      { key: 'widgetEnabled', label: 'Показывать компактный виджет', type: 'checkbox' },
    ];
    for (const definition of fields) {
      const input = element('input', {
        id: nextControlId('rs-setting'), type: definition.type || 'text', name: definition.key, min: definition.min, max: definition.max,
        checked: definition.type === 'checkbox' ? Boolean(current[definition.key]) : undefined,
        value: definition.type === 'checkbox' ? undefined : current[definition.key] ?? definition.default ?? '',
      });
      form.append(element('div', { className: 'field' }, [element('label', { text: definition.label, htmlFor: input.id }), input]));
    }
    const save = button('Сохранить настройки', 'btn primary', () => {});
    save.type = 'submit';
    form.append(save);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const settings = {};
      for (const definition of fields) {
        const input = form.elements[definition.key];
        settings[definition.key] = definition.type === 'checkbox' ? input.checked
          : definition.type === 'number' ? Number(input.value) : input.value;
      }
      act('onSettingsChange', { settings }, 'settings-change');
      setStatus('Настройки сохранены');
    });
    const preview = element('div', { className: 'card', style: { marginTop: '14px' } }, [element('h3', { text: 'Что получает модель' })]);
    preview.append(element('p', { className: 'muted', style: { fontSize: '11px' }, text: `Инъекция Narrator: ~${snapshot.promptTokens ?? 0} токенов. Анализ за сессию израсходовал ~${snapshot.analysisTokens ?? 0} токенов (запросы + ответы, включая размышления, если модель их возвращает). Пусто — проверьте, что связь не исключена персоной и значения не нулевые.` }));
    const previewText = element('pre', {
      style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: '0', maxHeight: '220px', overflow: 'auto', fontSize: '11px' },
      text: snapshot.promptPreview || '—',
    });
    preview.append(previewText);
    const wrapper = element('div');
    wrapper.append(form, preview);
    return wrapper;
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    backdrop.hidden = false;
    document.documentElement.classList.add('relationship-studio-open');
    render();
    requestAnimationFrame(() => panel.focus());
    emit('open', { pairId: selectedPairId });
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    backdrop.hidden = true;
    document.documentElement.classList.remove('relationship-studio-open');
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
    emit('close', {});
  }

  function onKeyDown(event) {
    if (!isOpen) return;
    if (event.key === 'Escape') close();
    if (event.key === 'Tab') {
      const focusable = [...shadow.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((node) => !node.disabled && !node.hidden);
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable.at(-1);
      if (event.shiftKey && shadow.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && shadow.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }

  document.addEventListener('keydown', onKeyDown);
  cleanups.push(() => document.removeEventListener('keydown', onKeyDown));
  // Re-render when crossing the phone breakpoint (rotation, split screen), so
  // the collapsible persona/pair block is never left closed on a wide layout.
  const phoneQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 760px)') : null;
  const onLayoutChange = () => { if (isOpen) render(); };
  phoneQuery?.addEventListener?.('change', onLayoutChange);
  cleanups.push(() => phoneQuery?.removeEventListener?.('change', onLayoutChange));
  backdrop.addEventListener('pointerdown', (event) => { if (event.target === backdrop && options.closeOnBackdrop !== false) close(); });
  cleanups.push(facade.subscribe((value) => { snapshot = value; if (isOpen) render(); }));
  render();
  if (options.open !== false) open();

  return {
    element: host,
    open,
    close,
    toggle: () => isOpen ? close() : open(),
    update(value) { snapshot = normalizeSnapshot(value || facade.read()); facade.setLocal(snapshot); if (isOpen) render(); },
    selectPair(value) { selectedPairId = typeof value === 'string' ? value : pairId(value); if (isOpen) render(); },
    destroy() { close(); cleanups.splice(0).forEach((cleanup) => cleanup()); host.remove(); emit('destroy', {}); },
  };
}

export default createRelationshipStudio;
