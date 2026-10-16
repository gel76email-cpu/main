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

export function findSortControl(scope, visible = () => true) {
  return [...scope.querySelectorAll('button, [role="button"]')].find((node) => visible(node)
    && /^(?:pi[uù] (?:pertinenti|rilevanti|recenti)|most relevant|newest|tutti i commenti|all comments)$/i
      .test((node.getAttribute('aria-label') || node.textContent).replace(/\s+/g, ' ').trim()));
}
