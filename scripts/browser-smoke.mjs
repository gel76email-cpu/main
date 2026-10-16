// Real Chromium runs the actual bundles, with Chrome APIs simulated. The cloud
// machine blocks extension installation by enterprise policy; do not bypass it.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { unzipSync, strFromU8 } from 'fflate';

const profile = await mkdtemp('/tmp/facebook-excel-browser-');
const downloadPath = resolve('artifacts/browser-downloads');
await mkdir(downloadPath, { recursive: true });
const fixture = await readFile('test/fixtures/post.html', 'utf8');
const videoFixture = await readFile('test/fixtures/video.html', 'utf8');
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox'],
});
const pages = new Map();
const downloads = new Map();
const storage = {};
const errors = [];
let nextTabId = 1;
let background;

async function emit(page, event, args) {
  if (!page || page.isClosed()) return;
  return page.evaluate(({ event, args }) => {
    for (const listener of globalThis.__events?.[event] || []) listener(...args);
  }, { event, args });
}

async function runtimeMessage(page, message, sender) {
  return page.evaluate(({ message, sender }) => new Promise((resolve) => {
    const listeners = globalThis.__events.runtime || [];
    if (!listeners.length) return resolve(undefined);
    for (const listener of listeners) {
      const asyncReply = listener(message, sender, resolve);
      if (asyncReply !== true) resolve(undefined);
    }
  }), { message, sender });
}

