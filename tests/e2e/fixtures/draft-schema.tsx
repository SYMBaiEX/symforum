import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ForumCompose } from "../../../components/forum/forum-compose";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import { useDraftScope, submitFixture } from "./draft-schema-state";
const params = new URLSearchParams(location.search);
function Editor() {
  const scope = useDraftScope();
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [data, setData] = useState<Record<string, string>>({
    kind: "discussion",
  });
  return (
    <ForumRuntimeContext.Provider
      value={{
        host: "website",
        ...(scope.actor === "human"
          ? {}
          : { actingAs: { userId: scope.actor } as never }),
      }}
    >
      <ForumCompose
        draftKey={`draft:${scope.owner}:${scope.route}:${scope.actor}`}
        body={body}
        title={title}
        onBodyChange={setBody}
        onTitleChange={setTitle}
        draftData={data}
        onDraftDataChange={setData}
        bodyLabel="Draft body"
        bodyPlaceholder="Write"
        submitLabel="Post fixture"
        bodyTemplate={
          params.has("template") ? "Invented board template" : undefined
        }
        onSubmit={submitFixture}
      >
        <label>
          Topic kind
          <input
            value={data.kind ?? ""}
            onChange={(event) => setData({ kind: event.target.value })}
          />
        </label>
      </ForumCompose>
    </ForumRuntimeContext.Provider>
  );
}
function App() {
  const scope = useDraftScope();
  return (
    <>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event("fixture-remount"))}
      >
        Remount editor
      </button>
      <Editor
        key={`${scope.owner}:${scope.route}:${scope.actor}:${scope.token}`}
      />
    </>
  );
}
const root = createRoot(document.getElementById("root")!);
let revision = 0;
window.addEventListener("fixture-remount", () => {
  revision++;
  root.render(<App key={revision} />);
});
root.render(<App />);
