import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { extractComments, findPostScope, isLoadMoreLabel, expandableCommentButtons } from '../src/extract.js';
import { parsePostUrl } from '../src/shared.js';

const url = 'https://www.facebook.com/demo/posts/12345';
const fixture = readFileSync(new URL('./fixtures/post.html', import.meta.url), 'utf8');
const documentFor = (html) => new JSDOM(html, { url }).window.document;

test('normalizza i permalink e rimuove parametri estranei', () => {
  assert.equal(parsePostUrl('http://m.facebook.com/demo/posts/12345?comment_id=77&fbclid=tracking#here'), url);
  assert.equal(parsePostUrl('https://facebook.com/permalink.php?story_fbid=123&id=456'), 'https://www.facebook.com/permalink.php?story_fbid=123&id=456');
  assert.equal(parsePostUrl('https://facebook.com/groups/test/posts/12345/'), 'https://www.facebook.com/groups/test/posts/12345/');
});

test('rifiuta host estranei, link di profilo e link brevi non risolti', () => {
  for (const input of ['javascript:alert(1)', 'https://facebook.com.evil.test/a/posts/1', 'https://facebook.com/me', 'https://www.facebook.com/share/p/abc', 'https://user:pass@facebook.com/a/posts/1', 'https://facebook.com:8443/a/posts/1']) {
    assert.throws(() => parsePostUrl(input));
  }
});

test('estrae solo commenti principali ed esclude risposte annidate e piatte', () => {
  const document = documentFor(fixture);
  const rows = extractComments(findPostScope(document, url));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.username), ['Anna Rossi', 'Luca Verdi']);
  assert.equal(rows[0].timestamp, '2026-10-15T08:30:00.000Z');
  assert.equal(rows[1].timestamp, 'giovedì 15 ottobre 2026 alle ore 10:45');
  assert.equal(rows[1].text, '=HYPERLINK("https://example.com")\nSeconda riga');
  assert.ok(!JSON.stringify(rows).includes('DA ESCLUDERE'));
});

test('non filtra commenti legittimi numerici o uguali a un comando UI', () => {
  for (const text of ['123', 'Mi piace', 'Like', 'Altro']) {
    const document = documentFor(`<div role="article" aria-label="Comment by Ana"><a href="/ana">Ana</a><div dir="auto">${text}</div><a href="/demo/posts/12345?comment_id=1">3 h</a></div>`);
    assert.equal(extractComments(document)[0].text, text);
  }
});

test('mantiene il timestamp relativo e i commenti senza timestamp', () => {
  const document = documentFor(`<div role="article" aria-label="Comment by Ana"><a href="/ana">Ana</a><div dir="auto">Ciao</div><a href="/demo/posts/12345?comment_id=1">3 h</a></div><div role="article" aria-label="Commento di Bea"><a href="/bea">Bea</a><div dir="auto">Salve</div></div>`);
  assert.deepEqual(extractComments(document).map((row) => row.timestamp), ['3 h', '']);
});

test('scarta risposte identificate da etichetta e livello accessibile', () => {
  const document = documentFor(`<div role="article" aria-label="Reply by Ana"><a href="/ana">Ana</a><div dir="auto">Reply</div></div><div role="article" aria-label="Comment by Bea" aria-level="2"><a href="/bea">Bea</a><div dir="auto">Reply</div></div>`);
  assert.equal(extractComments(document).length, 0);
});

test('commenti identici con ID distinti rimangono righe distinte', () => {
  const html = [1, 2].map((id) => `<div role="article" aria-label="Comment by Ana"><a href="/ana">Ana</a><div dir="auto">Ciao</div><a href="?comment_id=${id}">1 h</a></div>`).join('');
  const rows = extractComments(documentFor(html));
  assert.equal(new Map(rows.map((row) => [row.key, row])).size, 2);
});

test('isola il post richiesto dai post suggeriti e rifiuta ambiguità', () => {
  const document = documentFor(fixture);
  document.querySelector('main').insertAdjacentHTML('beforeend', '<article><a href="/other/posts/999">Altro post</a><div role="article" aria-label="Comment by Estraneo"><a href="/estraneo">Estraneo</a><div dir="auto">Non esportare</div></div></article>');
  assert.equal(extractComments(findPostScope(document, url)).length, 2);
  assert.throws(() => findPostScope(document, 'https://www.facebook.com/demo/posts/000'), /più post/);
});

test('espansione del testo e caricamento non selezionano risposte o menu', () => {
  const document = documentFor(fixture);
  assert.deepEqual(expandableCommentButtons(document).map((node) => node.id), ['expand']);
  for (const label of ['Visualizza altri commenti', 'Visualizza altri 50 commenti', 'View more comments', 'View 10 more comments', 'Visualizza i commenti precedenti']) assert.ok(isLoadMoreLabel(label), label);
  for (const label of ['Visualizza 5 risposte', 'View more replies', 'Mi piace', 'Condividi']) assert.equal(isLoadMoreLabel(label), false, label);
});

test('usa alt delle emoji e rappresenta commenti con sole immagini', () => {
  const document = documentFor(`<div role="article" aria-label="Comment by Ana"><a href="/ana">Ana</a><div dir="auto">Ciao <img alt="😊"></div></div><div role="article" aria-label="Comment by Bea"><a href="/bea">Bea</a><img alt="Una foto di un gatto"></div>`);
  assert.deepEqual(extractComments(document).map((row) => row.text), ['Ciao 😊', '[Immagine: Una foto di un gatto]']);
});
