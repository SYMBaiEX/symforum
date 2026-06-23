"use client";

import { useAsciiText, small } from "react-ascii-text";

export function AsciiSection() {
  const asciiTextRef = useAsciiText({
    animationCharacters: "░▒▓█",
    animationCharacterSpacing: 1,
    animationDelay: 500,
    animationDirection: "horizontal",
    animationInterval: 2200,
    animationLoop: true,
    animationSpeed: 28,
    font: small,
    text: ["SYMBiEX", "AUSTIN", "AI WEB"],
  });

  return (
    <section className="border-b border-row-border bg-card/55">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 md:grid-cols-12 md:px-8 md:py-14">
        <div className="md:col-span-3">
          <p className="font-mono text-xs uppercase text-muted-foreground">
            Terminal signature
          </p>
          <p className="mt-4 max-w-xs text-sm leading-6 text-muted-foreground">
            A small moving mark for the site, separated from the hero so the
            writing stays primary.
          </p>
        </div>
        <div className="md:col-span-9">
          <div className="border border-row-border bg-background/70 p-4 md:p-6">
            <div className="mb-8 grid grid-cols-4 gap-2 font-mono text-[10px] uppercase text-muted-foreground">
              <span>signal</span>
              <span className="accent-magenta">magenta</span>
              <span className="accent-cyan">cyan</span>
              <span className="accent-canary">canary</span>
            </div>
            <pre
              ref={asciiTextRef}
              aria-label="SYMBiEX animated ASCII signature"
              className="min-h-36 overflow-hidden whitespace-pre font-mono text-[11px] leading-[0.95] text-foreground md:text-sm"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
