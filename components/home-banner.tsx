import Image from "next/image";

import { SignalMothPet } from "@/components/signal-moth-pet";

export function HomeBanner() {
  return (
    <section className="page-frame py-4 md:py-5">
      <div className="relative">
        <div
          data-home-banner
          className="relative h-[4.5rem] w-full overflow-hidden border border-row-border bg-secondary sm:h-[5.5rem] md:h-28 lg:h-36"
        >
          <picture className="absolute inset-0 block">
            <source
              media="(prefers-color-scheme: dark)"
              srcSet="/images/home-banner-dark-optimized.webp"
            />
            <Image
              src="/images/home-banner-light.webp"
              alt="SYMBaiEX city banner"
              fill
              priority
              sizes="(max-width: 768px) calc(100vw - 2rem), min(100vw - 4rem, 1280px)"
              decoding="async"
              className="h-full w-full object-cover object-bottom"
            />
          </picture>
        </div>
        <SignalMothPet />
      </div>
    </section>
  );
}
