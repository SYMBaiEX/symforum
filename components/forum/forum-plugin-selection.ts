"use client";

import { useSyncExternalStore } from "react";
export const FORUM_BROWSER_CONNECTION_KEY = "symbaiex:forum:browser-connection";
export const FORUM_BROWSER_CONNECTION_EVENT = "symbaiex-forum-agent-connection";

let memorySelection: string | null = null;
let useMemorySelection = false;
export function selectForumBrowserConnection(connectionId: string | null) {
  if (getSelection() === connectionId) return;
  memorySelection = connectionId;
  try {
    if (connectionId)
      window.localStorage.setItem(FORUM_BROWSER_CONNECTION_KEY, connectionId);
    else window.localStorage.removeItem(FORUM_BROWSER_CONNECTION_KEY);
  } catch {
    useMemorySelection = true;
    // Keep the explicit selection in memory when browser storage is unavailable.
  }
  window.dispatchEvent(new Event(FORUM_BROWSER_CONNECTION_EVENT));
}
function getSelection() {
  if (useMemorySelection) return memorySelection;
  try {
    return window.localStorage.getItem(FORUM_BROWSER_CONNECTION_KEY);
  } catch {
    return memorySelection;
  }
}
function subscribe(listener: () => void) {
  window.addEventListener(FORUM_BROWSER_CONNECTION_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(FORUM_BROWSER_CONNECTION_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}
export function useForumBrowserConnectionId() {
  return useSyncExternalStore(subscribe, getSelection, () => null);
}
