import { ForumNewsDiscussion } from "@/components/forum/forum-news-discussion";
import { notFound } from "next/navigation";
export default async function ForumNewsStoryPage({
  params,
}: {
  params: Promise<{ hnItemId: string }>;
}) {
  const { hnItemId } = await params;
  if (!/^\d+$/.test(hnItemId) || !Number.isSafeInteger(Number(hnItemId)))
    notFound();
  return (
    <section className="page-frame page-frame-dense">
      {process.env.NEXT_PUBLIC_CONVEX_URL ? (
        <ForumNewsDiscussion hnItemId={Number(hnItemId)} />
      ) : (
        <p>Connect the forum backend to discuss news.</p>
      )}
    </section>
  );
}
