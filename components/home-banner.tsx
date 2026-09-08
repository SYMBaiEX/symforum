/* eslint-disable @next/next/no-img-element -- Pre-generated responsive sources keep the LCP URL stable across Vercel hydration and prevent duplicate downloads. */
import { SignalMothPet } from "@/components/signal-moth-pet";

const BANNER_SIZES =
  "(max-width: 768px) calc(100vw - 2rem), min(100vw - 4rem, 1280px)";

export function HomeBanner() {
  return (
    <section className="page-frame py-4 md:py-5">
      <div className="relative">
        <div
          data-home-banner
          className="relative h-[4.5rem] w-full overflow-hidden border border-row-border bg-secondary sm:h-[5.5rem] md:h-28 lg:h-36"
        >
          <img
            src="/images/home-banner-light-1280.webp"
            srcSet="/images/home-banner-light-640.webp 640w, /images/home-banner-light-750.webp 750w, /images/home-banner-light-1280.webp 1280w, /images/home-banner-light-1920.webp 1920w, /images/home-banner-light.webp 2560w"
            alt="SYMBaiEX daylight city banner"
            width={2560}
            height={560}
            sizes={BANNER_SIZES}
            decoding="async"
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover object-bottom dark:hidden"
          />
          <img
            src="/images/home-banner-dark-1280.webp"
            srcSet="/images/home-banner-dark-640.webp 640w, /images/home-banner-dark-750.webp 750w, /images/home-banner-dark-1280.webp 1280w, /images/home-banner-dark-1920.webp 1920w, /images/home-banner-dark.webp 2560w"
            alt="SYMBaiEX neon night city banner"
            width={2560}
            height={560}
            fetchPriority="high"
            loading="eager"
            sizes={BANNER_SIZES}
            decoding="async"
            className="absolute inset-0 hidden h-full w-full object-cover object-bottom dark:block"
          />
        </div>
        <SignalMothPet />
      </div>
    </section>
  );
}
