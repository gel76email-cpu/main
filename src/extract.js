import { postIdentity } from './shared.js';

const ARTICLE = '[role="article"], article';
const COMMENT_LABEL = /^(?:comment(?: by|o di|aire de)|kommentar von|comentario de|reply by|risposta di|r[eé]ponse de)\b/i;
const REPLY_LABEL = /^(?:reply by|risposta di|r[eé]ponse de)\b/i;
const UI_TEXT = /^(?:mi piace|like|reply|rispondi|condividi|share|modificato|edited|mostra altro|altro|see more|visualizza traduzione|see translation|\d+)$/i;

export function ownElements(article, selector) {
  return [...article.querySelectorAll(selector)].filter((node) => node.closest(ARTICLE) === article);
}

function linkUrl(link) {
  try { return new URL(link.getAttribute('href'), 'https://www.facebook.com'); } catch { return null; }
}

function commentLinks(article) {
  return ownElements(article, 'a[href]').filter((link) => {
    const url = linkUrl(link);
    return url && (url.searchParams.has('comment_id') || url.searchParams.has('reply_comment_id'));
  });
}

export function isCommentArticle(article) {
  return COMMENT_LABEL.test(article.getAttribute('aria-label') || '') || commentLinks(article).length > 0;
}

export function isReply(article) {
  if (REPLY_LABEL.test(article.getAttribute('aria-label') || '')) return true;
  if (Number(article.getAttribute('aria-level') || 1) > 1) return true;
  for (let parent = article.parentElement?.closest(ARTICLE); parent; parent = parent.parentElement?.closest(ARTICLE)) {
    if (isCommentArticle(parent)) return true;
  }
  return commentLinks(article).some((link) => {
    const url = linkUrl(link);
    return url.searchParams.has('reply_comment_id') || url.searchParams.has('parent_comment_id');
  });
}

