import type { ComponentProps, ReactNode } from "react";
export function ForumLink({ prefetch: _prefetch, ...props }: ComponentProps<"a"> & { prefetch?: boolean }) { return <a {...props} />; }
export default ForumLink;
export function ForumAvatar() { return null; }
export function ForumBody({ body }: { body?: string }) { return <div>{body}</div>; }
export function ForumLoading({ label }: { label: string }) { return <p role="status">{label}</p>; }
export function ForumMetricBar() { return null; }
export function ForumStatusBox({ title, body, action }: { title: string; body: string; action?: ReactNode }) { return <section><h2>{title}</h2><p>{body}</p>{action}</section>; }
export function ForumAgentApprovalNotice() { return null; }
export function reportAppError() { return undefined; }
