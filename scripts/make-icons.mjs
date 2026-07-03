// Regenerate the extension icons the manifest references, from two sources:
//   - icons/mark.svg       -> 16, 32  (a simplified broom-and-link mark that
//                             stays legible at toolbar sizes, where the full
//                             logo's clock and sparkles blur into noise)
//   - icons/linksweepr.png -> 48, 128 (the full logo; its solid white background
//                             is flood-filled to transparent so it sits cleanly
//                             on any surface, keeping interior light pixels like
//                             the clock face and sparkles)
// Dev-only: the PNGs are committed, so the shipped extension carries no
// dependencies and CI does not run this. Regenerate after editing a source:
//   npm run icons
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const iconsDir = join(root, "icons");

// Remove the border-connected white background, so only the outer field is
// cleared and interior light pixels survive. Returns a raw RGBA buffer plus its
// dimensions for sharp to re-ingest.
async function floodFillWhiteToTransparent(pngPath) {
  const { data, info } = await sharp(pngPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const isWhite = (i) => {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    return r >= 246 && g >= 246 && b >= 246 && Math.max(r, g, b) - Math.min(r, g, b) <= 6;
  };
  const visited = new Uint8Array(width * height);
  const stack = [];
  const seed = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (visited[p] || !isWhite(p * channels)) return;
    visited[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < width; x++) {
    seed(x, 0);
    seed(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    seed(0, y);
    seed(width - 1, y);
  }
  while (stack.length) {
    const p = stack.pop();
    const x = p % width;
    const y = (p - x) / width;
    seed(x + 1, y);
    seed(x - 1, y);
    seed(x, y + 1);
    seed(x, y - 1);
  }
  for (let p = 0; p < width * height; p++) {
    if (visited[p]) data[p * channels + 3] = 0;
  }
  return { data, width, height, channels };
}

async function writeSized(image, size) {
  const out = join(iconsDir, `icon-${size}.png`);
  await image
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: "lanczos3",
    })
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(`wrote icons/icon-${size}.png`);
}

// 16 and 32 from the simplified mark. A high render density keeps the small
// rasters crisp.
const mark = await readFile(join(iconsDir, "mark.svg"));
for (const size of [16, 32]) {
  await writeSized(sharp(mark, { density: 512 }), size);
}

// 48 and 128 from the full logo with its background removed.
const { data, width, height, channels } = await floodFillWhiteToTransparent(
  join(iconsDir, "linksweepr.png")
);
for (const size of [48, 128]) {
  await writeSized(sharp(data, { raw: { width, height, channels } }), size);
}
