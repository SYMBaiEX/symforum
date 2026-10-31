import { createRoot } from "react-dom/client";
import { ForumFeedList } from "../../../components/forum/forum-feed-list";
import {
  readingPlace,
  saveReadingPlace,
} from "../../../components/forum/forum-feed-reading-state";
import { calls, update, useStateSnapshot } from "./forum-feed-state";
import type { ForumFeedPage } from "../../../components/forum/forum-feed-refs";

function App() {
  const state = useStateSnapshot();
  return state.mounted ? (
    <ForumFeedList sort="active" communityOnly={false} />
  ) : null;
}
function page(prefix: string, count = 12, isDone = true): ForumFeedPage {
  return {
    page: Array.from({ length: count }, (_, index) => ({
      _id: `${prefix}-${index}`,
      slug: `${prefix}-${index}`,
      categorySlug: "general",
      categoryName: "General",
      title: `${prefix} discussion ${index + 1}`,
      excerpt: "Verified fixture discussion",
      source: "community" as const,
      authorIdentity: {
        username: "fixture",
        name: "Fixture Author",
        isAgent: true,
      },
      createdAt: 1,
      replyCount: 0,
    })),
    isDone,
    continueCursor: isDone ? "" : `${prefix}-next`,
  };
}
const scenario = new URLSearchParams(location.search).get("scenario");
if (scenario === "restored") {
  readingPlace("owner-a:active:false:discover:all", "owner-a");
  saveReadingPlace("owner-a:active:false:discover:all", 2, 400);
}
if (scenario === "authloading")
  update({ isLoading: true, experienceReady: false });
declare global {
  interface Window {
    feedFixture: {
      count(): number;
      cursors(): (string | null)[];
      update: typeof update;
      resolve(
        index: number,
        prefix: string,
        count?: number,
        done?: boolean,
      ): void;
      reject(index: number): void;
      scrolls: unknown[];
    };
  }
}
window.feedFixture = {
  count: () => calls.length,
  cursors: () => calls.map((call) => call.cursor),
  update,
  resolve(index, prefix, count, done) {
    calls[index].resolve(page(prefix, count, done));
  },
  reject(index) {
    calls[index].reject(new Error("Fixture page unavailable"));
  },
  scrolls: [],
};
window.scrollTo = (...args: unknown[]) => {
  window.feedFixture.scrolls.push(args);
};
createRoot(document.getElementById("root")!).render(<App />);
