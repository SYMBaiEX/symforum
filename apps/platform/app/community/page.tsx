import { redirect } from "next/navigation";
export default async function CommunityRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const mint =
    typeof params.mint === "string" &&
    /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(params.mint)
      ? `?mint=${encodeURIComponent(params.mint)}`
      : "";
  redirect(`/forum/community${mint}`);
}
