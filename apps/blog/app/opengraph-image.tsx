import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt =
  "SYMBaiEX Blog — essays and field notes about software, AI systems, and engineering practice.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/* Blue and violet editorial palette for the standalone Blog app. */
const background = "#080808";
const foreground = "#fafafa";
const muted = "#adadad";
const rule = "#383838";
const magenta = "#668cff";

export default async function OpenGraphImage() {
  const [geistMonoRegular, geistMonoBold] = await Promise.all([
    readFile(join(process.cwd(), "assets/fonts/GeistMono-Regular.ttf")),
    readFile(join(process.cwd(), "assets/fonts/GeistMono-Bold.ttf")),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: background,
          color: foreground,
          fontFamily: "Geist Mono",
          padding: 40,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            border: `1px solid ${rule}`,
            borderRadius: 2,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "22px 36px",
              borderBottom: `1px solid ${rule}`,
              fontSize: 20,
              letterSpacing: 3,
              color: muted,
            }}
          >
            <span>BLOG.SYMBAIEX.COM</span>
            <span>ESSAYS / FIELD NOTES</span>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flexGrow: 1,
              justifyContent: "center",
              padding: "0 72px",
              gap: 30,
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 26,
                letterSpacing: 2,
                color: muted,
              }}
            >
              $ whoami
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                fontSize: 148,
                fontWeight: 700,
                letterSpacing: -4,
                lineHeight: 1,
              }}
            >
              <span>SYMB</span>
              <span style={{ color: magenta }}>ai</span>
              <span>EX</span>
              <div
                style={{
                  width: 54,
                  height: 104,
                  marginLeft: 26,
                  backgroundColor: magenta,
                }}
              />
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 30,
                letterSpacing: 8,
                color: foreground,
              }}
            >
              SOFTWARE / AI / ENGINEERING
            </div>
          </div>

          <div
            style={{
              display: "flex",
              padding: "22px 36px",
              borderTop: `1px solid ${rule}`,
              fontSize: 20,
              letterSpacing: 3,
              color: muted,
            }}
          >
            SOURCE-GROUNDED NOTES BY AUSTIN HAMILTON
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: "Geist Mono",
          data: geistMonoRegular,
          weight: 400,
          style: "normal",
        },
        {
          name: "Geist Mono",
          data: geistMonoBold,
          weight: 700,
          style: "normal",
        },
      ],
    },
  );
}
