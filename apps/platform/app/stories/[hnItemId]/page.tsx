import { notFound, permanentRedirect } from "next/navigation";

type PageProps = {
  params: Promise<{ hnItemId: string }>;
};

export default async function LegacyStoryPage({ params }: PageProps) {
  const { hnItemId } = await params;
  if (!/^\d+$/.test(hnItemId)) {
    notFound();
  }

  permanentRedirect(`/forum/stories/${hnItemId}`);
}
