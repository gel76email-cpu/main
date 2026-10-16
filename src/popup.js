import { ACTIVE_STATUSES, STATE_KEY, parsePostUrl } from './shared.js';

const $ = (id) => document.getElementById(id);
let current;
function render(state) {
  current = state;
  const active = ACTIVE_STATUSES.includes(state?.status);
  $('start').disabled = active;
  $('url').disabled = active;
  $('status-panel').hidden = !state;
  if (!state) return;
  if (!$('url').value && state.url) $('url').value = state.url;
  $('status-label').textContent = ({ opening: 'Apertura del post', collecting: 'Raccolta in corso', exporting: 'Creazione Excel', done: 'File Excel scaricato', error: 'Operazione interrotta' })[state.status] || state.status;
  $('count').textContent = (state.count || 0).toLocaleString('it-IT');
  $('message').textContent = state.message || '';
  $('warning').textContent = state.warning || '';
  $('warning').hidden = !state.warning;
  $('stop').hidden = !['opening', 'collecting'].includes(state.status);
  $('stop').textContent = state.status === 'opening' ? 'Annulla apertura' : 'Ferma e scarica i commenti raccolti';
  $('focus').hidden = !active || !state.tabId;
  $('show-diagnostics').hidden = !state.diagnostics;
  if (!state.diagnostics) { $('diagnostics').hidden = true; $('diagnostics-label').hidden = true; }
  $('diagnostics').value = state.diagnostics ? JSON.stringify(state.diagnostics, null, 2) : '';
}

async function request(message) {
  const reply = await chrome.runtime.sendMessage(message);
  if (!reply?.ok) throw new Error(reply?.error || 'Estensione non disponibile. Riprova.');
  return reply;
}

$('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('start').disabled = true;
  try {
    const url = parsePostUrl($('url').value);
    await request({ type: 'START', url });
    render((await chrome.storage.session.get(STATE_KEY))[STATE_KEY]);
  } catch (error) {
    render({ status: 'error', message: error.message, count: 0 });
  }
});
$('stop').addEventListener('click', async () => {
  $('stop').disabled = true;
  try { await request({ type: 'STOP' }); }
  catch (error) { $('message').textContent = error.message; }
  finally { $('stop').disabled = false; }
});
$('focus').addEventListener('click', async () => {
  try { await chrome.tabs.update(current.tabId, { active: true }); }
  catch { $('message').textContent = 'La scheda Facebook è stata chiusa.'; }
});
$('show-diagnostics').addEventListener('click', () => {
  $('diagnostics').hidden = false;
  $('diagnostics-label').hidden = false;
  $('diagnostics').focus();
  $('diagnostics').select();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes[STATE_KEY]) render(changes[STATE_KEY].newValue);
});
render((await chrome.storage.session.get(STATE_KEY))[STATE_KEY]);
