import { postIdentity } from './shared.js';
import { findCommentsOpener } from './page-controls.js';

const ARTICLE = '[role="article"], article';
const ROOT_HINT = '[data-testid^="UFI2Comment/root"], [data-comment-id], [data-commentid], [role="listitem"]';
const COMMENT_LABEL = /^(?:comment(?: by|o di|aire de)|kommentar von|comentario de|reply by|risposta di|r[eé]ponse de)\b/i;
const REPLY_LABEL = /^(?:reply by|risposta di|r[eé]ponse de)\b/i;
const UI_TEXT = /^(?:mi piace|like|reply|rispondi|condividi|share|modificato|edited|mostra altro|altro|see more|visualizza traduzione|see translation|\d+)$/i;

export function ownElements(article, selector, boundaries = new Set()) {
  return [...article.querySelectorAll(selector)].filter((node) => {
    for (let parent = node.parentElement; parent && parent !== article; parent = parent.parentElement) {
      if (parent.matches(`${ARTICLE}, ${ROOT_HINT}`) || boundaries.has(parent)) return false;
    }
    return true;
  });
}

function linkUrl(link) {
  try { return new URL(link.getAttribute('href'), link.ownerDocument.URL === 'about:blank' ? 'https://www.facebook.com' : link.ownerDocument.URL); } catch { return null; }
}

function commentLinks(article, boundaries) {
  return ownElements(article, 'a[href]', boundaries).filter((link) => {
    const url = linkUrl(link);
    return url && url.pathname !== '/profile.php' && (url.searchParams.has('comment_id') || url.searchParams.has('reply_comment_id'));
  });
}

export function isCommentArticle(article) {
  return COMMENT_LABEL.test(article.getAttribute('aria-label') || '') || commentLinks(article).length > 0;
}

