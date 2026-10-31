import { createRoot } from "react-dom/client";
import { ForumControlPanel } from "../../../components/forum/forum-control-panel";
import { account, calls, changePreferences, changeProfile, reads, update } from "./control-panel-drafts-state";
declare global {
  interface Window {
    controlPanelDraftsFixture: {
      account: typeof account;
      profile: typeof changeProfile;
      preferences: typeof changePreferences;
      auth: typeof update;
      settle(index: number, fail?: boolean): void;
      calls(): { kind: string; owner: string; payload: unknown }[];
      readCount(): number;
    };
  }
}
window.controlPanelDraftsFixture = { account, profile: changeProfile, preferences: changePreferences, auth: update, settle(index, fail = false) { if (fail) calls[index].reject(); else calls[index].resolve(); }, calls: () => calls.map(({ kind, owner, payload }) => ({ kind, owner, payload })), readCount: () => reads.length };
createRoot(document.getElementById("root")!).render(<ForumControlPanel enabled />);
