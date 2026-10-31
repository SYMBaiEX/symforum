import { createRoot } from "react-dom/client";
import { ForumControlPanel } from "../../../components/forum/forum-control-panel";
import {
  account,
  calls,
  changeProfile,
  update,
} from "./control-panel-drafts-state";
declare global {
  interface Window {
    profileInputsFixture: {
      account: typeof account;
      profile: typeof changeProfile;
      auth: typeof update;
      calls(): { kind: string; owner: string; payload: unknown }[];
      settle(index: number, fail?: boolean): void;
    };
  }
}
window.profileInputsFixture = {
  account,
  profile: changeProfile,
  auth: update,
  calls: () =>
    calls.map(({ kind, owner, payload }) => ({ kind, owner, payload })),
  settle(index, fail = false) {
    if (fail) calls[index].reject();
    else calls[index].resolve();
  },
};
createRoot(document.getElementById("root")!).render(
  <ForumControlPanel enabled />,
);
