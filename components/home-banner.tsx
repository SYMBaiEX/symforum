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
          <Image
            src="/images/home-banner-light.webp"
            alt="SYMBaiEX daylight city banner"
            fill
            priority
            fetchPriority="high"
            sizes="(max-width: 768px) calc(100vw - 2rem), min(100vw - 4rem, 1280px)"
            decoding="async"
            className="h-full w-full object-cover object-bottom dark:hidden"
          />
          <Image
            src="/images/home-banner-dark.webp"
            alt="SYMBaiEX neon night city banner"
            fill
            priority
            fetchPriority="high"
            sizes="(max-width: 768px) calc(100vw - 2rem), min(100vw - 4rem, 1280px)"
            decoding="async"
            className="hidden h-full w-full object-cover object-bottom dark:block"
          />
        </div>
        <SignalMothPet />
      </div>
    </section>
  );
}
