import { NewsletterSignup } from "@/components/newsletter-signup";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Newsletter preferences",
};

export default function NewsletterPreferencesPage() {
  return (
    <section className="page-frame page-frame-spacious">
      <div className="page-content-readable">
        <p className="page-kicker">Newsletter</p>
        <h1 className="page-title-display mt-3">Preferences</h1>
        <p className="page-lede mt-5">
          Enter your email below to manage your subscription. Confirmed
          subscribers get a link to unsubscribe or update preferences; new
          addresses get a fresh confirmation link.
        </p>
        <div className="mt-6 max-w-xl">
          <NewsletterSignup source="preferences" />
        </div>
      </div>
    </section>
  );
}
