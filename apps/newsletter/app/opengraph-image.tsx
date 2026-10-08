import { ImageResponse } from "next/og";

export const alt = "SYMBaiEX Newsletter: daily signals and weekly field notes";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 56,
          background: "#111710",
          color: "#edf2e4",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 20, letterSpacing: 4, color: "#a8b49d" }}>
          <span>SYMBAIEX / NEWSLETTER</span>
          <span>DAILY SIGNALS · WEEKLY FIELD NOTES</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ display: "flex", fontSize: 82, lineHeight: 1.02, fontWeight: 700, letterSpacing: -3 }}>
            Notes from
            <span style={{ color: "#d8ef75", marginLeft: 22 }}>the signal.</span>
          </div>
          <div style={{ display: "flex", fontSize: 27, color: "#a8b49d" }}>
            Source-linked context for the ideas shaping what comes next.
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #45523e", paddingTop: 20, fontSize: 16, letterSpacing: 3, color: "#d8ef75" }}>
          <span>BELLE&apos;S DESK</span>
          <span>NEWSLETTER.SYMBAIEX.COM</span>
        </div>
      </div>
    ),
    size,
  );
}
