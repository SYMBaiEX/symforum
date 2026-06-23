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
    <div className="grid gap-4 border-t border-row-border pt-5 md:grid-cols-12">
      <div className="font-mono text-xs uppercase text-muted-foreground md:col-span-3">
        {kicker}
      </div>
      <div className="md:col-span-9">
        <h2 className="text-3xl font-semibold md:text-5xl">{title}</h2>
        {children ? (
          <div className="mt-4 max-w-2xl leading-7 text-muted-foreground">
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}
