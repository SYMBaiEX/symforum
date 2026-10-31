"use client";

import Image from "next/image";
import { useState } from "react";
import { SYMF_TOKEN } from "@/lib/symf-token";
import { safeExternalUrl } from "./terminal-format";
import styles from "./forum-terminal.module.css";

export type MarketChoice = {
  mint: string;
  symbol: string;
  name: string;
  imageUrl?: string | null;
};
export const symfChoice: MarketChoice = {
  mint: SYMF_TOKEN.mint,
  symbol: SYMF_TOKEN.symbol,
  name: SYMF_TOKEN.name,
  imageUrl: "/images/brand/symforum-icon-64.png",
};

export function TokenLogo({ token }: { token: MarketChoice }) {
  const src = token.imageUrl?.startsWith("/images/")
    ? token.imageUrl
    : safeExternalUrl(token.imageUrl);
  // A failed image belongs to this exact mint/source pair, not the reusable
  // market row. Keying the state also fences late errors from a replaced image.
  return (
    <TokenLogoImage
      key={`${token.mint}:${src ?? ""}`}
      src={src}
      symbol={token.symbol}
    />
  );
}

function TokenLogoImage({
  src,
  symbol,
}: {
  src: string | null;
  symbol: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={styles.logo} aria-hidden="true">
      {src && !failed ? (
        <Image
          unoptimized
          src={src}
          alt=""
          width={40}
          height={40}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        symbol.slice(0, 2)
      )}
    </span>
  );
}
