/** Visible before React runs, including when the host blocks or rejects a script. */
export const FORUM_PLUGIN_STARTUP_HTML = `<section id="forum-app-startup" data-forum-startup-runtime="2.2.3" aria-labelledby="forum-startup-title" style="max-width:34rem;margin:8vh auto;padding:24px;font-family:var(--font-geist-sans,system-ui);color:hsl(var(--foreground,0 0% 98%));background:hsl(var(--card,0 0% 8%));border-radius:12px"><h1 id="forum-startup-title" style="font-size:20px;margin:0 0 12px">SYMBaiEX Forum</h1><p id="forum-startup-status" role="status">Opening your forum · 2.2.3…</p><a href="https://forum.symbaiex.com/" target="_blank" rel="noopener noreferrer" style="color:hsl(var(--accent,320 100% 50%))">Open the forum website</a></section>`;

/** Independent of the application bundle so startup errors cannot erase the fallback. */
export const FORUM_PLUGIN_STARTUP_JS = `(() => {
  const mount = document.getElementById("forum-native-app");
  const fallback = document.getElementById("forum-app-startup");
  const status = document.getElementById("forum-startup-status");
  if (!mount || !fallback || !status) return;
  let finished = false;
  const cleanup = () => {
    clearTimeout(timer);
    observer.disconnect();
    window.removeEventListener("error", fail, true);
    window.removeEventListener("unhandledrejection", fail);
  };
  const rendered = () => {
    if (!mount.querySelector("[data-forum-app-rendered]")) return false;
    finished = true;
    cleanup();
    fallback.remove();
    return true;
  };
  const fail = () => {
    if (finished || rendered()) return;
    clearTimeout(timer);
    status.textContent = "The app could not start. Reopen this view, or use the forum website.";
    fallback.dataset.startup = "failed";
  };
  const observer = new MutationObserver(rendered);
  observer.observe(mount, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-forum-app-rendered"] });
  const timer = setTimeout(fail, 10000);
  window.addEventListener("error", fail, true);
  window.addEventListener("unhandledrejection", fail);
  rendered();
})();`;
