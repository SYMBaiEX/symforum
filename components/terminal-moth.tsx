import { cn } from "@/lib/utils";

export function TerminalMoth({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "terminal-moth pointer-events-none absolute z-10 font-mono text-[11px] leading-none sm:text-xs md:text-[13px]",
        className,
      )}
    >
      <pre className="terminal-moth__frame terminal-moth__frame-a">{`/\\_/\\
( v )
 \\_/`}</pre>
      <pre className="terminal-moth__frame terminal-moth__frame-b">{`\\/ \\ /
( v )
 / \\`}</pre>
      <pre className="terminal-moth__frame terminal-moth__frame-c">{`<\\_/ >
 (v)
 / \\`}</pre>
      <span className="terminal-moth__signal" />
    </div>
  );
}
