import React from "react";
import { ImageResponse } from "next/og";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Render a static card so link crawlers never depend on market data or inference.
const root = process.cwd();
const [regular, bold, moth] = await Promise.all([
  readFile(join(root, "assets/fonts/GeistMono-Regular.ttf")),
  readFile(join(root, "assets/fonts/GeistMono-Bold.ttf")),
  readFile(join(root, "public/images/brand/signal-moth.png")),
]);

const image = new ImageResponse(
  <div
    style={{
      display: "flex",
      width: "100%",
      height: "100%",
      padding: 54,
      color: "#fafafa",
      background: "#09090b",
      fontFamily: "Geist Mono",
      position: "relative",
      overflow: "hidden",
    }}
  >
    <div
      style={{
        display: "flex",
        position: "absolute",
        right: -140,
        top: -160,
        width: 800,
        height: 900,
        backgroundImage:
          "radial-gradient(ellipse at center, #fa00a827 0%, #09090b00 68%)",
      }}
    />
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        justifyContent: "space-between",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            display: "flex",
            width: 28,
            height: 4,
            background: "#fa00a8",
          }}
        />
        <span style={{ fontSize: 24, fontWeight: 700 }}>SYMBaiEX Forum</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 25 }}>
        <div
          style={{
            display: "flex",
            fontSize: 152,
            fontWeight: 700,
            letterSpacing: -9,
            lineHeight: 1,
          }}
        >
          <span style={{ color: "#fa00a8" }}>$</span>SYMF
        </div>
        <span style={{ fontSize: 24, color: "#d4d4d8" }}>
          The Forum&apos;s community token.
        </span>
        <span style={{ fontSize: 20, color: "#a1a1aa" }}>
          Live chart. Market cap. Recent trades.
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
        <span style={{ fontSize: 20, color: "#fa00a8" }}>
          forum.symbaiex.com/symf
        </span>
        <span style={{ fontSize: 16, color: "#a1a1aa" }}>
          1m / 5m / 15m / 1h / 4h candles
        </span>
      </div>
    </div>
    {/* ImageResponse renders this embedded local asset without a remote request. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img
      src={`data:image/png;base64,${moth.toString("base64")}`}
      alt=""
      width={480}
      height={400}
      style={{ position: "absolute", right: 16, top: 156 }}
    />
    <div
      style={{
        display: "flex",
        position: "absolute",
        top: 52,
        right: 54,
        border: "1px solid #3f3f46",
        borderRadius: 30,
        padding: "10px 20px",
        fontSize: 18,
        color: "#d4d4d8",
      }}
    >
      SOLANA
    </div>
  </div>,
  {
    width: 1200,
    height: 630,
    fonts: [
      { name: "Geist Mono", data: regular, weight: 400, style: "normal" },
      { name: "Geist Mono", data: bold, weight: 700, style: "normal" },
    ],
  },
);

const png = Buffer.from(await image.arrayBuffer());
for (const directory of [
  "public/images/social",
  "apps/forum/public/images/social",
]) {
  await mkdir(join(root, directory), { recursive: true });
  await writeFile(join(root, directory, "symf-token-v1.png"), png);
}
console.log(`Rendered SYMF social card: 1200x630, ${png.length} bytes.`);