export function isReply(article, boundaries) {
  if (REPLY_LABEL.test(article.getAttribute('aria-label') || '')) return true;
  if (Number(article.getAttribute('aria-level') || 1) > 1) return true;
  for (let parent = article.parentElement; parent; parent = parent.parentElement) {
    if (boundaries ? boundaries.has(parent) : parent.matches(ARTICLE) && isCommentArticle(parent)) return true;
  }
  return commentLinks(article, boundaries).some((link) => {
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

function authorLink(article, boundaries) {
  const anchors = ownElements(article, 'a[href]', boundaries);
  return anchors.find((link) => {
    const url = linkUrl(link);
    if (!url || !/(^|\.)facebook\.com$/.test(url.hostname)) return false;
    const path = url.pathname;
    const profile = path === '/profile.php' || /^\/people\/[^/]+\/[^/]+/.test(path)
      || /\/user\/[^/]+/.test(path) || (/^\/[^/]+\/?$/.test(path) && !/\.php$/.test(path));
    const reserved = /^\/(?:photo|watch|reel|share|login|help|stories|groups|hashtag|notifications|friends|home|marketplace)\/?$/;
    const text = readableText(link);
    return profile && !reserved.test(path) && text && !UI_TEXT.test(text);
  });
}

function timestamp(article, boundaries) {
  const exact = ownElements(article, 'time[datetime], [data-utime]', boundaries)[0];
  if (exact) {
    const raw = exact.getAttribute('datetime') || Number(exact.getAttribute('data-utime')) * 1000;
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const link = commentLinks(article, boundaries)[0];
  if (link) {
    const titled = link.hasAttribute('title') ? link : link.querySelector('[title]');
    const title = titled?.getAttribute('title');
    if (title) return title.trim();
    const label = link.getAttribute('aria-label');
    if (label && !/^(?:like|mi piace|reply|rispondi|comment|commento)\b/i.test(label)) return label.trim();
    const text = (link.textContent || '').trim();
    if (text) return text;
  }
  const abbr = ownElements(article, 'abbr[title], time', boundaries)[0];
  if (abbr) return abbr.getAttribute('title') || abbr.textContent.trim();
  // Some video layouts render relative dates as links without a comment permalink.
  const relative = ownElements(article, 'a, [role="link"]', boundaries).find((node) => /^\d+\s*(?:s|sec|min|m|h|d|g|w|wk|sett|y|a)(?:\b|$)/i.test(node.textContent.trim()));
  return relative?.getAttribute('title') || relative?.textContent.trim() || '';
}

function bodyText(article, author, boundaries) {
  const explicit = ownElements(article, '[data-ad-preview="message"], [data-testid="comment_message"]', boundaries);
  let candidates = explicit.length ? explicit : ownElements(article, '[dir="auto"], [dir="ltr"], [dir="rtl"]', boundaries);
  candidates = candidates.filter((node) => {
    if (node === author || node.contains(author) || node.closest('a, button, [role="button"]')) return false;
    if (node.querySelector(`${ARTICLE}, a[href*="comment_id="], time, abbr[data-utime]`)) return false;
    return true;
  });
  candidates = candidates.filter((node) => !candidates.some((other) => other !== node && other.contains(node)));
  const body = candidates.map(readableText).filter(Boolean).join('\n');
  if (body) return body;
  // Image/sticker-only comments still occupy a row, without inventing speech text.
  const media = ownElements(article, 'img', boundaries).filter((img) => !img.closest('a') && !img.closest('button, [role="button"]'));
  return media.map((img) => `[Immagine: ${img.getAttribute('alt') || 'senza descrizione'}]`).join('\n');
}

function includeRoot(root, selector) {
  return [...(root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector)];
}

function commentToken(link) {
  const url = linkUrl(link);
  return url && (url.searchParams.get('reply_comment_id') || url.searchParams.get('comment_id'));
}

function hidden(node) {
  for (let parent = node; parent; parent = parent.parentElement) {
    if (parent.hidden || parent.getAttribute('aria-hidden') === 'true' || parent.style.display === 'none') return true;
  }
  return false;
}

export function commentContainers(root) {
  const candidates = new Set(includeRoot(root, `${ARTICLE}, ${ROOT_HINT}`).filter((node) => !hidden(node) && isCommentArticle(node)));
  // Video sidebars can use plain divs instead of role=article. Start from a
  // comment permalink and find its smallest author + message container.
  for (const link of root.querySelectorAll('a[href*="comment_id="]')) {
    if (hidden(link) || !commentToken(link) || linkUrl(link)?.pathname === '/profile.php') continue;
    let covered = false;
    for (let parent = link.parentElement; parent; parent = parent.parentElement) {
      if (candidates.has(parent) && COMMENT_LABEL.test(parent.getAttribute('aria-label') || '') && authorLink(parent)) { covered = true; break; }
      if (parent === root) break;
    }
    if (covered) continue;
    let node = link.parentElement;
    for (let depth = 0; node && depth < 9 && (node === root || root.contains(node)); depth++, node = node.parentElement) {
      const tokens = new Set(commentLinks(node).map(commentToken).filter(Boolean));
      if (tokens.size > 1) break;
      const author = authorLink(node);
      if (tokens.size === 1 && author && bodyText(node, author)) { candidates.add(node); break; }
      if (node === root) break;
    }
  }
  // Drop broad post wrappers inferred from the same permalink as a smaller row.
  const candidateLinks = new Map([...candidates].map((node) => [node, commentLinks(node)]));
  const byToken = new Map();
  for (const [node, links] of candidateLinks) {
    const token = commentToken(links[0]);
    if (token) { if (!byToken.has(token)) byToken.set(token, []); byToken.get(token).push(node); }
  }
  const result = [...candidates].filter((node) => {
    const links = candidateLinks.get(node);
    if (!COMMENT_LABEL.test(node.getAttribute('aria-label') || '') && new Set(links.map(commentToken)).size > 1) return false;
    return !(byToken.get(commentToken(links[0])) || []).some((other) => {
      if (other === node) return false;
      if (node.contains(other) && !COMMENT_LABEL.test(node.getAttribute('aria-label') || '')) return true;
      return other.contains(node) && COMMENT_LABEL.test(other.getAttribute('aria-label') || '');
    });
  });
  return result.sort((a, b) => a.compareDocumentPosition(b) & 4 ? -1 : 1);
}

export function extractComments(root, postUrl) {
  const rows = [];
  const containers = commentContainers(root);
  const boundaries = new Set(containers);
  const target = postUrl ? postIdentity(postUrl) : '';
  for (const article of containers) {
    if (isReply(article, boundaries)) continue;
    const links = commentLinks(article, boundaries);
    const linkedPost = links.map((link) => postIdentity(linkUrl(link).href)).filter(Boolean);
    if (target && linkedPost.length && !linkedPost.includes(target)) continue;
    const author = authorLink(article, boundaries);
    const username = author ? readableText(author) : '';
    if (!username) continue;
    const text = bodyText(article, author, boundaries);
    const time = timestamp(article, boundaries);
    const link = links[0];
    const id = link && linkUrl(link).searchParams.get('comment_id');
    rows.push({ key: id ? `id:${id}` : `fallback:${username}\u0000${text}\u0000${time}`, username, text, timestamp: time });
  }
  return rows;
}

export function findPostScope(document, postUrl) {
  const id = postIdentity(postUrl);
  const matchesPost = (node) => id && [...node.querySelectorAll('a[href]')].some((link) => {
    try { return postIdentity(new URL(link.getAttribute('href'), postUrl).href) === id; } catch { return false; }
  });
  const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter((el) => !el.hidden && el.getAttribute('aria-hidden') !== 'true');
  const matchingDialog = dialogs.find(matchesPost);
  if (matchingDialog) return matchingDialog;
  const videoDialog = dialogs.find((node) => node.querySelector('video') && findCommentsOpener(node));
  if (videoDialog) return videoDialog;
  const commentDialogs = dialogs.filter((el) => [...el.querySelectorAll(ARTICLE)].some(isCommentArticle));
  if (commentDialogs.length === 1) return commentDialogs[0];
  const roots = commentContainers(document);
  const targetRoots = roots.filter((node) => commentLinks(node).some((link) => postIdentity(linkUrl(link).href) === id));
  const panels = [...document.querySelectorAll('aside, section, [role="complementary"], [role="region"]')]
    .filter((panel) => !panel.hidden && panel.getAttribute('aria-hidden') !== 'true'
      && /^(?:comments|commenti)(?:\b|$)/i.test(panel.getAttribute('aria-label') || ''));
  const panel = panels.find((node) => targetRoots.some((row) => node.contains(row)))
    || (panels.length === 1 && postIdentity(document.URL) === id ? panels[0] : null);
  if (panel) return panel;
  const main = document.querySelector('[role="main"], main');
  if (!main) {
    const external = targetRoots[0]?.closest('[role="dialog"], aside, [role="complementary"], section');
    if (external) return external;
    if (postIdentity(document.URL) === id && document.querySelector('video') && findCommentsOpener(document.body)) return document.body;
    return null;
  }
  const posts = [...main.querySelectorAll(ARTICLE)].filter((el) => !isCommentArticle(el) && !el.parentElement?.closest(ARTICLE));
  const matched = posts.find(matchesPost);
  if (matched) {
    // The video itself and its comment drawer need not share the same article.
    if (targetRoots.some((row) => !matched.contains(row))) {
      const external = targetRoots.find((row) => !main.contains(row));
      return external?.closest('aside, section, [role="complementary"]') || (external ? external.parentElement : main);
    }
    return matched;
  }
  if (posts.length === 1) return posts[0];
  if (posts.length > 1) throw new Error('Sono presenti più post e non riesco a identificare quello richiesto. Apri il permalink del singolo post e riprova.');
  return main;
}

export function isLoadMoreLabel(label) {
  const text = label.replace(/\s+/g, ' ').trim();
  if (/rispost|repl|r[eé]pons/i.test(text)) return false;
  return /^(?:(?:visualizza|vedi|mostra|carica) (?:altri? |pi[uù] |i |\d+ )*(?:commenti)(?: precedenti)?|(?:view|see|load) (?:\d+ )?(?:more|previous) comments)$/i.test(text);
}

export function findLoadMoreControl(root, visible = () => true) {
  const boundaries = new Set(commentContainers(root));
  return [...root.querySelectorAll('button, [role="button"], [role="link"], a[href]')].find((node) => {
    if (!visible(node) || ![node.getAttribute('aria-label'), node.textContent].filter(Boolean).some(isLoadMoreLabel)) return false;
    // A link with this text inside a comment is user content, not pagination.
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      if (boundaries.has(parent)) return false;
      if (parent === root) break;
    }
    return true;
  }) || null;
}

export function expandableCommentButtons(root) {
  const containers = commentContainers(root);
  const boundaries = new Set(containers);
  return [...root.querySelectorAll('button, [role="button"]')].filter((node) => {
    let article = node.parentElement;
    while (article && !boundaries.has(article)) article = article.parentElement;
    return article && !isReply(article, boundaries)
      && !!node.closest('[dir="auto"], [data-ad-preview="message"], [data-testid="comment_message"]')
      && /^(?:mostra altro|altro|see more|visualizza altro)$/i.test(node.textContent.trim());
  });
}

export function layoutDiagnostics(document, scope) {
  const candidates = commentContainers(scope || document);
  return {
    schema: 1,
    pageKind: /\/watch\b/.test(document.location.pathname) ? 'watch' : /\/videos\//.test(document.location.pathname) ? 'video' : 'post',
    roleArticles: document.querySelectorAll(ARTICLE).length,
    commentPermalinks: document.querySelectorAll('a[href*="comment_id="]').length,
    candidates: candidates.length,
    withAuthor: candidates.filter((node) => authorLink(node)).length,
    recognizedRows: extractComments(scope || document).length,
    scope: scope ? { tag: scope.tagName, role: scope.getAttribute('role') || '' } : null,
    frames: document.querySelectorAll('iframe').length,
    // Counts/structural flags only: no names, comments, URLs, cookies or HTML.
    samples: candidates.slice(0, 3).map((node) => ({ tag: node.tagName, role: node.getAttribute('role') || '',
      hasCommentLabel: COMMENT_LABEL.test(node.getAttribute('aria-label') || ''),
      messageBlocks: ownElements(node, '[dir], [data-ad-preview="message"]').length,
      commentLinks: commentLinks(node).length,
    })),
  };
}
