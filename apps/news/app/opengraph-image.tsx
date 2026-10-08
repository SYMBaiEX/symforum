import { ImageResponse } from "next/og";

export const alt = "SYMBiEX News: live stories, sources, and discussion.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function NewsOpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          color: "#faf7f2",
          background: "#100d0b",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, color: "#ff8845", fontSize: 24, letterSpacing: 8 }}>
          <div style={{ width: 18, height: 18, background: "#ff8845" }} />
          SYMBiEX / NEWS
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ color: "#ffb172", fontSize: 20, letterSpacing: 5 }}>LIVE NEWS DESK</div>
          <div style={{ fontSize: 88, lineHeight: 1, fontWeight: 700, letterSpacing: -4 }}>Stories. Sources.</div>
          <div style={{ color: "#b7aaa0", fontSize: 36 }}>The conversation around them.</div>
        </div>
        <div style={{ display: "flex", borderTop: "1px solid #49372c", paddingTop: 20, color: "#b7aaa0", fontSize: 18, letterSpacing: 4 }}>
          HACKER NEWS / SOURCE INDEX / DISCUSSION
        </div>
      </div>
    ),
    size,
  );
}
