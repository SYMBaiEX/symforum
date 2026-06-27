/* eslint-disable @next/next/no-img-element */

export function HomeBanner() {
  return (
    <section className="page-frame py-4 md:py-5">
      <div
        data-home-banner
        className="relative h-[4.5rem] w-full overflow-hidden border border-row-border bg-secondary sm:h-[5.5rem] md:h-28 lg:h-36"
      >
        <img
          src="/images/home-banner-light.webp"
          alt="SYMBaiEX daylight city banner"
          width={2560}
          height={560}
          decoding="async"
          loading="eager"
          className="h-full w-full object-cover dark:hidden"
        />
        <img
          src="/images/home-banner-dark.webp"
          alt="SYMBaiEX neon night city banner"
          width={2560}
          height={560}
          decoding="async"
          loading="eager"
          className="hidden h-full w-full object-cover dark:block"
        />
      </div>
    </section>
  );
}