try {
  await context.route('https://www.facebook.com/**', (route) => {
    const url = new URL(route.request().url());
    const body = url.searchParams.get('v') === '777' ? '<!doctype html><main role="main">Video senza DOM commenti riconoscibile</main>'
      : url.pathname.includes('/watch') || url.pathname.includes('/videos/') ? videoFixture : fixture;
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
  });
  await context.route('https://extension.test/**', async (route) => {
    const path = new URL(route.request().url()).pathname.slice(1);
    if (!path || path === 'background') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Background test harness</title>' });
    const contentType = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html';
    await route.fulfill({ contentType, body: await readFile(resolve('dist', path)) });
  });
  context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  await context.exposeBinding('__host', async ({ page }, { api, args }) => {
    if (api === 'runtime.send') {
      const tabId = [...pages.entries()].find(([, entry]) => entry === page)?.[0];
      return runtimeMessage(background, args[0], { id: 'test-extension', ...(tabId ? { tab: { id: tabId } } : {}) });
    }
    if (api === 'storage.get') return { [args[0]]: storage[args[0]] };
    if (api === 'storage.set') {
      const changes = {};
      for (const [key, value] of Object.entries(args[0])) {
        changes[key] = { oldValue: storage[key], newValue: value };
        storage[key] = structuredClone(value);
      }
      await Promise.all(context.pages().map((p) => emit(p, 'storage', [changes, 'session'])));
      return;
    }
    if (api === 'tabs.create') {
      const id = nextTabId++;
      const tab = await context.newPage();
      pages.set(id, tab);
      tab.on('close', () => { void emit(background, 'tabRemoved', [id]).catch(() => {}); });
      await tab.goto(args[0].url);
      return { id };
    }
    if (api === 'tabs.update') {
      const [id, options] = args;
      const tab = pages.get(id);
      if (!tab || tab.isClosed()) throw new Error('Tab closed');
      if (options.url) {
        // A preceding about:blank update may hide tab.url with scoped host permissions.
        await emit(background, 'tabUpdated', [id, { status: 'complete' }, {}]);
        await emit(background, 'tabUpdated', [id, { status: 'loading' }, { url: options.url }]);
        await tab.goto(options.url);
        await emit(background, 'tabUpdated', [id, { status: 'complete' }, { url: tab.url() }]);
      }
      return { id };
    }
    if (api === 'tabs.send') return runtimeMessage(pages.get(args[0]), args[1], { id: 'test-extension' });
    if (api === 'scripting.execute') {
      for (const file of args[0].files) await pages.get(args[0].target.tabId).addScriptTag({ path: resolve('dist', file) });
      return [];
    }
    if (api === 'downloads.download') {
      const options = args[0];
      const id = downloads.size + 1;
      const filename = resolve(downloadPath, options.filename);
      await writeFile(filename, Buffer.from(options.url.split(',')[1], 'base64'));
      downloads.set(id, { id, filename, state: 'complete' });
      return id;
    }
    if (api === 'downloads.search') return [downloads.get(args[0].id)];
    throw new Error(`Unhandled mock API: ${api}`);
  });
  await context.addInitScript(() => {
    const events = globalThis.__events = {};
    const event = (name) => ({ addListener: (listener) => { (events[name] ||= []).push(listener); } });
    const call = (api) => (...args) => globalThis.__host({ api, args });
    globalThis.chrome = {
      runtime: { id: 'test-extension', onMessage: event('runtime'), sendMessage: call('runtime.send') },
      storage: { session: { get: call('storage.get'), set: call('storage.set') }, onChanged: event('storage') },
      tabs: { create: call('tabs.create'), update: call('tabs.update'), sendMessage: call('tabs.send'), onUpdated: event('tabUpdated'), onRemoved: event('tabRemoved') },
      scripting: { executeScript: call('scripting.execute') },
      downloads: { download: call('downloads.download'), search: call('downloads.search'), onChanged: event('downloads') },
    };
  });
  background = await context.newPage();
  await background.goto('https://extension.test/background');
  await background.addScriptTag({ url: 'https://extension.test/background.js', type: 'module' });
  await background.waitForFunction(() => globalThis.__events.runtime?.length);
  const popup = await context.newPage();
  await popup.goto('https://extension.test/popup.html');
  await popup.locator('#url').fill('https://www.facebook.com/demo/posts/12345');
  await popup.locator('#start').click();
  await popup.waitForFunction(() => document.querySelector('#status-label').textContent === 'File Excel scaricato', undefined, { timeout: 30_000 });
  const state = storage.exportState;
  assert.equal(state.count, 3);
  assert.equal(state.status, 'done');
  const tab = pages.get(state.tabId);
  assert.equal(await tab.locator('#filter').textContent(), 'Tutti i commenti');
  assert.equal(await tab.locator('body').getAttribute('data-replies-clicked'), null);
  const download = downloads.get(state.downloadId);
  const files = unzipSync(await readFile(download.filename));
  const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.ok(sheet.includes('Testo completo del commento.'));
  assert.ok(sheet.includes('Un altro commento: &lt;ciao&gt;'));
  assert.ok(!sheet.includes('DA ESCLUDERE'));
  assert.equal((sheet.match(/<row /g) || []).length, 4);
  assert.equal(await popup.locator('#start').isEnabled(), true);
  console.log('PASS (API Chrome simulate): popup → pagina dinamica → filtro → caricamento → esclusione risposte → XLSX con 3 commenti.');
  await popup.locator('body').screenshot({ path: 'artifacts/popup.png' });

  await popup.reload();
  await popup.waitForFunction(() => document.querySelector('#status-label').textContent === 'File Excel scaricato');
  await popup.locator('#start').click();
  await popup.waitForFunction(() => document.querySelector('#status-label').textContent === 'Raccolta in corso');
  await popup.waitForFunction(() => Number(document.querySelector('#count').textContent) > 0);
  await popup.locator('#stop').click();
  await popup.waitForFunction(() => document.querySelector('#status-label').textContent === 'File Excel scaricato', undefined, { timeout: 15_000 });
  assert.ok((await popup.locator('#warning').textContent()).includes('interrotta manualmente'));
  console.log('PASS (API simulate): riapertura del popup e arresto manuale con esportazione parziale.');

  await popup.locator('#start').click();
  await popup.waitForFunction(() => document.querySelector('#status-label').textContent === 'Raccolta in corso');
  await pages.get(storage.exportState.tabId).close();
  await popup.waitForFunction(() => document.querySelector('#status-label').textContent === 'Operazione interrotta');
  assert.ok((await popup.locator('#message').textContent()).includes('chiusa'));
  console.log('PASS (API simulate): chiusura della scheda segnalata senza raccolta bloccata.');

  await popup.locator('#url').fill('https://www.facebook.com/watch/live/?ref=watch_permalink&v=1996968627664961');
  await popup.locator('#start').click();
  await popup.waitForFunction(() => document.querySelector('#status-label').textContent === 'File Excel scaricato', undefined, { timeout: 30_000 });
  const videoState = storage.exportState;
  assert.equal(videoState.count, 2);
  const videoTab = pages.get(videoState.tabId);
  assert.equal(await videoTab.locator('body').getAttribute('data-opener-clicks'), '1');
  assert.equal(await videoTab.locator('body').getAttribute('data-replies-clicked'), null);
  assert.equal(await videoTab.locator('body').getAttribute('data-publish-clicked'), null);
  assert.equal(await videoTab.locator('#video-filter').textContent(), 'All comments');
  const videoSheet = strFromU8(unzipSync(await readFile(downloads.get(videoState.downloadId).filename))['xl/worksheets/sheet1.xml']);
  assert.ok(videoSheet.includes('Video comment: complete text.'));
  assert.ok(videoSheet.includes('Second video comment.'));
  assert.ok(!videoSheet.includes('VIDEO REPLY'));
  console.log('PASS (API simulate): watch/live → apertura Comments → pannello esterno a main → div/listitem → XLSX senza risposte.');

  await popup.locator('#url').fill('https://www.facebook.com/watch/?v=777');
  await popup.locator('#start').click();
  await popup.waitForFunction(() => document.querySelector('#status-label').textContent === 'Raccolta in corso');
  await popup.locator('#stop').click();
  await popup.waitForFunction(() => document.querySelector('#status-label').textContent === 'Operazione interrotta');
  await popup.locator('#show-diagnostics').click();
  const diagnostic = JSON.parse(await popup.locator('#diagnostics').inputValue());
  assert.equal(diagnostic.recognizedRows, 0);
  assert.equal(diagnostic.openerClicked, false);
  console.log('PASS (API simulate): diagnostica consultabile dopo errore, senza testo dei commenti.');
  assert.deepEqual(errors, []);
} catch (error) {
  console.error('Harness state:', JSON.stringify(storage));
  console.error('Browser errors:', errors);
  for (const page of context.pages()) {
    if (page.url().endsWith('/popup.html')) console.error('Popup:', await page.locator('body').innerText());
  }
  throw error;
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
