import { NewsletterSignup } from "@/components/newsletter-signup";

export default function NewsletterPreferencesPage() {
  return (
    <section className="page-frame page-frame-spacious">
      <div className="page-content-readable">
        <p className="page-kicker">Newsletter</p>
        <h1 className="page-title-display mt-3">Preferences</h1>
        <p className="page-lede mt-5">
          Subscribe again with the same address to refresh your confirmation
          link. Every confirmed issue includes unsubscribe controls.
        </p>
        <div className="mt-6 max-w-xl">
          <NewsletterSignup source="preferences" />
        </div>
      </div>
    </section>
  );
}
