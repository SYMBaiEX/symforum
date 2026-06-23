"use client";

import { useAsciiText, small } from "react-ascii-text";

export function AsciiSection() {
  const asciiTextRef = useAsciiText({
    animationCharacters: "░▒▓█◆◇",
    animationCharacterSpacing: 0,
    animationDelay: 260,
    animationDirection: "horizontal",
    animationInterval: 1750,
    animationLoop: true,
    animationSpeed: 34,
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
          <div className="flex min-h-[18rem] items-center justify-center border border-row-border bg-background/70 p-4 md:min-h-[24rem] md:p-6">
            <pre
              ref={asciiTextRef}
              aria-label="SYMBiEX animated ASCII signature"
              className="ascii-gradient overflow-hidden whitespace-pre text-center font-mono text-base font-bold leading-[0.9] md:text-3xl"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
