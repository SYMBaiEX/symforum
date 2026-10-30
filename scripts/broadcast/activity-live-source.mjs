import { ConvexClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';

export const ACTIVITY_URL = 'https://strong-bee-384.convex.cloud';
export const ACTIVITY_QUERY = 'broadcastActivityLive:liveActivity';

/** Anonymous official read subscription. No auth, writes, inference or transport polling. */
export function start(root, options = {}) {
  const Client = options.Client || ConvexClient;
  const doc = options.document || document;
  const project = options.project || globalThis.SymfDesk.projectLive;
  let client, unsubscribe, connection, stopped = false, generation = 0, latest = null, queryFailed = false;
  function state(value) {
    root.dataset.activityConnection = value;
    root.dispatchEvent(new CustomEvent('symf:activity-connection', { detail: value }));
  }
  function stopConnection() {
    generation++;
    unsubscribe?.(); connection?.(); unsubscribe = null; connection = null;
    const previous = client; client = null; latest = null;
    if (previous) void previous.close().catch(() => {});
  }
  function connect() {
    if (stopped || doc.hidden || client) return;
    const token = ++generation;queryFailed = false;
    state('connecting');
    client = new Client(ACTIVITY_URL, { logger: false, unsavedChangesWarning: false });
    const current = client;
    connection = current.subscribeToConnectionState(s => {
      if (stopped || token !== generation) return;
      state(!s.isWebSocketConnected ? 'reconnecting' : queryFailed ? 'unavailable' : latest ? 'live' : 'connecting');
    });
    unsubscribe = current.onUpdate(makeFunctionReference(ACTIVITY_QUERY), {}, snapshot => {
      if (stopped || token !== generation) return;
      const safe = project(snapshot);
      if (!safe) { latest = null; queryFailed = true; state('unavailable'); return; }
      latest = safe; queryFailed = false;
      root.dispatchEvent(new CustomEvent('symf:activity-feed', { detail: safe }));
      state(current.connectionState().isWebSocketConnected ? 'live' : 'reconnecting');
    }, () => { if (token === generation && !stopped) { latest = null; queryFailed = true; state('unavailable'); } });
  }
  function visibility() {
    if (doc.hidden) { stopConnection(); state('paused'); } else connect();
  }
  const close = () => {
    stopped = true; stopConnection();
    doc.removeEventListener('visibilitychange', visibility);
    globalThis.removeEventListener?.('pagehide', close);
  };
  doc.addEventListener('visibilitychange', visibility);
  globalThis.addEventListener?.('pagehide', close, { once: true });
  try { connect(); } catch { stopConnection(); state('unavailable'); }
  return close;
}

if (typeof window !== 'undefined') window.SymfLiveActivity = { start };
