import { ACTIVE_STATUSES, CHECKPOINT_KEY, STATE_KEY, parsePostUrl, samePost } from './shared.js';
import { mergeCommentRows } from './checkpoint.js';
import { createWorkbook, workbookDataUrl } from './workbook.js';

const getState = async () => (await chrome.storage.session.get(STATE_KEY))[STATE_KEY];
const setState = async (state) => chrome.storage.session.set({ [STATE_KEY]: state });
const getCheckpoint = async (state) => {
  const saved = (await chrome.storage.session.get(CHECKPOINT_KEY))[CHECKPOINT_KEY];
  return saved?.runId === state.runId ? saved : { runId: state.runId, rows: [], allSelected: false };
};
// Serialize lifecycle events and messages so a late tab event cannot overwrite a newer count.
let queue = Promise.resolve();
function enqueue(action) {
  const pending = queue.then(action);
  queue = pending.catch(() => {});
  return pending;
}

async function failure(state, error) {
  const saved = await getCheckpoint(state);
  await setState({ ...state, count: saved.rows.length, status: 'error', message: error,
    warning: saved.rows.length ? 'I commenti già raccolti sono disponibili con «Scarica i commenti salvati».' : '' });
}

async function start(input) {
  const previous = await getState();
  if (ACTIVE_STATUSES.includes(previous?.status)) throw new Error('Una raccolta è già attiva. Attendi oppure fermala dal popup.');
  const url = parsePostUrl(input);
  const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
  const state = { status: 'opening', url, tabId: tab.id, runId: crypto.randomUUID(), count: 0,
    startedAt: Date.now(), message: 'Apertura del post nella tua sessione Facebook…' };
  await chrome.storage.session.set({ [STATE_KEY]: state, [CHECKPOINT_KEY]: { runId: state.runId, rows: [], allSelected: false } });
  try { await chrome.tabs.update(tab.id, { url }); }
  catch (error) { await failure(state, error.message); throw error; }
}

async function saveProgress(state, message) {
  const checkpoint = await getCheckpoint(state);
  const rows = mergeCommentRows(checkpoint.rows, message.updatedRows || message.rows || []);
  const allSelected = !!message.allSelected;
  const next = { ...state, count: rows.length, allSelected, phase: message.phase || state.phase,
    message: message.message || state.message,
    warning: allSelected ? '' : 'In attesa del filtro «Tutti i commenti / All comments». La raccolta automatica degli altri commenti è in pausa.' };
  await chrome.storage.session.set({ [STATE_KEY]: next, [CHECKPOINT_KEY]: { runId: state.runId, rows, allSelected } });
  return { state: next, checkpoint: { rows, allSelected } };
}

async function exportSaved(state, reason) {
  const saved = await getCheckpoint(state);
  if (!saved.rows.length) throw new Error('Nessun commento salvato da esportare.');
  const exportedAt = new Date().toISOString();
  const warning = [reason, !saved.allSelected && 'Filtro «Tutti i commenti» non verificato: esportazione parziale.'].filter(Boolean).join(' ');
  let next = { ...state, status: 'exporting', count: saved.rows.length, warning, message: 'Scegli dove salvare il file Excel…' };
  await setState(next);
  const bytes = createWorkbook(saved.rows, { url: state.url, exportedAt, allSelected: saved.allSelected, reason });
  const downloadId = await chrome.downloads.download({ url: workbookDataUrl(bytes),
    filename: `commenti-facebook-${exportedAt.replace(/[:.]/g, '-')}.xlsx`, saveAs: true });
  next = { ...next, downloadId };
  await setState(next);
  const [download] = await chrome.downloads.search({ id: downloadId });
  if (download?.state === 'complete' || download?.state === 'interrupted') await downloadFinished(next, download.state);
}

async function downloadFinished(state, outcome) {
  if (outcome === 'complete') await setState({ ...state, status: 'done', message: `${state.count} commenti principali salvati nel file Excel.` });
  else await failure(state, 'Download annullato o interrotto. Puoi riprovare con «Scarica i commenti salvati».');
}

