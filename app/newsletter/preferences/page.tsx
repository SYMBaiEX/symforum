import { NewsletterSignup } from "@/components/newsletter-signup";

export default function NewsletterPreferencesPage() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-12 md:px-8 md:py-16">
      <p className="font-mono text-xs uppercase text-muted-foreground">
        Newsletter
      </p>
      <h1 className="mt-3 text-4xl font-bold leading-none md:text-6xl">
        Preferences
      </h1>
      <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
        Subscribe again with the same address to refresh your confirmation
        link. Every confirmed issue includes unsubscribe controls.
      </p>
      <div className="mt-6 max-w-xl">
        <NewsletterSignup source="preferences" />
      </div>
    </section>
  );
}
