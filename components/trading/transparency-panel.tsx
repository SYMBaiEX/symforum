"use client";

import { useQuery } from "convex/react";
import { ArrowUpRight, Flame } from "lucide-react";
import { terminalApi } from "./terminal-api";
import { balanceLabel, shortMint } from "./terminal-format";
import styles from "./forum-terminal.module.css";

export function TransparencyPanel() {
  const data = useQuery(terminalApi.getTransparency, {});
  return (
    <section
      className={styles.panel}
      aria-labelledby="terminal-transparency-title"
    >
      <header className={styles.panelHead}>
        <div>
          <h2 id="terminal-transparency-title">Treasury &amp; burns</h2>
          <p>Confirmed promotion receipts only</p>
        </div>
        <Flame className="size-4 text-muted-foreground" aria-hidden="true" />
      </header>
      {data === undefined ? (
        <p role="status" className={styles.empty}>
          Loading verified receipt totals…
        </p>
      ) : (
        <div className={styles.body}>
          <dl className={styles.metrics}>
            <div>
              <dt>Verified promotions</dt>
              <dd>{data.verifiedPromotions}</dd>
            </div>
            <div>
              <dt>SYMF burned</dt>
              <dd>{balanceLabel(data.burnAmountRaw, data.decimals)}</dd>
            </div>
            <div>
              <dt>SYMF to treasury</dt>
              <dd>{balanceLabel(data.treasuryAmountRaw, data.decimals)}</dd>
            </div>
            <div>
              <dt>SYMF promotion payments</dt>
              <dd>{balanceLabel(data.promotionAmountRaw, data.decimals)}</dd>
            </div>
          </dl>
          <p className={`${styles.muted} mt-4`}>
            {data.historyComplete
              ? "Historical verified receipts are included."
              : "These are verified recorded receipts; historical backfill may be incomplete."}{" "}
            No pending payments, estimated revenue or unverified swap fees are
            counted.
          </p>
          {data.treasury && (
            <a
              href={`https://solscan.io/account/${encodeURIComponent(data.treasury)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex min-h-9 items-center gap-2 text-xs underline underline-offset-4"
            >
              Public treasury {shortMint(data.treasury)}
              <ArrowUpRight className="size-3" aria-hidden="true" />
            </a>
          )}
          <p className={`${styles.muted} mt-2`}>
            A burn is a verified token-program burn, not a transfer to a
            supposed dead wallet. Promotion payments remain separate from
            organic discussion.
          </p>
          {!data.receipts.length ? (
            <p className={`${styles.muted} mt-3`}>
              No confirmed promotion receipts are indexed yet.
            </p>
          ) : (
            <ul
              className={styles.rows}
              aria-label="Verified promotion receipts"
            >
              {data.receipts.slice(0, 10).map((receipt) => (
                <li key={receipt.signature}>
                  <span>
                    <strong>
                      {balanceLabel(receipt.burnAmountRaw, data.decimals)} SYMF
                      burned
                    </strong>
                    <small>
                      {new Date(receipt.verifiedAt).toLocaleString()}
                    </small>
                  </span>
                  <a
                    href={`https://solscan.io/tx/${encodeURIComponent(receipt.signature)}`}
                    className="inline-flex min-h-9 items-center gap-1 text-xs underline underline-offset-4"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Receipt
                    <ArrowUpRight className="size-3" aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
