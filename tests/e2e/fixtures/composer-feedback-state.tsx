import { useSyncExternalStore } from "react";
import type { ForumAttachmentDraft } from "../../../components/forum/forum-compose";

let state = {
  owner: "owner-a",
  board: "board-a",
  actor: "human",
  token: "inert-a",
  pending: false,
  plugin: false,
};
const listeners = new Set<() => void>();
export function update(patch: Partial<typeof state>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}
export function useFixtureState() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}
export function usePlatformAuthToken() {
  return useFixtureState().token;
}
export function ForumAgentAttachmentPicker() {
  return null;
}
const calls: {
  names: string[];
  signal?: AbortSignal;
  finish(ok: boolean): void;
}[] = [];
export const changes: string[][] = [];
export function record(attachments: ForumAttachmentDraft[]) {
  changes.push(attachments.map((file) => file.storageId));
}
// Explicit inert adapter: never invokes browser fetch or any real upload service.
window.fetch = async (input, init) => {
  if (
    input !== "http://127.0.0.1:43239/forum-attachment-upload" ||
    !(init?.body instanceof File)
  )
    throw new Error("Forbidden fixture transport");
  const file = init.body;
  return new Promise<Response>((resolve) =>
    calls.push({
      names: [file.name],
      signal: init.signal ?? undefined,
      finish(ok) {
        resolve(
          new Response(
            JSON.stringify(
              ok
                ? {
                    storageId: `inert-${file.name}`,
                    filename: file.name,
                    contentType: file.type,
                    size: file.size,
                  }
                : { error: "PRIVATE_FAILURE" },
            ),
            { status: ok ? 200 : 503 },
          ),
        );
      },
    }),
  );
};
export function hostUpload(files: File[]) {
  return new Promise<ForumAttachmentDraft[]>((resolve, reject) =>
    calls.push({
      names: files.map((file) => file.name),
      finish(ok) {
        if (!ok) {
          reject(new Error("PRIVATE_FAILURE"));
          return;
        }
        resolve(
          files.map((file) => ({
            storageId: `inert-${file.name}`,
            filename: file.name,
            contentType: file.type,
            size: file.size,
          })),
        );
      },
    }),
  );
}
let finishSubmit: ((ok: boolean) => void) | undefined;
let submissions = 0;
export function submit() {
  submissions++;
  return new Promise<boolean>((resolve) => {
    finishSubmit = resolve;
  });
}
declare global {
  interface Window {
    composerFeedback: {
      update: typeof update;
      settle(index: number, ok: boolean): void;
      calls(): { names: string[]; aborted: boolean }[];
      changes(): string[][];
      submit(ok: boolean): void;
      submissions(): number;
    };
  }
}
window.composerFeedback = {
  update,
  settle: (index, ok) => calls[index].finish(ok),
  calls: () =>
    calls.map((call) => ({
      names: call.names,
      aborted: call.signal?.aborted ?? false,
    })),
  changes: () => changes,
  submit: (ok) => finishSubmit?.(ok),
  submissions: () => submissions,
};
