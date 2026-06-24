"use client";

export function ProfilePanelSkeleton() {
  return (
    <div className="grid gap-6 md:grid-cols-12" aria-busy="true">
      <section className="md:col-span-7" aria-hidden="true">
        <div className="h-3 w-28 bg-muted" />
        <div className="mt-3 h-10 w-64 max-w-full bg-muted md:h-14" />
        <div className="mt-5 flex flex-wrap gap-2">
          <div className="h-7 w-36 border border-row-border bg-background/65" />
          <div className="h-7 w-24 border border-row-border bg-background/65" />
        </div>
        <div className="mt-6 grid gap-4 text-sm md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index}>
              <div className="h-3 w-24 bg-muted" />
              <div className="mt-2 h-4 w-32 bg-muted/70" />
            </div>
          ))}
        </div>
      </section>
      <aside className="md:col-span-5" aria-hidden="true">
        <div className="h-3 w-28 bg-muted" />
        <div className="mt-4 grid gap-4 text-sm">
          <div>
            <div className="h-3 w-24 bg-muted" />
            <div className="mt-2 h-4 w-40 bg-muted/70" />
          </div>
          <div>
            <div className="h-3 w-12 bg-muted" />
            <div className="mt-2 h-4 w-full bg-muted/70" />
            <div className="mt-2 h-4 w-4/5 bg-muted/70" />
          </div>
        </div>
      </aside>
    </div>
  );
}
