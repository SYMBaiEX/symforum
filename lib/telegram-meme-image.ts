import sharp from "sharp";
import typeface from "../assets/telegram/cinematic/assets/fonts/Geist-Bold.typeface.json";
const font = typeface as {
  resolution: number;
  glyphs: Record<string, { ha: number; o?: string }>;
};
function advance(text: string, size: number) {
  return [...text].reduce(
    (n, c) =>
      n +
      ((font.glyphs[c]?.ha ?? font.glyphs["?"].ha) * size) / font.resolution,
    0,
  );
}
function wrap(text: string, size: number, width: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.toUpperCase().split(/\s+/)) {
    if (line && advance(line + " " + word, size) > width) {
      lines.push(line);
      line = "";
    }
    for (const char of (line ? " " : "") + word) {
      if (advance(line + char, size) > width) {
        lines.push(line);
        line = "";
      }
      line += char;
    }
  }
  if (line) lines.push(line);
  return lines;
}
function glyphPath(outline: string) {
  const a = outline.split(" ");
  let out = "";
  for (let i = 0; i < a.length;) {
    const c = a[i++];
    if (c === "m" || c === "l") {
      out += `${c.toUpperCase()}${a[i++]} ${a[i++]} `;
    } else if (c === "q") {
      const ex = a[i++],
        ey = a[i++],
        cx = a[i++],
        cy = a[i++];
      out += `Q${cx} ${cy} ${ex} ${ey} `;
    } else if (c === "b") {
      const ex = a[i++],
        ey = a[i++],
        c1x = a[i++],
        c1y = a[i++],
        c2x = a[i++],
        c2y = a[i++];
      out += `C${c1x} ${c1y} ${c2x} ${c2y} ${ex} ${ey} `;
    } else throw Error("invalid_font_outline");
  }
  return out;
}
function linePaths(text: string, size: number, baseline: number) {
  let x = (640 - advance(text, size)) / 2;
  let out = "";
  for (const c of text) {
    const g = font.glyphs[c] ?? font.glyphs["?"];
    if (g.o)
      out += `<path d="${glyphPath(g.o)}" transform="translate(${x} ${baseline}) scale(${size / font.resolution} ${-size / font.resolution})" fill="white"/>`;
    x += (g.ha * size) / font.resolution;
  }
  return out;
}
function captionPaths(text: string, top: number) {
  let size = 36,
    lines = wrap(text, size, 590);
  while (size > 20 && lines.length * (size + 5) > 110) {
    size--;
    lines = wrap(text, size, 590);
  }
  const total = lines.length * (size + 5);
  return lines
    .map((line, i) =>
      linePaths(line, size, top + (124 - total) / 2 + size + i * (size + 5)),
    )
    .join("");
}
export async function renderMeme(
  atlas: Uint8Array,
  slot: number,
  top: string,
  bottom: string,
) {
  const meta = await sharp(atlas, { limitInputPixels: 4_200_000 }).metadata();
  if (
    !meta.width ||
    !meta.height ||
    meta.width !== meta.height ||
    meta.width < 512 ||
    meta.width > 2048
  )
    throw Error("invalid_meme_art");
  const tile = Math.floor(meta.width / 2),
    index = ((slot % 4) + 4) % 4;
  const art = await sharp(atlas)
    .extract({
      left: (index % 2) * tile,
      top: Math.floor(index / 2) * tile,
      width: tile,
      height: tile,
    })
    .resize(640, 640)
    .png()
    .toBuffer();
  const caption = Buffer.from(
    `<svg width="640" height="920" xmlns="http://www.w3.org/2000/svg">${captionPaths(top, 0)}${captionPaths(bottom, 764)}${linePaths("BELLE / SYMBAIEX FORUM", 10, 910)}</svg>`,
  );
  return await sharp({
    create: { width: 640, height: 920, channels: 3, background: "#090a0e" },
  })
    .composite([
      { input: art, left: 0, top: 124 },
      { input: caption, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}
