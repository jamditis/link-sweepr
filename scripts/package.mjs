// Assembles the shippable extension into dist/ext and (unless --assemble-only)
// zips it to dist/link-sweepr-<version>.zip with manifest.json at the zip root -
// the layout the Chrome Web Store and Edge Add-ons both require. This script is
// the single source of truth for which files ship: CI's lint step assembles the
// bundle via `--assemble-only`, so the linted bundle and the uploaded zip can
// never drift apart.
//
// Usage:
//   node scripts/package.mjs                  assemble dist/ext, then zip it
//   node scripts/package.mjs --assemble-only  assemble dist/ext only (CI lint input)
import { cpSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";

const AdmZip = createRequire(import.meta.url)("adm-zip");

const ROOT = process.cwd();
const DIST = join(ROOT, "dist");
const EXT = join(DIST, "ext");
const assembleOnly = process.argv.includes("--assemble-only");

// The non-icon files that make up the extension. This list defines what ships
// and what CI lints - keep it correct.
const FILES = [
  "manifest.json",
  "background.js",
  "domain.js",
  "options.html",
  "options.js",
  "popup.html",
  "popup.js",
];

const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));

// The icons that ship are exactly the ones the manifest references (from `icons`
// and `action.default_icon`), so build sources that live in icons/ - the SVG
// mark and the full-logo PNG - never leak into the bundle.
const iconRefs = new Set();
for (const map of [manifest.icons, manifest.action && manifest.action.default_icon]) {
  if (map) for (const rel of Object.values(map)) iconRefs.add(rel);
}

// Fresh assemble dir so a file removed from source never lingers in the bundle.
rmSync(EXT, { recursive: true, force: true });
mkdirSync(EXT, { recursive: true });

for (const file of FILES) {
  cpSync(join(ROOT, file), join(EXT, file));
}
for (const rel of iconRefs) {
  const dest = join(EXT, rel);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(join(ROOT, rel), dest);
}

if (assembleOnly) {
  console.log(`Assembled dist/ext (${FILES.length} files, ${iconRefs.size} icons).`);
  process.exit(0);
}

const zipName = `link-sweepr-${manifest.version}.zip`;
const zipPath = join(DIST, zipName);
rmSync(zipPath, { force: true });

// Zip the contents of dist/ext so manifest.json lands at the zip root. adm-zip
// writes ZIP-spec forward-slash entry paths on every platform; the platform
// archivers do not (Windows Compress-Archive emits backslash separators, which
// break icon resolution and store validation).
const zip = new AdmZip();
zip.addLocalFolder(EXT);
zip.writeZip(zipPath);

console.log(`Packaged ${zipName} (${FILES.length} files, ${iconRefs.size} icons) at ${zipPath}`);
