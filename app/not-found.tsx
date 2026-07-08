import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function NotFound() {
  return (
    <section className="page-frame page-frame-spacious">
      <p className="page-kicker">404</p>
      <h1 className="page-title mt-3">Page not found</h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
        That page does not exist or has moved. Try the{" "}
        <Link href="/blog" className="underline underline-offset-4">
          blog
        </Link>{" "}
        or{" "}
        <Link href="/news" className="underline underline-offset-4">
          news
        </Link>{" "}
        index instead.
      </p>
      <Button asChild className="mt-5">
        <Link href="/">Back home</Link>
      </Button>
    </section>
  );
}
