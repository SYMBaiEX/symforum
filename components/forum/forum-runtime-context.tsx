"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { ForumAttachmentDraft } from "./forum-compose";
import type { ForumPluginIdentity } from "./forum-plugin-refs";

/** UI is shared; only authentication and transport differ between hosts. */
export type ForumRuntime = {
  host: "website" | "plugin";
  routeHash?: string;
  actingAs?: ForumPluginIdentity | null;
  executionMode?: "direct" | "review";
  capabilities?: readonly string[];
  uploadFiles?: (files: File[]) => Promise<ForumAttachmentDraft[]>;
};
export const ForumRuntimeContext = createContext<ForumRuntime>({
  host: "website",
});
export function useForumRuntime() {
  return useContext(ForumRuntimeContext);
}

export function useForumHash() {
  const runtime = useForumRuntime();
  const [hash, setHash] = useState("");
  useEffect(() => {
    const sync = () => setHash(window.location.hash);
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  return runtime.host === "plugin" ? (runtime.routeHash ?? "") : hash;
}
