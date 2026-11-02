/**
 * "Check this reply" button in every message's "…" menu.
 *
 * SillyTavern clones new messages from the #message_template node, so adding the
 * button to the template once covers all future messages; messages that are
 * already on screen get it through refresh(). One delegated click listener
 * serves every button. User messages hide it via style.css.
 */
const BUTTON_CLASS = 'relationship-engine-check';

function createButton() {
  const node = document.createElement('div');
  node.className = `mes_button ${BUTTON_CLASS} fa-solid fa-heart-pulse`;
  node.title = 'Движок отношений: проверить этот ответ';
  node.setAttribute('aria-label', node.title);
  return node;
}

function addButtons(root) {
  if (!root) return;
  for (const container of root.querySelectorAll('.extraMesButtons')) {
    if (!container.querySelector(`.${BUTTON_CLASS}`)) container.prepend(createButton());
  }
}

export function mountMessageButtons(onCheck) {
  const onClick = event => {
    const target = event.target instanceof Element ? event.target.closest(`.${BUTTON_CLASS}`) : null;
    if (!target) return;
    const index = Number(target.closest('.mes')?.getAttribute('mesid'));
    if (!Number.isInteger(index)) return;
    event.preventDefault();
    event.stopPropagation();
    try { onCheck(index); }
    catch (error) { console.error('[Relationship Engine] Message check failed.', error); }
  };
  try {
    addButtons(document.getElementById('message_template'));
    addButtons(document.getElementById('chat'));
  } catch (error) {
    console.error('[Relationship Engine] Could not add message buttons.', error);
  }
  document.addEventListener('click', onClick, true);
  return {
    refresh() {
      try { addButtons(document.getElementById('chat')); }
      catch (error) { console.error('[Relationship Engine] Could not add message buttons.', error); }
    },
    unmount() {
      document.removeEventListener('click', onClick, true);
      for (const node of document.querySelectorAll(`.${BUTTON_CLASS}`)) node.remove();
    },
  };
}
