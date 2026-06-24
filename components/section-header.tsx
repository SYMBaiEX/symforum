import { ReactNode } from "react";

export function SectionHeader({
  kicker,
  title,
  children,
  divided = true,
}: {
  kicker?: string;
  title: string;
  children?: ReactNode;
  divided?: boolean;
}) {
  return (
    <div
      className={`grid gap-3 md:grid-cols-12 ${divided ? "border-t border-row-border pt-4" : ""}`}
    >
      {kicker ? (
        <div className="font-mono text-[11px] uppercase text-muted-foreground md:col-span-3">
          {kicker}
        </div>
      ) : null}
      <div className={kicker ? "md:col-span-9" : "md:col-span-12"}>
        <h2 className="text-2xl font-semibold md:text-3xl">{title}</h2>
        {children ? (
          <div className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}
