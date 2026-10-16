// Match only controls that open/read comments, never the publish/reply controls.
export function isCommentsOpener(label) {
  const text = label.replace(/\s+/g, ' ').trim();
  return /^(?:(?:show|view|see|open|mostra|visualizza|vedi|apri) )?(?:(?:[\d.,]+\s*[kKmM]?|all|tutti i) )?(?:comments|commenti)(?:\s*\(?[\d.,]+\s*[kKmM]?\)?)?$/i.test(text);
}

export function findCommentsOpener(scope, visible = () => true) {
  return [...scope.querySelectorAll('button, [role="button"], a[role="link"]')].find((node) => {
    if (!visible(node) || node.getAttribute('aria-expanded') === 'true') return false;
    return [node.getAttribute('aria-label'), node.getAttribute('title'), node.textContent]
      .filter(Boolean).some(isCommentsOpener);
  });
}

export function controlBusy(node) {
  return !!(node?.disabled || node?.getAttribute('aria-disabled') === 'true' || node?.getAttribute('aria-busy') === 'true');
}

export function sortChoice(node) {
  if (!node) return 'unknown';
  const labels = [node.getAttribute('aria-label'), node.getAttribute('title'), node.innerText, node.textContent,
    ...[...node.querySelectorAll('span, [dir="auto"]')].slice(0, 12).map((child) => child.textContent)];
  for (const label of labels.filter(Boolean)) {
    const text = label.replace(/[\u00a0\s]+/g, ' ').replace(/[⌄▾▼]+$/g, '').trim();
    const prefix = '(?:(?:sort(?: comments)? by|sorted by|ordina(?: i commenti)? per|comment ranking|commenti|comments)\\s*:?\\s*)?';
    if (new RegExp(`^${prefix}(?:all comments|tutti i commenti)\\b`, 'i').test(text)) return 'all';
    if (new RegExp(`^${prefix}(?:most relevant|pi[uù] (?:pertinenti|rilevanti))\\b`, 'i').test(text)) return 'relevant';
    if (new RegExp(`^${prefix}(?:newest|pi[uù] recenti)\\b`, 'i').test(text)) return 'newest';
  }
  return 'unknown';
}

export function findSortControl(scope, visible = () => true) {
  if (!scope) return null;
  return [...scope.querySelectorAll('button, [role="button"], [aria-haspopup="menu"], a[role="link"]')].find((node) =>
    visible(node) && !node.closest('[role="menu"], [role="listbox"], [role="menuitemradio"], [role="menuitem"], [role="option"]')
      && sortChoice(node) !== 'unknown') || null;
}

export async function selectAllComments(getScope, { document, visible = () => true, pause, stopped = () => false }) {
  const control = findSortControl(getScope(), visible);
  if (!control) return false;
  if (sortChoice(control) === 'all') return true;
  control.click();
  let option;
  for (let attempt = 0; attempt < 10 && !stopped(); attempt++) {
    await pause(200);
    option = [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"], [role="menu"] button, [role="menu"] [role="button"], [role="listbox"] [role="button"]')]
      .find((node) => visible(node) && sortChoice(node) === 'all');
    if (option) break;
  }
  if (!option || stopped()) {
    if (control.isConnected && control.getAttribute('aria-expanded') === 'true') control.click();
    return false;
  }
  option.click();
  // A successful click is not proof: read the selected value back from the trigger.
  for (let attempt = 0; attempt < 15 && !stopped(); attempt++) {
    await pause(200);
    if (sortChoice(findSortControl(getScope(), visible)) === 'all') return true;
  }
  return false;
}
