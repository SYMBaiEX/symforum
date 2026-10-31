import { redirect } from "next/navigation";
import {
  communityHref,
  communityRouteFromRecord,
} from "@/lib/community-navigation";
export default async function CommunityRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  redirect(communityHref(communityRouteFromRecord(params), "/forum/community"));
}
