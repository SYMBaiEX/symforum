import { createRoot } from "react-dom/client";
import { ForumAttachmentDraftPanel, type ForumAttachmentDraft } from "../../../components/forum/forum-compose";
import { ForumRuntimeContext } from "../../../components/forum/forum-runtime-context";
import { changed, changes, update, useAttachmentState } from "./attachment-batch-state";
const calls: { names: string[]; signal?: AbortSignal; resolve: (ok: boolean, ids?: string[]) => void }[] = [];
window.fetch = async (input, init) => {
  if (input !== "http://127.0.0.1:43231/forum-attachment-upload" || !(init?.body instanceof File)) throw new Error("Unexpected transport");
  const file = init.body;
  return new Promise<Response>((resolve) => calls.push({ names: [file.name], signal: init.signal ?? undefined, resolve(ok, ids) { resolve(new Response(JSON.stringify(ok ? { storageId: ids?.[0] ?? `stored-${calls.length}`, filename: file.name, contentType: file.type, size: file.size } : { error: "PRIVATE_SERVER_MARKER" }), { status: ok ? 200 : 400 })); } }));
};
function hostUpload(files: File[]) {
  return new Promise<ForumAttachmentDraft[]>((resolve, reject) => calls.push({ names: files.map((file) => file.name), resolve(ok, ids) { if (!ok) { reject(new Error("PRIVATE_PLUGIN_MARKER")); return; } resolve(files.map((file, index) => ({ storageId: ids?.[index] ?? `plugin-${index}`, filename: file.name, contentType: file.type, size: file.size }))); } }));
}
function App() {
  const state = useAttachmentState();
  return <ForumRuntimeContext.Provider value={{ host: state.plugin ? "plugin" : "website", actingAs: { userId: state.actor, username: state.actor, isAgent: false }, ...(state.plugin ? { uploadFiles: hostUpload } : {}) }}>
    {state.mounted ? <ForumAttachmentDraftPanel attachments={state.attachments} disabled={state.disabled} reservedAttachmentSlots={state.reserved} onAttachmentsChange={changed} /> : null}
  </ForumRuntimeContext.Provider>;
}
declare global { interface Window { attachmentBatchFixture: {
  update: typeof update;
  settle(index: number, ok: boolean, ids?: string[]): void;
  calls(): { names: string[]; aborted: boolean }[];
  changes(): string[][];
} } }
window.attachmentBatchFixture = { update, settle(index, ok, ids) { calls[index].resolve(ok, ids); }, calls: () => calls.map((call) => ({ names: call.names, aborted: call.signal?.aborted ?? false })), changes: () => changes };
createRoot(document.getElementById("root")!).render(<App />);
