import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { extractComments, findPostScope, isLoadMoreLabel, expandableCommentButtons, layoutDiagnostics } from '../src/extract.js';
import { parsePostUrl, postIdentity } from '../src/shared.js';
import { findCommentsOpener, isCommentsOpener } from '../src/page-controls.js';

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

const videoUrl = 'https://www.facebook.com/watch/live/?v=1996968627664961';
const videoFixture = readFileSync(new URL('./fixtures/video.html', import.meta.url), 'utf8');
test('accetta watch/live e watch preservando v e riconosce lo stesso video', () => {
  assert.equal(parsePostUrl(`${videoUrl}&ref=watch_permalink`), videoUrl);
  assert.equal(parsePostUrl('https://www.facebook.com/watch/?v=1996968627664961'), 'https://www.facebook.com/watch/?v=1996968627664961');
  assert.equal(postIdentity(videoUrl), postIdentity('https://www.facebook.com/demo/videos/1996968627664961/'));
  assert.throws(() => parsePostUrl('https://www.facebook.com/watch/'));
});

test('il controllo Comments apre il pannello, senza selezionare Comment o risposte', () => {
  const document = new JSDOM(videoFixture, { url: videoUrl }).window.document;
  const scope = findPostScope(document, videoUrl);
  assert.equal(findCommentsOpener(scope).id, 'open-comments');
  assert.equal(extractComments(document).length, 0, 'i commenti nel pannello nascosto non sono visibili');
  for (const label of ['Comments', '699 Comments', 'Commenti (699)', 'View comments', 'All comments', 'Mostra commenti']) assert.ok(isCommentsOpener(label), label);
  for (const label of ['Comment', 'Commenta', 'Publish comment', 'View more replies', 'Reply', 'Rispondi']) assert.equal(isCommentsOpener(label), false, label);
});

test('trova i commenti video in un pannello esterno a main senza role=article', () => {
  const document = new JSDOM(videoFixture, { url: videoUrl }).window.document;
  document.querySelector('aside').hidden = false;
  const scope = findPostScope(document, videoUrl);
  assert.equal(scope.tagName, 'ASIDE');
  const rows = extractComments(scope, videoUrl);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].username, 'Anna Rossi');
  assert.equal(rows[0].timestamp, '1 d');
  assert.equal(expandableCommentButtons(scope)[0].id, 'video-expand');
  assert.ok(!JSON.stringify(rows).includes('VIDEO REPLY'));
});

test('apre il pannello anche nel lettore video senza landmark main', () => {
  const document = new JSDOM('<div role="dialog"><video></video><button aria-label="Comments">699</button></div>', { url: videoUrl }).window.document;
  assert.equal(findPostScope(document, videoUrl).getAttribute('role'), 'dialog');
});

test('include il contenitore passato come root e scarta commenti di altri video', () => {
  const document = documentFor('<div role="article" aria-label="Comment by Ana"><a href="/ana">Ana</a><div dir="auto">Ciao</div><a href="/demo/posts/12345?comment_id=5">2 h</a></div>');
  assert.equal(extractComments(document.querySelector('[role="article"]'), url).length, 1);
  assert.equal(extractComments(document, videoUrl).length, 0);
});

test('diagnostica composta da conteggi e struttura, senza dati dei commentatori', () => {
  const document = new JSDOM(videoFixture, { url: videoUrl }).window.document;
  document.querySelector('aside').hidden = false;
  const diagnostic = layoutDiagnostics(document, document.querySelector('aside'));
  assert.equal(diagnostic.pageKind, 'watch');
  assert.equal(diagnostic.recognizedRows, 1);
  const serialized = JSON.stringify(diagnostic);
  for (const text of ['Anna', 'Reply Author', 'Video comment', '1996968627664961', 'https://']) assert.ok(!serialized.includes(text), text);
});

test('legge 699 commenti da div semplici ed esclude le risposte senza inglobare la lista', () => {
  const html = Array.from({ length: 699 }, (_, index) => `<div><a href="/person.${index}">Autore ${index}</a><div dir="auto">Testo ${index}</div><a href="/watch/live/?v=1996968627664961&amp;comment_id=${index + 1}">1 h</a></div>`).join('');
  const document = new JSDOM(`<main role="main">${html}<div><a href="/reply">Risposta</a><div dir="auto">DA ESCLUDERE</div><a href="/watch/live/?v=1996968627664961&amp;comment_id=1&amp;reply_comment_id=1000">2 h</a></div></main>`, { url: videoUrl }).window.document;
  const rows = extractComments(document.querySelector('main'), videoUrl);
  assert.equal(rows.length, 699);
  assert.equal(new Set(rows.map((row) => row.key)).size, 699);
  assert.equal(rows[0].username, 'Autore 0');
  assert.equal(rows.at(-1).text, 'Testo 698');
});
