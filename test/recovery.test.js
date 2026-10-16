import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mergeCommentRows } from '../src/checkpoint.js';
import { samePost } from '../src/shared.js';
import { findSortControl, sortChoice, selectAllComments } from '../src/page-controls.js';

test('riconosce lo stesso post dopo il passaggio da videos a watch e ignora tracking e comment_id', () => {
  assert.equal(samePost('https://www.facebook.com/watch/live/?v=123&comment_id=456', 'https://www.facebook.com/demo/videos/123'), true);
  assert.equal(samePost('https://www.facebook.com/watch/?v=999', 'https://www.facebook.com/demo/videos/123'), false);
  assert.equal(samePost('https://www.facebook.com/login/', 'https://www.facebook.com/demo/videos/123'), false);
  assert.equal(samePost('https://evil.test/demo/videos/123', 'https://www.facebook.com/demo/videos/123'), false);
});

test('unisce i checkpoint senza perdere righe e aggiorna i commenti espansi senza duplicarli', () => {
  const first = { key: 'id:1', username: 'Anna', text: 'Prima…', timestamp: '1 h' };
  const second = { key: 'id:2', username: 'Luca', text: 'Seconda', timestamp: '2 h' };
  const saved = mergeCommentRows([first], [second]);
  assert.deepEqual(mergeCommentRows(saved, [{ ...first, text: 'Prima riga completa' }]), [{ ...first, text: 'Prima riga completa' }, second]);
  assert.equal(first.text, 'Prima…');
  assert.throws(() => mergeCommentRows(saved, [{ username: 'Bad' }]), /non validi/);
});

function controls(sticks) {
  const document = new JSDOM('<main><button aria-label="Change comments sorting" aria-haspopup="menu" id="sort"><span>Most relevant</span></button><div role="menu" hidden><div role="button" id="all"><span>All comments</span><div>Show all comments, including spam.</div></div></div></main>').window.document;
  const control = document.querySelector('#sort');
  control.onclick = () => { document.querySelector('[role="menu"]').hidden = false; };
  document.querySelector('#all').onclick = () => {
    document.querySelector('[role="menu"]').hidden = true;
    if (sticks) control.querySelector('span').textContent = 'All comments';
  };
  return document;
}

test('legge il filtro dal testo visibile quando aria-label è generica', () => {
  const document = controls(true);
  assert.equal(findSortControl(document).id, 'sort');
  assert.equal(sortChoice(findSortControl(document)), 'relevant');
});

test('non considera All comments selezionato se il clic non modifica il filtro', async () => {
  const document = controls(false);
  const selected = await selectAllComments(() => document.querySelector('main'), {
    document, visible: (node) => !node.closest('[hidden]'), pause: async () => {},
  });
  assert.equal(selected, false);
  assert.equal(sortChoice(findSortControl(document)), 'relevant');
});

test('verifica il nuovo valore del filtro anche con opzioni role=button e descrizione', async () => {
  const document = controls(true);
  assert.equal(await selectAllComments(() => document.querySelector('main'), {
    document, visible: (node) => !node.closest('[hidden]'), pause: async () => {},
  }), true);
  assert.equal(sortChoice(findSortControl(document)), 'all');
});
