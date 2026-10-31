import { useSyncExternalStore } from "react";
const listeners = new Set<() => void>();
let state = {
  owner: "owner-a",
  route: "thread-one",
  actor: "human",
  token: "inert-a",
};
export function setScope(patch: Partial<typeof state>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}
export function useDraftScope() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}
export function usePlatformAuthToken() {
  return useDraftScope().token;
}
export function ForumAgentAttachmentPicker() {
  return null;
}
let finishSubmit: ((value: boolean) => void) | undefined;
let submitted = 0;
export function submitFixture() {
  submitted++;
  return new Promise<boolean>((resolve) => {
    finishSubmit = resolve;
  });
}
declare global {
  interface Window {
    draftSchemaScope: typeof setScope;
    draftSchemaFinishSubmit(success: boolean): void;
    draftSchemaSubmitCount(): number;
  }
}
Object.assign(window, {
  draftSchemaScope: setScope,
  draftSchemaFinishSubmit: (success: boolean) => finishSubmit?.(success),
  draftSchemaSubmitCount: () => submitted,
});
