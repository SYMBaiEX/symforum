/* eslint-disable @next/next/no-img-element */

export function HomeBanner() {
  return (
    <section className="page-frame py-5 md:py-6">
      <div
        data-home-banner
        className="relative h-28 w-full overflow-hidden border border-row-border bg-secondary sm:h-32 md:h-40 lg:h-48"
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
