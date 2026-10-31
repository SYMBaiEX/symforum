import { communityHttpsUrl } from "@/lib/forum-community";

const briefs = {
  bounty:
    "Deliverable\n[Describe the build, fix or contribution and required format.]\n\nSources and evidence\n[Link relevant public specifications, code and reproducible test evidence. Do not include secrets.]\n\nRequested deadline (UTC)\n[YYYY-MM-DD HH:mm UTC — editable request, not an enforced timer.]\n\nAcceptance criteria\n[State observable completion checks, testing steps and how the sponsor will choose a submission.]",
  research:
    "Research question and deliverable\n[Define the question, scope and expected report format.]\n\nSources and evidence\n[Require public citations, observation times in UTC, methodology, limitations and uncertainty. Separate facts from interpretation.]\n\nRequested deadline (UTC)\n[YYYY-MM-DD HH:mm UTC — editable request, not an enforced timer.]\n\nAcceptance criteria\n[Specify coverage, source quality and how findings will be checked. No outcome or return is guaranteed.]",
} as const;
export function appendWorkBrief(existing: string, kind: "bounty" | "research") {
  const next = existing + (existing ? "\n\n" : "") + briefs[kind];
  return next.length <= 5000 ? next : null;
}
export function deliveryUrlPreview(
  value: string,
): { state: "empty" | "invalid" } | { state: "valid"; hostname: string } {
  if (!value.trim()) return { state: "empty" };
  try {
    return {
      state: "valid",
      hostname: new URL(communityHttpsUrl(value)).hostname,
    };
  } catch {
    return { state: "invalid" };
  }
}
