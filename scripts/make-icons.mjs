// Rasterize icons/icon.svg to the PNG sizes the manifest references.
// Dev-only: the icons are committed, so the shipped extension carries no
// dependencies and CI does not run this. Regenerate after editing icon.svg:
//   npm run icons
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "icons", "icon.svg");
const sizes = [16, 32, 48, 128];

const svg = await readFile(src);
for (const size of sizes) {
  const out = join(root, "icons", `icon-${size}.png`);
  await sharp(svg, { density: 384 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(`wrote icons/icon-${size}.png`);
}
