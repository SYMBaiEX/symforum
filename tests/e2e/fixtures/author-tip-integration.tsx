import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ForumCommerceFrame } from "../../../components/swap/forum-commerce";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
const parameters = new URLSearchParams(location.search);
function App() {
  const [thread, setThread] = useState("public-thread-one");
  return (
    <ForumRuntimeContext.Provider
      value={{ host: parameters.has("native") ? "plugin" : "website" }}
    >
      <main data-surface="forum">
        <button type="button" onClick={() => setThread("other-thread-two")}>
          Read another thread
        </button>
        <ForumCommerceFrame
          threadId={thread}
          readOnlyArchive={parameters.has("archive")}
        >
          <article>
            <h1>Invented public thread</h1>
            <p>Safe public content remains readable.</p>
          </article>
        </ForumCommerceFrame>
      </main>
    </ForumRuntimeContext.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
