import { extractComments, findPostScope, findLoadMoreControl, expandableCommentButtons, commentContainers, layoutDiagnostics } from './extract.js';
import { findCommentsOpener, findSortControl, sortChoice, selectAllComments, controlBusy } from './page-controls.js';
import { samePost } from './shared.js';

if (!globalThis.__facebookExcelCollector) {
  globalThis.__facebookExcelCollector = true;
  const documentToken = crypto.randomUUID();
  let running = false;
  let activeRunId;
  let stopRequested = false;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (el) => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  async function send(message) {
    const reply = await chrome.runtime.sendMessage({ ...message, documentToken });
    if (!reply?.ok || reply.ignored) throw new Error(reply?.error || 'Raccolta non più attiva in questa pagina.');
  }

  function scrollComments(scope) {
    const comments = commentContainers(scope);
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

  async function collect({ runId, url, initialRows = [], startedAt }) {
    running = true;
    activeRunId = runId;
    stopRequested = false;
    const rows = new Map(initialRows.map((row) => [row.key, row]));
    const dirty = new Map();
    const started = startedAt || Date.now();
    let allSelected = false;
    let idle = 0;
    let passes = 0;
    let clickedOpener = false;
    let lastScope = null;
    let filterAttempts = 0;
    let lastFilterAttempt = 0;
    let phase = 'preparing';
    let reason = 'Nessun altro commento principale caricabile rilevato.';

    function capture(scope) {
      let changed = false;
      for (const row of extractComments(scope, url)) {
        const before = rows.get(row.key);
        if (!before || before.text !== row.text || before.timestamp !== row.timestamp) {
          dirty.set(row.key, row);
          changed = true;
        }
        rows.set(row.key, row);
      }
      return changed;
    }
    async function progress(message) {
      // Save before clicks or scrolling: those actions may replace the document.
      await send({ type: 'PROGRESS', runId, updatedRows: [...dirty.values()], count: rows.size, allSelected, phase, message });
      dirty.clear();
    }

    try {
      await pause(1500);
      while (!stopRequested && Date.now() - started < 900_000) {
        if (!samePost(location.href, url)) throw new Error('La pagina non mostra più il post richiesto. Puoi scaricare i commenti già salvati.');
        let scope = findPostScope(document, url);
        lastScope = scope;
        if (!scope) {
          if (++passes > 12) throw new Error('Post non disponibile. Verifica accesso e apertura del pannello Comments.');
          await pause(1000);
          continue;
        }
        if (!clickedOpener && !commentContainers(scope).length && !findSortControl(scope, visible)) {
          const opener = findCommentsOpener(scope, visible);
          if (opener) {
            clickedOpener = true;
            await progress('Apertura del pannello commenti del video…');
            opener.click();
            await pause(1500);
            scope = findPostScope(document, url) || scope;
            lastScope = scope;
          }
        }
        let changed = capture(scope);
        const currentChoice = sortChoice(findSortControl(scope, visible));
        if (currentChoice === 'all') allSelected = true;
        else if (currentChoice === 'relevant' || currentChoice === 'newest') {
          if (allSelected) filterAttempts = 0;
          allSelected = false;
        }
        phase = allSelected ? 'reading' : 'filter';
        await progress(allSelected ? 'Lettura dei commenti principali…' : 'Verifica del filtro «Tutti i commenti / All comments»…');

        if (!allSelected && filterAttempts < 3 && Date.now() - lastFilterAttempt > 2500) {
          filterAttempts++;
          lastFilterAttempt = Date.now();
          allSelected = await selectAllComments(() => findPostScope(document, url) || scope,
            { document, visible, pause, stopped: () => stopRequested });
          scope = findPostScope(document, url) || scope;
          lastScope = scope;
          changed = capture(scope) || changed;
        }
        if (!allSelected) {
          phase = 'filter';
          await progress('Seleziona «Tutti i commenti / All comments» dal menu Facebook. Riprenderò automaticamente. Puoi anche fermare ed esportare i commenti già raccolti.');
          // Do not scroll through a relevance-filtered subset and label it complete.
          if (!rows.size && ++idle >= 24) break;
          if (rows.size) idle = 0;
          await pause(1200);
          continue;
        }

        phase = 'reading';
        const more = findLoadMoreControl(scope, visible);
        const loading = controlBusy(more) || [...scope.querySelectorAll('[role="progressbar"], [aria-busy="true"]')].some(visible);
        await progress(loading ? 'Facebook sta caricando il prossimo blocco di commenti…' : more ? 'Caricamento di altri commenti principali…' : 'Lettura dei commenti principali…');
        for (const button of expandableCommentButtons(scope).filter(visible).slice(0, 5)) button.click();
        if (more && !loading) more.click();
        if (!loading) scrollComments(scope);
        idle = changed || loading ? 0 : idle + 1;
        if (idle >= 8) {
          if (more) reason = 'Caricamento fermo: il pulsante per altri commenti non produce nuovi risultati.';
          break;
        }
        passes++;
        await pause(1200);
      }
      if (stopRequested) reason = 'Raccolta interrotta manualmente: esportazione parziale.';
      else if (Date.now() - started >= 900_000) reason = 'Raggiunto il limite di 15 minuti: esportazione potenzialmente parziale.';
      const finalScope = samePost(location.href, url) ? findPostScope(document, url) : null;
      if (finalScope) {
        capture(finalScope);
        const choice = sortChoice(findSortControl(finalScope, visible));
        if (choice === 'relevant' || choice === 'newest') allSelected = false;
      }
      if (!rows.size) throw new Error('Non riesco a leggere i commenti. Apri «Comments» e verifica «Tutti i commenti». Se sono visibili, mostrami la diagnostica.');
      await send({ type: 'COMPLETE', runId, rows: [...rows.values()], allSelected, reason });
    } catch (error) {
      let diagnostics;
      try { diagnostics = { ...layoutDiagnostics(document, lastScope), openerClicked: clickedOpener, phase, filterAttempts }; }
      catch { diagnostics = { schema: 1, diagnosticError: true }; }
      await send({ type: 'FAILED', runId, error: error.message, rows: [...rows.values()], allSelected, diagnostics }).catch(() => {});
    } finally { running = false; }
  }

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message.type === 'COLLECTOR_STATUS') {
      reply({ ok: true, running, runId: activeRunId, documentToken });
    } else if (message.type === 'COLLECT') {
      if (running) { reply({ ok: false, error: 'Raccolta già in corso.' }); return; }
      void collect(message);
      reply({ ok: true, documentToken });
    } else if (message.type === 'STOP_COLLECTING') {
      if (!running || message.runId !== activeRunId) { reply({ ok: false }); return; }
      stopRequested = true;
      reply({ ok: true });
    }
  });
}
