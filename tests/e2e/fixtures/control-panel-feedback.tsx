import { createRoot } from "react-dom/client";
import { ForumControlPanel } from "../../../components/forum/forum-control-panel";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import {
  account,
  calls,
  reports,
  trust,
  update,
} from "./control-panel-feedback-state";

declare global {
  interface Window {
    controlPanelFeedback: {
      account: typeof account;
      update: typeof update;
      trust: typeof trust;
      settle(index: number, fail?: boolean): void;
      calls(): { owner: string; payload: unknown }[];
      reports(): string[];
    };
  }
}
window.controlPanelFeedback = {
  account,
  update,
  trust,
  settle(index, fail = false) {
    if (fail) calls[index].reject();
    else calls[index].resolve();
  },
  calls: () => calls.map(({ owner, payload }) => ({ owner, payload })),
  reports: () => reports,
};
createRoot(document.getElementById("root")!).render(
  <SurfaceScope.Provider value="forum">
    <main
      className="forum-app-shell bg-background text-foreground"
      data-surface="forum"
    >
      <div className="forum-surface">
        <ForumControlPanel enabled />
      </div>
    </main>
  </SurfaceScope.Provider>,
);
