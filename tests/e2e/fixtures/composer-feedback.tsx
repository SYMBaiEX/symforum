import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ForumAttachmentDraftPanel,
  ForumCompose,
  type ForumAttachmentDraft,
} from "../../../components/forum/forum-compose";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import {
  hostUpload,
  record,
  submit,
  useFixtureState,
} from "./composer-feedback-state";
function Editor() {
  const state = useFixtureState();
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [attachments, setAttachments] = useState<ForumAttachmentDraft[]>([]);
  return (
    <ForumCompose
      body={body}
      title={title}
      onBodyChange={setBody}
      onTitleChange={setTitle}
      bodyLabel="Draft body"
      bodyPlaceholder="Write"
      submitLabel="Post fixture"
      onSubmit={submit}
      pending={state.pending}
      draftKey={`draft:${state.owner}:${state.board}:${state.actor}`}
    >
      <ForumAttachmentDraftPanel
        attachments={attachments}
        disabled={state.pending}
        onAttachmentsChange={(files) => {
          record(files);
          setAttachments(files);
        }}
      />
    </ForumCompose>
  );
}
function App() {
  const state = useFixtureState();
  return (
    <SurfaceScope.Provider value="forum">
      <main className="forum-surface" data-surface="forum">
        <ForumRuntimeContext.Provider
          value={{
            host: state.plugin ? "plugin" : "website",
            actingAs: { userId: state.actor } as never,
            ...(state.plugin ? { uploadFiles: hostUpload } : {}),
          }}
        >
          <Editor
            key={`${state.owner}:${state.board}:${state.actor}:${state.token}`}
          />
        </ForumRuntimeContext.Provider>
      </main>
    </SurfaceScope.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
