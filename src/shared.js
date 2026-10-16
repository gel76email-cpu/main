export const STATE_KEY = 'exportState';
export const ACTIVE_STATUSES = ['opening', 'collecting', 'exporting'];

export function parsePostUrl(input) {
  let url;
  try { url = new URL(input.trim()); } catch { throw new Error('Inserisci un link Facebook valido.'); }
  if (!['facebook.com', 'www.facebook.com', 'm.facebook.com', 'mbasic.facebook.com', 'web.facebook.com'].includes(url.hostname)
      || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) {
    throw new Error('Usa un link diretto a un post su facebook.com.');
  }
  const pathPost = /\/(?:posts|permalink|videos|reel)\/[^/]+/.test(url.pathname);
  const queryPost = /\/(?:story|permalink|photo)\.php$/.test(url.pathname)
    && (url.searchParams.has('story_fbid') || url.searchParams.has('fbid'));
  const photo = /^\/photo\/?$/.test(url.pathname) && url.searchParams.has('fbid');
  const watch = /^\/watch(?:\/live)?\/?$/.test(url.pathname) && /^\d+$/.test(url.searchParams.get('v') || '');
  if (!pathPost && !queryPost && !photo && !watch) {
    throw new Error('Serve il permalink del post: apri il post e copia il link dalla data. I link brevi /share/ non sono supportati.');
  }
  url.protocol = 'https:';
  url.hostname = 'www.facebook.com';
  url.hash = '';
  for (const name of [...url.searchParams.keys()]) {
    if (!['id', 'story_fbid', 'fbid', 'set', 'v'].includes(name)) url.searchParams.delete(name);
  }
  return url.href;
}

export function postIdentity(input) {
  const url = new URL(input);
  return url.searchParams.get('story_fbid') || url.searchParams.get('fbid') || url.searchParams.get('v')
    || url.pathname.match(/\/(?:posts|permalink|videos|reel)\/([^/]+)/)?.[1] || '';
}
