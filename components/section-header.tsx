import { ReactNode } from "react";

export function SectionHeader({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="grid gap-3 border-t border-row-border pt-4 md:grid-cols-12">
      <div className="font-mono text-[11px] uppercase text-muted-foreground md:col-span-3">
        {kicker}
      </div>
      <div className="md:col-span-9">
        <h2 className="text-2xl font-semibold md:text-4xl">{title}</h2>
        {children ? (
          <div className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}
