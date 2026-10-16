import { extractComments, findPostScope, isLoadMoreLabel, expandableCommentButtons } from './extract.js';

// Injection is requested once per run, with no persistent access to other Facebook tabs.
if (!globalThis.__facebookExcelCollector) {
  globalThis.__facebookExcelCollector = true;
  let running = false;
  let stopRequested = false;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const send = (message) => chrome.runtime.sendMessage(message).catch(() => {});
  const visible = (el) => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const allLabel = /^(?:tutti i commenti|all comments)(?:\b|$)/i;
  const filterLabel = /^(?:pi[uù] (?:pertinenti|rilevanti|recenti)|most relevant|newest|tutti i commenti|all comments)$/i;

  async function chooseAll(scope) {
    const filter = [...scope.querySelectorAll('button, [role="button"]')].find((el) => visible(el) && filterLabel.test(el.textContent.trim()));
    if (!filter) return false;
    if (allLabel.test(filter.textContent.trim())) return true;
    filter.click();
    await pause(450);
    const option = [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"]')]
      .find((el) => visible(el) && allLabel.test(el.textContent.trim()));
    if (!option) { filter.click(); return false; }
    option.click();
    await pause(900);
    return true;
  }

  function scrollComments(scope) {
    const comments = scope.querySelectorAll('[role="article"], article');
    const last = comments[comments.length - 1];
    if (last) last.scrollIntoView({ block: 'end', behavior: 'instant' });
    let target = last?.parentElement || scope;
    while (target && target !== document.body) {
      if (target.scrollHeight > target.clientHeight + 30 && /auto|scroll/.test(getComputedStyle(target).overflowY)) {
        target.scrollTop = target.scrollHeight;
        return;
      }
      target = target.parentElement;
    }
    if (scope.matches('[role="main"], main') || !scope.closest('[role="dialog"]')) window.scrollBy(0, 650);
  }

  async function collect({ runId, url }) {
    if (running) throw new Error('Una raccolta è già attiva in questa scheda.');
    running = true;
    stopRequested = false;
    const rows = new Map();
    const started = Date.now();
    let allSelected = false;
    let idle = 0;
    let passes = 0;
    let reason = 'Nessun altro commento principale caricabile rilevato.';
    try {
      await pause(1500);
      while (!stopRequested && Date.now() - started < 900_000) {
        const scope = findPostScope(document, url);
        if (!scope) {
          if (++passes > 12) throw new Error('Post non disponibile. Verifica di essere connesso a Facebook e che il link sia accessibile.');
          await pause(1000);
          continue;
        }
        if (!allSelected && passes % 8 === 0) allSelected = await chooseAll(scope);
        const count = rows.size;
        let changed = false;
        for (const row of extractComments(scope)) {
          const before = rows.get(row.key);
          if (before && (before.text !== row.text || before.timestamp !== row.timestamp)) changed = true;
          rows.set(row.key, row);
        }
        for (const button of expandableCommentButtons(scope).filter(visible).slice(0, 5)) button.click();
        const more = [...scope.querySelectorAll('button, [role="button"]')].find((el) => visible(el) && isLoadMoreLabel(el.textContent));
        if (more) more.click();
        scrollComments(scope);
        idle = rows.size === count && !changed ? idle + 1 : 0;
        await send({ type: 'PROGRESS', runId, count: rows.size, allSelected,
          message: more ? 'Caricamento di altri commenti principali…' : 'Lettura dei commenti principali…' });
        // A stubborn button or unloaded section is not proof that all comments were read.
        if (idle >= 8) {
          if (more) reason = 'Caricamento fermo: il pulsante per altri commenti non produce nuovi risultati.';
          break;
        }
        passes++;
        await pause(1200);
      }
      if (stopRequested) reason = 'Raccolta interrotta manualmente: esportazione parziale.';
      else if (Date.now() - started >= 900_000) reason = 'Raggiunto il limite di 15 minuti: esportazione potenzialmente parziale.';
      // Capture anything that arrived during the last asynchronous wait.
      const finalScope = findPostScope(document, url);
      if (finalScope) for (const row of extractComments(finalScope)) rows.set(row.key, row);
      if (!rows.size) throw new Error('Nessun commento principale riconosciuto. Verifica accesso, presenza di commenti e filtro «Tutti i commenti». Facebook potrebbe aver modificato la pagina.');
      await send({ type: 'COMPLETE', runId, rows: [...rows.values()], allSelected, reason });
    } catch (error) {
      await send({ type: 'FAILED', runId, error: error.message });
    } finally { running = false; }
  }

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message.type === 'COLLECT') {
      if (running) { reply({ ok: false, error: 'Raccolta già in corso.' }); return; }
      void collect(message);
      reply({ ok: true });
    } else if (message.type === 'STOP_COLLECTING') {
      stopRequested = true;
      reply({ ok: true });
    }
  });
}