async function ensureCollector(state) {
  let response;
  try { response = await chrome.tabs.sendMessage(state.tabId, { type: 'COLLECTOR_STATUS' }); } catch { /* New document. */ }
  if (response?.running && response.runId === state.runId && response.documentToken === state.documentToken) return;
  if (!response?.documentToken) await chrome.scripting.executeScript({ target: { tabId: state.tabId }, files: ['collector.js'] });
  const checkpoint = await getCheckpoint(state);
  const next = { ...state, status: 'collecting', count: checkpoint.rows.length, allSelected: false, phase: 'preparing',
    message: checkpoint.rows.length ? `Ripresa della raccolta: ${checkpoint.rows.length} commenti già salvati…` : 'Preparazione della raccolta…' };
  await setState(next);
  response = await chrome.tabs.sendMessage(state.tabId, { type: 'COLLECT', runId: state.runId,
    url: state.url, initialRows: checkpoint.rows, startedAt: state.startedAt });
  if (!response?.ok || !response.documentToken) throw new Error(response?.error || 'Impossibile avviare la raccolta.');
  await setState({ ...next, documentToken: response.documentToken });
}

async function handle(message, sender) {
  const fromPopup = !sender.tab && sender.id === chrome.runtime.id;
  if (message.type === 'START' && fromPopup) { await start(message.url); return; }
  const state = await getState();
  if (!state) return { ignored: true };
  if (message.type === 'EXPORT_SAVED' && fromPopup) {
    if (ACTIVE_STATUSES.includes(state.status)) throw new Error('Ferma prima la raccolta in corso.');
    try { await exportSaved(state, 'Esportazione dei commenti conservati nella sessione; il risultato può essere parziale.'); }
    catch (error) { await failure(state, error.message); }
    return;
  }
  if (message.type === 'STOP' && fromPopup) {
    if (state.status === 'opening') { await failure(state, 'Apertura annullata. Puoi avviare una nuova raccolta.'); return; }
    if (state.status !== 'collecting') throw new Error('Nessuna raccolta attiva da fermare.');
    try {
      const reply = await chrome.tabs.sendMessage(state.tabId, { type: 'STOP_COLLECTING', runId: state.runId });
      if (!reply?.ok) throw new Error('Raccoglitore non disponibile.');
    } catch {
      try { await exportSaved(state, 'Raccolta interrotta durante un caricamento: esportazione parziale dei commenti salvati.'); }
      catch (error) { await failure(state, error.message); }
    }
    return;
  }
  if (sender.tab?.id !== state.tabId || message.runId !== state.runId || message.documentToken !== state.documentToken
      || state.status !== 'collecting') return { ignored: true };
  if (message.type === 'PROGRESS') await saveProgress(state, message);
  else if (message.type === 'FAILED') {
    try {
      const saved = await saveProgress(state, message);
      await failure({ ...saved.state, diagnostics: message.diagnostics }, message.error);
    } catch (error) {
      await failure({ ...state, diagnostics: message.diagnostics }, `Impossibile salvare altri commenti: ${error.message}. Puoi scaricare quelli già conservati.`);
    }
  } else if (message.type === 'COMPLETE') {
    let next = state;
    try {
      next = (await saveProgress(state, message)).state;
      await exportSaved(next, message.reason);
    } catch (error) { await failure(next, error.message); }
  }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  enqueue(() => handle(message, sender)).then((result) => reply({ ok: true, ...result }))
    .catch((error) => reply({ ok: false, error: error.message }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  // Loading events also occur without replacing the document. Reconcile only
  // after completion, and ask the existing collector whether it is still alive.
  if (change.status !== 'complete' || !tab.url || tab.url === 'about:blank') return;
  void enqueue(async () => {
    const state = await getState();
    if (state?.tabId !== tabId || !['opening', 'collecting'].includes(state.status)) return;
    if (!samePost(tab.url, state.url)) {
      await failure(state, 'La scheda non mostra più il post richiesto. I commenti già raccolti restano scaricabili.');
      return;
    }
    try { await ensureCollector(state); }
    catch (error) { await failure(await getState(), `Non riesco a riprendere la raccolta: ${error.message}`); }
  }).catch(console.error);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void enqueue(async () => {
    const state = await getState();
    if (state?.tabId === tabId && ['opening', 'collecting'].includes(state.status)) {
      await failure(state, 'Scheda Facebook chiusa prima della fine della raccolta. I commenti già raccolti restano scaricabili.');
    }
  }).catch(console.error);
});

chrome.downloads.onChanged.addListener((delta) => {
  if (!['complete', 'interrupted'].includes(delta.state?.current)) return;
  void enqueue(async () => {
    const state = await getState();
    if (state?.status === 'exporting' && state.downloadId === delta.id) await downloadFinished(state, delta.state.current);
  }).catch(console.error);
});
