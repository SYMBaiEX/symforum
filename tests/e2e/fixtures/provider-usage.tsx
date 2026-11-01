import { createRoot } from "react-dom/client";
import { ProviderUsagePanel } from "../../../components/admin/provider-usage-panel";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import { controls } from "./provider-usage-state";
const root = createRoot(document.getElementById("root")!);
const mount = () =>
  root.render(
    <SurfaceScope.Provider value="forum">
      <main
        data-surface="forum"
        className="forum-app-shell min-w-0 bg-background p-4 text-foreground"
        aria-label="Invented provider usage fixture"
      >
        <ProviderUsagePanel />
      </main>
    </SurfaceScope.Provider>,
  );
Object.assign(controls, {
  mount,
  unmount: () => root.render(<p>Fixture panel removed</p>),
});
mount();
