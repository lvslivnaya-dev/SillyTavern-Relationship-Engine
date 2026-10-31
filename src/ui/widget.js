import {
  button, clamp, createFacade, dispatch, element, ensureContainer, formatTime, getPair,
  metricDefinitions, normalizeSnapshot, pairId, pairLabel, pairTarget,
} from './helpers.js';

const STYLE = `
:host{all:initial;--rw-text:var(--SmartThemeBodyColor,#f5f7fa);--rw-bg:color-mix(in srgb,var(--SmartThemeBlurTintColor,#151b24) 93%,var(--SmartThemeBodyColor,#f5f7fa) 7%);--rw-line:var(--SmartThemeBorderColor,color-mix(in srgb,var(--SmartThemeBodyColor,#f5f7fa) 28%,transparent));--rw-muted:color-mix(in srgb,var(--SmartThemeBodyColor,#9da9b8) 62%,transparent);--rw-accent:var(--SmartThemeQuoteColor,#e6ad55);--rw-inset:color-mix(in srgb,var(--SmartThemeChatTintColor,#0e131a) 45%,var(--rw-bg));font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:var(--rw-text)}.widget{position:fixed;z-index:2147482990;width:min(330px,calc(100vw - 16px));border:1px solid var(--rw-line);border-radius:14px;background:var(--rw-bg);box-shadow:0 18px 55px #0009;backdrop-filter:blur(16px);touch-action:none;overflow:hidden}.widget.fab{width:46px;height:46px;border-radius:12px;display:grid;place-items:center;cursor:grab;user-select:none}.widget.fab .fab-icon{width:100%;height:100%;display:grid;place-items:center;font:700 22px/1 inherit;color:var(--rw-accent);border-radius:inherit;touch-action:none}.widget.fab .fab-badge{position:absolute;top:-5px;right:-5px;min-width:18px;height:18px;border-radius:9px;background:var(--rw-accent);color:var(--rw-bg);font:700 11px/18px inherit;text-align:center;padding:0 4px;box-shadow:0 2px 6px #0008;pointer-events:none}.bar{height:48px;display:flex;align-items:center;gap:8px;padding:7px 8px 7px 13px;cursor:grab;user-select:none;touch-action:none}.bar.dragging{cursor:grabbing}.identity{min-width:0;flex:1}.identity strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.identity span{display:block;color:var(--rw-muted);font-size:10px}.icon{width:34px;height:34px;border:1px solid var(--rw-line);border-radius:9px;background:color-mix(in srgb,var(--rw-bg) 85%,var(--rw-text) 8%);color:var(--rw-text);font:700 18px/1 inherit;cursor:pointer}.body{border-top:1px solid var(--rw-line);padding:12px}.body[hidden]{display:none}.metrics{display:grid;gap:8px}.metric{display:grid;grid-template-columns:minmax(70px,1fr) 2fr 38px;gap:8px;align-items:center;font-size:11px}.track{height:6px;background:color-mix(in srgb,var(--rw-text) 18%,transparent);border-radius:99px;overflow:hidden}.fill{height:100%;background:linear-gradient(90deg,color-mix(in srgb,var(--rw-accent) 55%,#b66a59),var(--rw-accent),color-mix(in srgb,var(--rw-accent) 45%,#77b29a));border-radius:inherit}.metric output{text-align:right;color:var(--rw-accent);font-weight:700}.change{margin:12px 0;padding:9px;border-radius:9px;background:var(--rw-inset);font-size:12px;line-height:1.45}.change strong{display:block;margin-bottom:2px;font-size:11px;color:var(--rw-muted)}.actions{margin-top:12px}.open{width:100%;min-height:44px;border:1px solid var(--rw-accent);border-radius:9px;background:color-mix(in srgb,var(--rw-accent) 30%,var(--rw-bg));color:var(--rw-text);font-weight:700;cursor:pointer;font-size:14px;padding:8px}
`;
const LIST_STYLE = `.body{max-height:min(65vh,600px);overflow-y:auto;touch-action:pan-y;overscroll-behavior:contain}.relation{margin:0 0 12px;padding:10px;border:1px solid var(--rw-line);border-radius:9px}.relation summary{cursor:pointer;font-weight:700;font-size:12px;margin-bottom:9px}.relation .change{margin-bottom:0}.count{color:var(--rw-muted);font-size:11px;margin:0 0 10px}
input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:18px;background:transparent;cursor:pointer;accent-color:var(--rw-accent)}
input[type=range]::-webkit-slider-runnable-track{height:6px;border-radius:4px;background:color-mix(in srgb,var(--rw-text) 18%,transparent);border:1px solid var(--rw-line)}
input[type=range]::-moz-range-track{height:6px;border-radius:4px;background:color-mix(in srgb,var(--rw-text) 18%,transparent);border:1px solid var(--rw-line)}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:15px;height:15px;border-radius:50%;background:var(--rw-accent);border:2px solid var(--rw-bg);margin-top:-6px;box-shadow:0 1px 4px rgba(0,0,0,.4)}
input[type=range]::-moz-range-thumb{width:13px;height:13px;border-radius:50%;background:var(--rw-accent);border:2px solid var(--rw-bg);box-shadow:0 1px 4px rgba(0,0,0,.4)}
*{scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--rw-accent) 45%,var(--rw-line)) transparent}
*::-webkit-scrollbar{width:10px;height:10px}
*::-webkit-scrollbar-track{background:color-mix(in srgb,var(--rw-bg) 70%,transparent)}
*::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--rw-accent) 40%,var(--rw-line));border-radius:8px;border:2px solid transparent;background-clip:content-box}
*::-webkit-scrollbar-thumb:hover{background:var(--rw-accent);background-clip:content-box}
*::-webkit-scrollbar-corner{background:transparent}
@keyframes rw-pulse{0%,100%{opacity:.35;transform:scale(.85)}50%{opacity:1;transform:scale(1.15)}}
.busy-dot{width:9px;height:9px;border-radius:50%;background:var(--rw-accent);display:inline-block;margin-left:8px;animation:rw-pulse 1s ease-in-out infinite;flex:0 0 auto}
.relation summary::-webkit-details-marker{display:none}
.relation summary::before{content:'▸';display:inline-block;transition:transform .15s;margin-right:4px}
.relation[open] summary::before{transform:rotate(90deg)}
.fab .busy-dot{position:absolute;bottom:-4px;left:-4px;width:8px;height:8px;margin:0;z-index:2}
@media(max-width:760px){.widget.fab{width:44px;height:44px}.body{max-height:min(60vh,500px)}}`;