export function readableText(node) {
  function walk(el) {
    if (el.nodeType === 3) return el.nodeValue;
    if (el.nodeType !== 1 || el.matches('script, style, button, [role="button"], [hidden], [aria-hidden="true"]')) return '';
    if (el.tagName === 'IMG') return el.getAttribute('alt') || '';
    if (el.tagName === 'BR') return '\n';
    const text = [...el.childNodes].map(walk).join('');
    return /^(DIV|P|LI)$/.test(el.tagName) ? text + '\n' : text;
  }
  return walk(node).replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function authorLink(article) {
  const anchors = ownElements(article, 'a[href]');
  return anchors.find((link) => {
    const url = linkUrl(link);
    if (!url || !/(^|\.)facebook\.com$/.test(url.hostname)) return false;
    if (url.searchParams.has('comment_id') || url.searchParams.has('reply_comment_id')) return false;
    const path = url.pathname;
    const profile = path === '/profile.php' || /^\/people\/[^/]+\/[^/]+/.test(path)
      || /\/user\/[^/]+/.test(path) || (/^\/[^/]+\/?$/.test(path) && !/\.php$/.test(path));
    const reserved = /^\/(?:photo|watch|reel|share|login|help|stories|groups|hashtag|notifications|friends|home|marketplace)\/?$/;
    const text = readableText(link);
    return profile && !reserved.test(path) && text && !UI_TEXT.test(text);
  });
}

function timestamp(article) {
  const exact = ownElements(article, 'time[datetime], abbr[data-utime]')[0];
  if (exact) {
    const raw = exact.getAttribute('datetime') || Number(exact.getAttribute('data-utime')) * 1000;
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const link = commentLinks(article)[0];
  if (link) {
    const titled = link.hasAttribute('title') ? link : link.querySelector('[title]');
    const title = titled?.getAttribute('title');
    if (title) return title.trim();
    const label = link.getAttribute('aria-label');
    if (label && !/^(?:like|mi piace|reply|rispondi|comment|commento)\b/i.test(label)) return label.trim();
    const text = (link.textContent || '').trim();
    if (text) return text;
  }
  const abbr = ownElements(article, 'abbr[title], time')[0];
  return abbr?.getAttribute('title') || abbr?.textContent?.trim() || '';
}

function bodyText(article, author) {
  const explicit = ownElements(article, '[data-ad-preview="message"], [data-testid="comment_message"]');
  let candidates = explicit.length ? explicit : ownElements(article, '[dir="auto"]');
  candidates = candidates.filter((node) => {
    if (node === author || node.contains(author) || node.closest('a, button, [role="button"]')) return false;
    if (node.querySelector(`${ARTICLE}, a[href*="comment_id="], time, abbr[data-utime]`)) return false;
    return true;
  });
  candidates = candidates.filter((node) => !candidates.some((other) => other !== node && other.contains(node)));
  const body = candidates.map(readableText).filter(Boolean).join('\n');
  if (body) return body;
  // Image/sticker-only comments still occupy a row, without inventing speech text.
  const media = ownElements(article, 'img').filter((img) => !img.closest('a') && !img.closest('button, [role="button"]'));
  return media.map((img) => `[Immagine: ${img.getAttribute('alt') || 'senza descrizione'}]`).join('\n');
}

export function extractComments(root) {
  const rows = [];
  for (const article of root.querySelectorAll(ARTICLE)) {
    if (!isCommentArticle(article) || isReply(article)) continue;
    const author = authorLink(article);
    const username = author ? readableText(author) : '';
    if (!username) continue;
    const text = bodyText(article, author);
    const time = timestamp(article);
    const link = commentLinks(article)[0];
    const id = link && linkUrl(link).searchParams.get('comment_id');
    rows.push({ key: id ? `id:${id}` : `fallback:${username}\u0000${text}\u0000${time}`, username, text, timestamp: time });
  }
  return rows;
}

export function findPostScope(document, postUrl) {
  const id = postIdentity(postUrl);
  const matchesPost = (node) => [...node.querySelectorAll('a[href]')].some((link) => {
    try { return postIdentity(new URL(link.getAttribute('href'), postUrl).href) === id; } catch { return false; }
  });
  const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter((el) => !el.hidden && el.getAttribute('aria-hidden') !== 'true');
  const matchingDialog = dialogs.find(matchesPost);
  if (matchingDialog) return matchingDialog;
  const commentDialogs = dialogs.filter((el) => [...el.querySelectorAll(ARTICLE)].some(isCommentArticle));
  if (commentDialogs.length === 1) return commentDialogs[0];
  const main = document.querySelector('[role="main"], main');
  if (!main) return null;
  const posts = [...main.querySelectorAll(ARTICLE)].filter((el) => !isCommentArticle(el) && !el.parentElement?.closest(ARTICLE));
  const matched = posts.find(matchesPost);
  if (matched) return matched;
  if (posts.length === 1) return posts[0];
  if (posts.length > 1) throw new Error('Sono presenti più post e non riesco a identificare quello richiesto. Apri il permalink del singolo post e riprova.');
  return main;
}

export function isLoadMoreLabel(label) {
  const text = label.replace(/\s+/g, ' ').trim();
  if (/rispost|repl|r[eé]pons/i.test(text)) return false;
  return /^(?:(?:visualizza|vedi|mostra|carica) (?:altri? |pi[uù] |i |\d+ )*(?:commenti)(?: precedenti)?|(?:view|see|load) (?:\d+ )?(?:more|previous) comments)$/i.test(text);
}

export function expandableCommentButtons(root) {
  return [...root.querySelectorAll('button, [role="button"]')].filter((node) => {
    const article = node.closest(ARTICLE);
    return article && isCommentArticle(article) && !isReply(article)
      && !!node.closest('[dir="auto"], [data-ad-preview="message"], [data-testid="comment_message"]')
      && /^(?:mostra altro|altro|see more|visualizza altro)$/i.test(node.textContent.trim());
  });
}
