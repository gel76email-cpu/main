import { ACTIVE_STATUSES, STATE_KEY, parsePostUrl } from './shared.js';
import { createWorkbook, workbookDataUrl } from './workbook.js';

const getState = async () => (await chrome.storage.session.get(STATE_KEY))[STATE_KEY];
const setState = async (state) => chrome.storage.session.set({ [STATE_KEY]: state });
const failure = async (state, error) => setState({ ...state, status: 'error', message: error, warning: '' });
let starting = false;

async function start(input) {
  if (starting) throw new Error('Una raccolta è già in avvio.');
  starting = true;
  try {
    const previous = await getState();
    if (ACTIVE_STATUSES.includes(previous?.status)) throw new Error('Una raccolta è già attiva. Attendi oppure fermala dal popup.');
    const url = parsePostUrl(input);
    const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
    const state = { status: 'opening', url, tabId: tab.id, runId: crypto.randomUUID(), count: 0, startedAt: Date.now(), message: 'Apertura del post nella tua sessione Facebook…' };
    await setState(state);
    try { await chrome.tabs.update(tab.id, { url }); }
    catch (error) { await failure(state, error.message); throw error; }
  } finally { starting = false; }
}

async function exportRows(state, message) {
  if (!Array.isArray(message.rows) || !message.rows.length || message.rows.some((row) =>
    !row || ['username', 'text', 'timestamp'].some((key) => typeof row[key] !== 'string'))) {
    throw new Error('Dati dei commenti non validi.');
  }
  const exportedAt = new Date().toISOString();
  const warning = [message.reason, !message.allSelected && 'Filtro «Tutti i commenti» non verificato: il risultato può essere parziale.'].filter(Boolean).join(' ');
  let next = { ...state, status: 'exporting', count: message.rows.length, warning, message: 'Scegli dove salvare il file Excel…' };
  await setState(next);
  const bytes = createWorkbook(message.rows, { url: state.url, exportedAt, allSelected: !!message.allSelected, reason: message.reason });
  const downloadId = await chrome.downloads.download({
    url: workbookDataUrl(bytes),
    filename: `commenti-facebook-${exportedAt.replace(/[:.]/g, '-')}.xlsx`,
    saveAs: true,
  });
  next = { ...next, downloadId };
  await setState(next);
  // Completion can precede the storage write for small files.
  const [download] = await chrome.downloads.search({ id: downloadId });
  if (download?.state === 'complete') await downloadFinished(next, 'complete');
  else if (download?.state === 'interrupted') await downloadFinished(next, 'interrupted');
}

async function downloadFinished(state, outcome) {
  if (outcome === 'complete') await setState({ ...state, status: 'done', message: `${state.count} commenti principali salvati nel file Excel.` });
  else await failure(state, 'Download annullato o interrotto. Avvia una nuova raccolta per esportare.');
}

async function handle(message, sender) {
  const fromPopup = !sender.tab && sender.id === chrome.runtime.id;
  if (message.type === 'START' && fromPopup) { await start(message.url); return; }
  const state = await getState();
  if (message.type === 'STOP' && fromPopup) {
    if (state?.status === 'opening') {
      await failure(state, 'Apertura annullata. Puoi accedere a Facebook e avviare una nuova raccolta.');
      return;
    }
    if (state?.status !== 'collecting') throw new Error('Nessuna raccolta attiva da fermare.');
    await chrome.tabs.sendMessage(state.tabId, { type: 'STOP_COLLECTING' });
    return;
  }
  if (!state || sender.tab?.id !== state.tabId || message.runId !== state.runId || state.status !== 'collecting') return;
  if (message.type === 'PROGRESS') await setState({ ...state, count: message.count, message: message.message,
    warning: message.allSelected ? '' : 'Filtro «Tutti i commenti» non verificato. Puoi selezionarlo nella scheda Facebook.' });
  else if (message.type === 'FAILED') await failure(state, message.error);
  else if (message.type === 'COMPLETE') {
    try { await exportRows(state, message); }
    catch (error) { await failure({ ...state, count: message.rows?.length || state.count }, error.message); }
  }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  handle(message, sender).then(() => reply({ ok: true })).catch((error) => reply({ ok: false, error: error.message }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  void (async () => {
    const state = await getState();
    if (state?.tabId !== tabId) return;
    if (state.status === 'collecting' && change.status === 'loading') {
      await failure(state, 'La pagina è stata ricaricata o cambiata durante la raccolta. Riprova dal popup.');
      return;
    }
    // Without the broad "tabs" permission, about:blank has no readable tab.url.
    if (state.status !== 'opening' || change.status !== 'complete' || !tab.url || tab.url === 'about:blank') return;
    try {
      const destination = new URL(tab.url);
      if (destination.hostname !== 'www.facebook.com' || /\/(?:login|checkpoint|recover)\b/.test(destination.pathname)) {
        throw new Error('Accedi prima a Facebook nella scheda aperta, quindi avvia una nuova raccolta.');
      }
      await setState({ ...state, status: 'collecting', message: 'Preparazione della raccolta…' });
      await chrome.scripting.executeScript({ target: { tabId }, files: ['collector.js'] });
      const response = await chrome.tabs.sendMessage(tabId, { type: 'COLLECT', runId: state.runId, url: state.url });
      if (!response?.ok) throw new Error(response?.error || 'Impossibile avviare la raccolta.');
    } catch (error) { await failure(state, error.message); }
  })().catch(console.error);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const state = await getState();
    if (state?.tabId === tabId && ['opening', 'collecting'].includes(state.status)) {
      await failure(state, 'Scheda Facebook chiusa prima della fine della raccolta. Riprova dal popup.');
    }
  })().catch(console.error);
});

chrome.downloads.onChanged.addListener((delta) => {
  if (!['complete', 'interrupted'].includes(delta.state?.current)) return;
  void (async () => {
    const state = await getState();
    if (state?.status === 'exporting' && state.downloadId === delta.id) await downloadFinished(state, delta.state.current);
  })().catch(console.error);
});