const FAB_SYMBOL = '❤';

export function createRelationshipWidget(options = {}) {
  const facade = createFacade(options);
  const host = element('div', { className: 'relationship-widget-host' });
  const shadow = host.attachShadow({ mode: 'open' });
  const cleanups = [];
  let snapshot = normalizeSnapshot(options.initialState || facade.read());
  let selectedPairId = options.activePairId || snapshot.activePairId || pairId(snapshot.activePair);
  let expanded = options.expanded ?? Boolean(snapshot.widget?.expanded);
  // `position` is where the user put the widget; it is only clamped for display.
  // Keeping it unclamped means a temporary viewport shrink (mobile keyboard,
  // address bar) no longer pushes the widget up permanently.
  let position = normalizePosition(options.position || snapshot.widget?.position || { x: 16, y: 16 });
  let drag = null;
  const DRAG_THRESHOLD = 6;

  const widget = element('aside', { className: 'widget', role: 'complementary', 'aria-label': options.label || 'Активные отношения' });
  shadow.append(element('style', { text: STYLE + LIST_STYLE }), widget);
  ensureContainer(options.container).append(host);

  function normalizePosition(value) {
    return { x: Number(value?.x) || 0, y: Number(value?.y) || 0 };
  }

  function emit(name, detail) {
    dispatch(host, `relationship-widget:${name}`, detail);
  }

  function viewportSize() {
    const viewport = window.visualViewport;
    return {
      width: Math.round(viewport?.width || window.innerWidth || document.documentElement.clientWidth),
      height: Math.round(Math.max(window.innerHeight || 0, viewport?.height || 0) || document.documentElement.clientHeight),
    };
  }

  function clampToViewport(next, fitWhole = false) {
    const rect = widget.getBoundingClientRect();
    const margin = 6;
    const width = rect.width || (expanded ? 330 : 46);
    // While dragging, only the title bar has to stay reachable; right after
    // expanding, the whole panel should fit (opening from a bottom corner).
    const height = expanded && !fitWhole ? 48 : (rect.height || 46);
    const viewport = viewportSize();
    return {
      x: clamp(next.x, margin, Math.max(margin, viewport.width - width - margin)),
      y: clamp(next.y, margin, Math.max(margin, viewport.height - height - margin)),
    };
  }

  function applyPosition(next = position, store = true, fitWhole = false) {
    const shown = clampToViewport(next, fitWhole);
    if (store) position = shown;
    widget.style.left = `${shown.x}px`;
    widget.style.top = `${shown.y}px`;
    widget.style.right = 'auto';
    widget.style.bottom = 'auto';
  }

  function renderFab() {
    widget.classList.add('fab');
    widget.style.width = '';
    const displayPairs = snapshot.widgetPairs || snapshot.pairs || [];
    const fabIcon = element('div', { className: 'fab-icon', role: 'button', 'aria-label': 'Открыть виджет отношений', tabindex: '0' }, [
      element('span', { text: FAB_SYMBOL }),
    ]);
    if (displayPairs.length) {
      const badge = element('span', { className: 'fab-badge', 'aria-label': `Связей: ${displayPairs.length}` });
      badge.textContent = String(displayPairs.length);
      widget.append(badge);
    }
    if (snapshot.modelBusy) {
      widget.append(element('span', { className: 'busy-dot', title: 'Модель думает', role: 'status' }));
    }
    widget.append(fabIcon);
    // Tap vs. drag is decided in endDrag (movement threshold), so the whole
    // square is draggable and a plain tap still opens the list.
    fabIcon.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setExpanded(true); } });
  }

  function renderFull() {
    widget.classList.remove('fab');
    widget.style.width = '';
    const pair = getPair(snapshot, selectedPairId);
    if (pair) selectedPairId = pairId(pair);
    const personaId = snapshot.personaId || snapshot.ui?.personaId || '';
    const displayPairs = snapshot.widgetPairs || snapshot.pairs || [];
    const bar = element('div', { className: 'bar' });
    const identity = element('div', { className: 'identity' }, [
      element('strong', { text: 'Все отношения' }),
      element('span', { text: `Направленных связей: ${displayPairs.length}` }),
    ]);
    const toggleButton = button('−', 'icon', () => setExpanded(false), 'Свернуть виджет в квадратик');
    toggleButton.setAttribute('aria-expanded', 'false');
    bar.append(identity, toggleButton);
    if (snapshot.modelBusy) {
      const busy = element('span', { className: 'busy-dot', title: `Модель думает: ${snapshot.modelBusyLabel || 'запрос к модели…'}`, role: 'status' });
      identity.append(busy);
    }

    const body = element('div', { className: 'body' });
    body.append(element('div', { className: 'count', text: 'Все созданные связи. Раскройте строку для просмотра показателей.' }));
    const orderedPairs = [...displayPairs].sort((left, right) => {
      const leftPersona = personaId && pairTarget(left) === personaId ? 0 : 1;
      const rightPersona = personaId && pairTarget(right) === personaId ? 0 : 1;
      if (leftPersona !== rightPersona) return leftPersona - rightPersona;
      return pairLabel(snapshot, left).localeCompare(pairLabel(snapshot, right), 'ru-RU');
    });
    for (const relation of orderedPairs) {
      const pair = relation;
      // All lines collapsed when opening from the fab — user expands what they need.
      const card = element('details', { className: 'relation' });
      card.append(element('summary', { text: pairLabel(snapshot, pair) }));
      const metrics = element('div', { className: 'metrics' });
      const values = pair.metrics || pair.scales || {};
      const definitions = metricDefinitions(snapshot, pair);
      for (const definition of definitions) {
        const value = Number(values[definition.key] ?? 0);
        const percentage = clamp((value - Number(definition.min)) / (Number(definition.max) - Number(definition.min)) * 100, 0, 100);
        metrics.append(element('div', { className: 'metric' }, [
          element('span', { text: definition.label }),
          element('div', { className: 'track', role: 'meter', 'aria-label': definition.label, 'aria-valuemin': definition.min, 'aria-valuemax': definition.max, 'aria-valuenow': value }, [
            element('div', { className: 'fill', style: { width: `${percentage}%` } }),
          ]),
          element('output', { text: value }),
        ]));
      }
      card.append(metrics, renderLastChange(pair));
      body.append(card);
    }
    if (!displayPairs.length) body.append(element('div', { className: 'change', text: snapshot.pairs?.length ? 'Все связи скрыты из виджета. Показать — в Студии.' : 'Связей пока нет. Добавьте их в Студии или запустите анализ истории.' }));
    const openButton = button(options.openLabel || 'Открыть Студию отношений', 'open', () => {
      facade.invoke('onOpenStudio', { pairId: selectedPairId, pair });
      emit('open-studio', { pairId: selectedPairId, pair });
    });
    body.append(element('div', { className: 'actions' }, [openButton]));
    widget.replaceChildren(bar, body);
  }

  function render() {
    widget.replaceChildren();
    widget.classList.remove('fab');
    widget.style.width = '';
    widget.style.position = 'fixed';
    if (expanded) renderFull();
    else renderFab();
    applyPosition(position, false);
    requestAnimationFrame(() => applyPosition(position, false));
  }

  function renderLastChange(pair) {
    const change = pair.lastChange || [...(snapshot.journal || [])].reverse().find((entry) =>
      (entry.pairId || entry.relationshipId || entry.payload?.relationshipId) === pairId(pair));
    if (!change) return element('div', { className: 'change' }, [element('strong', { text: 'Последнее изменение' }), 'Изменений пока нет.']);
    const text = change.description || change.reason || change.text || `${change.metric || 'Показатель'} ${change.delta > 0 ? '+' : ''}${change.delta ?? ''}`;
    return element('div', { className: 'change' }, [
      element('strong', { text: 'Последнее изменение' }),
      element('span', { text }),
      change.timestamp || change.createdAt ? element('div', { text: formatTime(change.timestamp || change.createdAt) }) : null,
    ]);
  }

  // One set of pointer listeners on the stable <aside>. The old code attached a
  // new listener on every collapsed render (they piled up) and ignored presses
  // on the heart icon — which covers the whole square — so the collapsed
  // widget could never be dragged.
  function beginDrag(event) {
    if (drag || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const onFab = widget.classList.contains('fab');
    if (!onFab) {
      if (!event.target.closest('.bar') || event.target.closest('button')) return;
    }
    const rect = widget.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      dx: event.clientX - rect.left, dy: event.clientY - rect.top, moved: false, onFab,
    };
    try { widget.setPointerCapture(event.pointerId); }
    catch { /* capture is an optimization; dragging works without it */ }
    event.preventDefault();
  }

  function moveDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD) return;
    if (!drag.moved) { drag.moved = true; widget.classList.add('dragging'); }
    event.preventDefault();
    applyPosition({ x: event.clientX - drag.dx, y: event.clientY - drag.dy });
  }

  function endDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { moved, onFab } = drag;
    drag = null;
    widget.classList.remove('dragging');
    try { widget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    if (moved) {
      const payload = { position: { ...position } };
      facade.invoke('onPositionChange', payload);
      emit('position-change', payload);
    } else if (onFab && event.type === 'pointerup') {
      // The browser fires a `click` right after this pointerup. Once the panel
      // has expanded, whatever sits under the finger receives it — in a right
      // corner that is the "−" collapse button, so the panel closed instantly.
      // Swallow that one trailing click.
      swallowNextClick();
      setExpanded(true);
    }
  }

  function swallowNextClick() {
    const swallow = clickEvent => { clickEvent.stopPropagation(); clickEvent.preventDefault(); cleanup(); };
    const cleanup = () => { window.removeEventListener('click', swallow, true); clearTimeout(timer); };
    const timer = setTimeout(cleanup, 600);
    window.addEventListener('click', swallow, true);
  }

  widget.addEventListener('pointerdown', beginDrag);
  widget.addEventListener('pointermove', moveDrag);
  widget.addEventListener('pointerup', endDrag);
  widget.addEventListener('pointercancel', endDrag);
  // Stop the page behind from scrolling while a finger drags the widget.
  widget.addEventListener('touchmove', event => { if (drag) event.preventDefault(); }, { passive: false });

  function setExpanded(value) {
    if (expanded === value) return;
    // Keep the right edge where it was, so the square appears where the panel's
    // corner was (and vice versa) instead of jumping to the middle of a phone screen.
    const before = widget.getBoundingClientRect();
    expanded = value;
    facade.invoke('onWidgetToggle', { expanded });
    emit('toggle', { expanded });
    render();
    const after = widget.getBoundingClientRect();
    if (before.width && after.width) {
      applyPosition({ x: before.right - after.width, y: before.top }, true, value);
      const payload = { position: { ...position } };
      facade.invoke('onPositionChange', payload);
      emit('position-change', payload);
    }
  }

  function onResize() { applyPosition(position, false); }
  window.addEventListener('resize', onResize, { passive: true });
  cleanups.push(() => window.removeEventListener('resize', onResize));
  window.visualViewport?.addEventListener('resize', onResize, { passive: true });
  cleanups.push(() => window.visualViewport?.removeEventListener('resize', onResize));
  cleanups.push(facade.subscribe((value) => { snapshot = value; render(); }));
  render();

  return {
    element: host,
    expand: () => setExpanded(true),
    collapse: () => setExpanded(false),
    toggle: () => setExpanded(!expanded),
    update(value) { snapshot = normalizeSnapshot(value || facade.read()); facade.setLocal(snapshot); render(); },
    selectPair(value) { selectedPairId = typeof value === 'string' ? value : pairId(value); render(); },
    setPosition(value, persist = false) {
      position = normalizePosition(value);
      applyPosition(position);
      if (persist) {
        const payload = { position: { ...position } };
        facade.invoke('onPositionChange', payload); emit('position-change', payload);
      }
    },
    destroy() { cleanups.splice(0).forEach((cleanup) => cleanup()); host.remove(); emit('destroy', {}); },
  };
}

export default createRelationshipWidget;
