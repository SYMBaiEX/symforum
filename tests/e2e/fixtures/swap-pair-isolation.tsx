import { createRoot } from "react-dom/client";
import { TokenSwap } from "../../../components/swap/token-swap";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import styles from "../../../components/trading/forum-terminal.module.css";
createRoot(document.getElementById("root")!).render(
  <SurfaceScope.Provider value="forum">
    <ForumRuntimeContext.Provider value={{ host: "website" }}>
      <main
        data-surface="forum"
        className="forum-app-shell bg-background text-foreground"
        style={{
          height: "100dvh",
          overflow: "auto",
          containerType: "inline-size",
        }}
      >
        <aside className={styles.aside}>
          <div className={styles.body}>
            <TokenSwap />
          </div>
        </aside>
      </main>
    </ForumRuntimeContext.Provider>
  </SurfaceScope.Provider>,
);
