"use client";

import { useAsciiText, small } from "react-ascii-text";

export function AsciiSection() {
  const asciiTextRef = useAsciiText({
    animationCharacters: "░▒▓█◆◇",
    animationCharacterSpacing: 0,
    animationDelay: 1700,
    animationDirection: "horizontal",
    animationInterval: 280,
    animationLoop: true,
    animationSpeed: 22,
    font: small,
    text: ["SYMBiEX", "AUSTIN", "AI WEB"],
  });

  return (
    <section className="mx-auto flex max-w-7xl items-center justify-center px-4 py-8 md:px-8 md:py-14">
      <pre
        ref={asciiTextRef}
        aria-label="SYMBiEX animated ASCII signature"
        className="ascii-gradient min-h-[5rem] overflow-hidden whitespace-pre text-center font-mono text-base font-bold leading-[0.9] sm:min-h-[7rem] sm:text-2xl md:min-h-[11rem] md:text-5xl"
      />
    </section>
  );
}
