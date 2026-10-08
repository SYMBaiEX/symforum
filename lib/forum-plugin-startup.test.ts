import { runInNewContext } from "node:vm";
import { describe, expect, test, vi } from "vitest";
import { FORUM_PLUGIN_STARTUP_JS } from "./forum-plugin-startup";
import { FORUM_PLUGIN_APP_HTML } from "./forum-plugin-app";

function startup() {
  const mount = { childElementCount: 0, rendered: false, querySelector: () => mount.rendered ? {} : null };
  const fallback = { remove: vi.fn(), dataset: {} as Record<string, string> };
  const status = { textContent: "Opening your forum…" };
  const elements = { "forum-native-app": mount, "forum-app-startup": fallback, "forum-startup-status": status };
  const window = new EventTarget();
  let timer = () => {};
  let changed = () => {};
  const disconnect = vi.fn();
  runInNewContext(FORUM_PLUGIN_STARTUP_JS, {
    window,
    document: { getElementById: (id: keyof typeof elements) => elements[id] },
    setTimeout: (callback: () => void) => { timer = callback; return 1; },
    clearTimeout: vi.fn(),
    MutationObserver: class {
      constructor(callback: () => void) { changed = callback; }
      observe() {}
      disconnect = disconnect;
    },
  });
  return { mount, fallback, status, disconnect, window, expire: () => timer(), changed: () => changed() };
}
describe("forum startup resilience", () => {
  test("ships a visible status and website escape route before any application script", () => {
    expect(FORUM_PLUGIN_APP_HTML.indexOf('id="forum-app-startup"')).toBeLessThan(FORUM_PLUGIN_APP_HTML.indexOf("<script>"));
    expect(FORUM_PLUGIN_APP_HTML).toContain('id="forum-startup-status" role="status"');
    expect(FORUM_PLUGIN_APP_HTML).toContain('href="https://forum.symbaiex.com/"');
  });
  test("preserves a visible fallback when startup throws or never finishes", () => {
    for (const mode of ["error", "timeout"] as const) {
      const fixture = startup();
      if (mode === "error") fixture.window.dispatchEvent(new Event("error"));
      else fixture.expire();
      expect(fixture.status.textContent).toContain("could not start");
      expect(fixture.fallback.dataset.startup).toBe("failed");
      expect(fixture.fallback.remove).not.toHaveBeenCalled();
      fixture.mount.childElementCount = 1;
      fixture.mount.rendered = true;
      fixture.changed();
      expect(fixture.fallback.remove).toHaveBeenCalledOnce();
      expect(fixture.disconnect).toHaveBeenCalledOnce();
    }
  });
  test("does not erase the fallback for an incomplete or empty React container", () => {
    const fixture = startup();
    fixture.mount.childElementCount = 1;
    fixture.changed();
    fixture.expire();
    expect(fixture.fallback.remove).not.toHaveBeenCalled();
    expect(fixture.status.textContent).toContain("could not start");
  });
  test("removes the fallback once React mounts and ignores later content errors", () => {
    const fixture = startup();
    fixture.mount.childElementCount = 1;
    fixture.mount.rendered = true;
    fixture.changed();
    fixture.window.dispatchEvent(new Event("error"));
    expect(fixture.fallback.remove).toHaveBeenCalledOnce();
    expect(fixture.status.textContent).toBe("Opening your forum…");
    expect(fixture.disconnect).toHaveBeenCalledOnce();
  });
});
