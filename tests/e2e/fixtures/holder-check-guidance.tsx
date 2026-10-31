import { createRoot } from "react-dom/client";
import type { ComponentType } from "react";
import * as Community from "../../../components/community/community-hub";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import styles from "../../../components/community/community-hub.module.css";
import { client } from "./holder-check-guidance-state";
// Build-only private export executes the unchanged real Support/Settings flow.
const Support = (
  Community as unknown as {
    HolderGuidanceSupport: ComponentType<{
      client: typeof client;
      compact: boolean;
      onPayment(): void;
    }>;
  }
).HolderGuidanceSupport;
createRoot(document.getElementById("root")!).render(
  <SurfaceScope.Provider value="forum">
    <ForumRuntimeContext.Provider value={{ host: "website" }}>
      <main
        data-surface="forum"
        className="forum-app-shell bg-background text-foreground"
        style={{ height: "100dvh", overflow: "auto" }}
      >
        <section className={styles.hub}>
          <Support
            client={client}
            compact={false}
            onPayment={() => {
              throw new Error("Payment callback denied");
            }}
          />
        </section>
      </main>
    </ForumRuntimeContext.Provider>
  </SurfaceScope.Provider>,
);
