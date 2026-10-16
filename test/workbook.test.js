import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { JSDOM } from 'jsdom';
import { createWorkbook, workbookDataUrl } from '../src/workbook.js';

const info = { url: 'https://www.facebook.com/a/posts/1', exportedAt: '2026-10-15T12:00:00.000Z', allSelected: false, reason: 'Interrotta manualmente' };
const parse = (bytes) => new JSDOM(strFromU8(bytes), { contentType: 'text/xml' }).window.document;

test('genera un vero XLSX con tre colonne, metadati e XML valido', () => {
  const rows = [{ username: 'Zoë & <Ana>', text: '=SUM(1,2)\n"Ciao" 😊\u0001', timestamp: '2 h' }];
  const bytes = createWorkbook(rows, info);
  assert.equal(String.fromCharCode(...bytes.slice(0, 2)), 'PK');
  const files = unzipSync(bytes);
  assert.equal(Object.keys(files).length, 7);
  for (const bytes of Object.values(files)) assert.ok(parse(bytes));
  const sheet = parse(files['xl/worksheets/sheet1.xml']);
  assert.deepEqual([...sheet.querySelectorAll('row:first-child t')].map((node) => node.textContent), ['Username', 'Testo del commento', 'Timestamp']);
  assert.equal(sheet.querySelector('c[r="A2"] t').textContent, rows[0].username);
  assert.equal(sheet.querySelector('c[r="B2"] t').textContent, '=SUM(1,2)\n"Ciao" 😊');
  assert.equal(sheet.querySelector('c[r="B2"]').getAttribute('t'), 'inlineStr');
  assert.equal(sheet.querySelectorAll('f').length, 0);
  assert.equal(sheet.querySelector('autoFilter').getAttribute('ref'), 'A1:C2');
  const metadata = parse(files['xl/worksheets/sheet2.xml']).documentElement.textContent;
  assert.ok(metadata.includes('Interrotta manualmente'));
  assert.ok(metadata.includes('Non verificato'));
  const decoded = Buffer.from(workbookDataUrl(bytes).split(',')[1], 'base64');
  assert.deepEqual(decoded, Buffer.from(bytes));
});

test('non tronca silenziosamente commenti più lunghi del limite Excel', () => {
  assert.throws(() => createWorkbook([{ username: 'Ana', text: 'a'.repeat(32768), timestamp: '' }], info), /32.767/);
});
