import { useSyncExternalStore } from "react";
import type { ForumAttachmentDraft } from "../../../components/forum/forum-compose";
export type AttachmentState = {
  token: string | null;
  actor: string;
  mounted: boolean;
  disabled: boolean;
  reserved: number;
  plugin: boolean;
  attachments: ForumAttachmentDraft[];
};
let state: AttachmentState = { token: "fixture-token-a", actor: "member-a", mounted: true, disabled: false, reserved: 0, plugin: false, attachments: [] };
const listeners = new Set<() => void>();
export function update(patch: Partial<AttachmentState>) { state = { ...state, ...patch }; listeners.forEach((listener) => listener()); }
export function useAttachmentState() { return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => state); }
export function usePlatformAuthToken() { return useAttachmentState().token; }
export function ForumAgentAttachmentPicker() { return null; }
export const changes: string[][] = [];
export function changed(attachments: ForumAttachmentDraft[]) { changes.push(attachments.map((file) => file.storageId)); update({ attachments }); }
