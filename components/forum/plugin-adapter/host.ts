import { ForumHostBridge } from "./bridge";
export { ForumHostBridge, record, unwrapToolResult } from "./bridge";
export const forumHost = new ForumHostBridge(window);
