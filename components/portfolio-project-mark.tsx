import { isLocalImageUrl, safeImageUrl } from "@/lib/safe-url";
import { cn } from "@/lib/utils";
import Image from "next/image";

const PERSONAL_GITHUB_AVATAR_TOKEN = "/u/192078165";

export function PortfolioProjectMark({
  name,
  imageUrl,
  imageAlt,
  order,
  size = "card",
}: {
  name: string;
  imageUrl?: string;
  imageAlt?: string;
  order: number;
  size?: "card" | "hero";
}) {
  const cleanImageUrl = safeImageUrl(imageUrl);
  const hero = size === "hero";
  const accentClass =
    order % 3 === 0
      ? "bg-[var(--accent-canary)]"
      : order % 2 === 0
        ? "bg-[var(--accent-cyan)]"
        : "bg-[var(--accent-magenta)]";

  if (cleanImageUrl && !isPersonalProjectAvatar(cleanImageUrl)) {
    const imageSize = hero ? 88 : 48;

    return (
      <div
        className={cn(
          "relative grid shrink-0 place-items-center overflow-hidden border border-row-border bg-background",
          hero ? "size-28" : "size-16",
        )}
      >
        <Image
          src={cleanImageUrl}
          alt={imageAlt ?? `${name} project mark`}
          width={imageSize}
          height={imageSize}
          sizes={hero ? "7rem" : "4rem"}
          unoptimized={isLocalImageUrl(cleanImageUrl)}
          className={cn("object-contain", hero ? "size-[5.5rem]" : "size-12")}
        />
        <span
          aria-hidden="true"
          className={cn("absolute left-0 top-0 h-1 w-8", accentClass)}
        />
        <span
          aria-hidden="true"
          className={cn("absolute bottom-0 right-0 h-8 w-1", accentClass)}
        />
      </div>
    );
  }

  return (
    <div
      aria-label={`${name} project mark`}
      role="img"
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden bg-foreground font-mono font-semibold uppercase text-background",
        hero ? "size-28 text-2xl" : "size-16 text-base",
      )}
    >
      <span className="relative z-10">{projectInitials(name)}</span>
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-x-0 bottom-0",
          hero ? "h-3" : "h-2",
          accentClass,
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "absolute right-0 top-0 h-full",
          hero ? "w-3" : "w-2",
          accentClass,
        )}
      />
    </div>
  );
}

function isPersonalProjectAvatar(value: string) {
  return value.includes(PERSONAL_GITHUB_AVATAR_TOKEN);
}

function projectInitials(name: string) {
  const compact = name.replace(/[^a-zA-Z0-9]/g, "");
  if (compact.length <= 2) {
    return compact.toUpperCase();
  }
  const capitals = compact.match(/[A-Z0-9]/g)?.join("");
  return (capitals && capitals.length >= 2 ? capitals : compact)
    .slice(0, 2)
    .toUpperCase();
}
