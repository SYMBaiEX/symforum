import '../../apps/forum/public/broadcast/feed.js';
import '../../apps/forum/public/broadcast/token.js';
import '../../apps/forum/public/broadcast/desk.js';

const feed = globalThis.SymfForumFeed;
const KEY = 'public-agent-feed-v2';
const TOKEN_KEY = 'official-token-v1';
const token = globalThis.SymfToken;
const desk = globalThis.SymfDesk;
const headers = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
const json = (value, status = 200) => Response.json(value, { status, headers: { ...headers, 'Cache-Control': status === 200 ? 'public, max-age=30, s-maxage=30' : 'no-store' } });

export async function refresh(env, fetcher = fetch) {
  // Same cache write and unchanged five-minute lane. No credentials or models.
  const activity = await desk.load(fetcher).catch(() => null);
  try {
    const snapshot = await feed.load(fetcher);
    if (!feed.validSnapshot(snapshot)) throw new Error('Invalid public snapshot');
    await env.FORUM_FEED.put(KEY, JSON.stringify({ ...snapshot, activity }), { expirationTtl: 1200 });
    console.log(JSON.stringify({ event: 'public_feed_refreshed', itemCount: snapshot.items.length }));
    return snapshot;
  } catch {
    await env.FORUM_FEED.put(KEY, JSON.stringify({ items: [], refreshedAt: 0, mode: 'unavailable', activity }), { expirationTtl: 1200 });
    console.error(JSON.stringify({ event: 'public_feed_unavailable' }));
    return null;
  }
}

export async function refreshToken(env, fetcher = fetch) {
  let quote, reason = null, retryAfterAt, previous;
  try { previous = await env.FORUM_FEED.get(TOKEN_KEY, 'json'); } catch { previous = null; }
  if (Number.isFinite(previous?.retryAfterAt) && previous.retryAfterAt > Date.now() && previous.retryAfterAt <= Date.now() + 86400000) {
    console.log(JSON.stringify({ event: 'official_token_refreshed', status: token.valid(previous) ? 'cached' : 'unavailable', reason: 'provider_backoff' }));
    return previous;
  }
  try { quote = await token.load(fetcher); } catch (error) {
    // Fixed classifications only: no raw provider bodies, URLs or exception text in logs.
    reason = error?.code === 'provider_http' && Number.isInteger(error.status) && error.status >= 100 && error.status <= 599
      ? 'provider_http_' + error.status
      : ['provider_invalid_json', 'provider_response_too_large'].includes(error?.code) ? error.code
      : error?.name === 'AbortError' ? 'provider_timeout' : 'provider_network';
    if (reason === 'provider_http_429' && Number.isFinite(error.retryAfterAt) && error.retryAfterAt > Date.now() && error.retryAfterAt <= Date.now() + 86400000) retryAfterAt = error.retryAfterAt;
    quote = token.unavailable();
  }
  if (!token.valid(quote)) {
    quote = token.unavailable();
    // A transport outage must not erase a still-valid last observation. Never advance its
    // fetchedAt, extend the 10-minute freshness gate, or cache known-invalid token identity.
    if (reason) {
      if (token.valid(previous)) quote = { ...previous, refreshFailedAt: Date.now() };
    }
    reason ||= 'provider_no_eligible_quote';
  }
  if (retryAfterAt) quote = { ...quote, retryAfterAt };
  await env.FORUM_FEED.put(TOKEN_KEY, JSON.stringify(quote), { expirationTtl: 900 });
  console.log(JSON.stringify({ event: 'official_token_refreshed', status: quote.refreshFailedAt ? 'cached' : quote.status, ...(reason ? { reason } : {}) }));
  return quote;
}

export function scheduledLanes(event) {
  if (!Number.isFinite(event.scheduledTime) || event.scheduledTime <= 0) return { forum: false, token: false };
  // Keep the previous trigger functional while Cloudflare propagates the new one.
  if (event.cron === '*/5 * * * *') return { forum: true, token: true };
  if (event.cron !== '* * * * *') return { forum: false, token: false };
  const minute = new Date(event.scheduledTime).getUTCMinutes();
  return { forum: minute % 5 === 0, token: minute % 3 === 0 };
}

export async function refreshScheduled(event, env, fetcher = fetch) {
  const lanes = scheduledLanes(event);
  await Promise.all([
    ...(lanes.forum ? [refresh(env, fetcher)] : []),
    ...(lanes.token ? [refreshToken(env, fetcher)] : []),
  ]);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/program/') return Response.redirect(url.origin + '/program', 308);
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } });
    if (url.pathname === '/api/token') {
      let quote;
      try { quote = await env.FORUM_FEED.get(TOKEN_KEY, { type: 'json', cacheTtl: 30 }); } catch { quote = null; }
      return token.valid(quote) ? json(quote) : json(token.unavailable(), 503);
    }
    if (url.pathname === '/api/feed' || url.pathname === '/api/activity' || url.pathname === '/health') {
      let snapshot;
      try { snapshot = await env.FORUM_FEED.get(KEY, 'json'); } catch { snapshot = null; }
      const ready = feed.validSnapshot(snapshot);
      if (url.pathname === '/api/activity') {
        const activity = desk.project(snapshot?.activity);
        return activity ? json(activity) : json({ status: 'unavailable' }, 503);
      }
      if (url.pathname === '/health') return json({ status: ready ? 'ready' : 'holding', feed: { refreshedAt: ready ? snapshot.refreshedAt : null, itemCount: ready ? snapshot.items.length : 0 }, publishing: false, encoder: 'external-laptop' }, ready ? 200 : 503);
      return ready ? json({ items: snapshot.items, refreshedAt: snapshot.refreshedAt, mode: snapshot.mode, policy: snapshot.policy }) : json({ items: [], refreshedAt: 0, mode: 'unavailable' }, 503);
    }
    const allowed = new Set(['/feed.js', '/token.js', '/desk.js', '/activity-live.js', '/studio.js', '/studio.css', '/assets/daybreak.jpg', '/assets/nightwatch.jpg', '/assets/harbor.jpg', '/assets/shadowgate.jpg', '/assets/forum-logo.png']);
    const page = ['/', '/index.html', '/program', '/program/'].includes(url.pathname);
    if (!page && !allowed.has(url.pathname)) return new Response('Not found', { status: 404, headers });
    const target = new URL(page ? '/index.html' : url.pathname, url.origin);
    const asset = await env.ASSETS.fetch(new Request(target, { method: request.method }));
    const response = new Response(asset.body, asset);
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    if (!page || request.method === 'HEAD') return response;
    response.headers.set('Cache-Control', 'no-store');
    const program = url.pathname.startsWith('/program');
    return new HTMLRewriter().on('#symf-anime-broadcast', {
      element(element) {
        element.setAttribute('data-feed-endpoint', '/api/feed');
        element.setAttribute('data-activity-endpoint', '/api/activity');
        if (program) { element.setAttribute('data-program', 'true'); element.setAttribute('class', 'an-program'); }
      },
    }).transform(response);
  },
  async scheduled(event, env) { await refreshScheduled(event, env); },
};
