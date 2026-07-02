// Lints the assembled extension with addons-linter and fails only on findings
// that apply to Chrome/Edge (Manifest V3). addons-linter is Mozilla's Firefox
// validator, so a fixed set of Firefox-only rule codes is filtered out, each
// with the reason it does not apply to our targets. Any other error still fails.
//
// Usage: node scripts/check-lint.mjs <extension-dir>
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const extDir = process.argv[2] || "dist/ext";

// Resolve the addons-linter CLI and run it through the current Node binary.
// Invoking node directly (rather than the npx or .cmd shim) avoids the Windows
// "spawn npx ENOENT" failure and needs no shell, so the extension dir is passed
// as a literal argv entry with no quoting or injection concerns.
const linterCli = require.resolve("addons-linter/bin/addons-linter");

const IGNORED_CODES = new Map([
  [
    "BACKGROUND_SERVICE_WORKER_NOFALLBACK",
    "Firefox wants background.scripts alongside service_worker; Chrome/Edge use service_worker only.",
  ],
  [
    "ADDON_ID_REQUIRED",
    "browser_specific_settings.gecko.id is Firefox-only; the Chrome and Edge stores assign the ID.",
  ],
  [
    "MISSING_DATA_COLLECTION_PERMISSIONS",
    "gecko.data_collection_permissions is Firefox-only.",
  ],
]);

let stdout;
try {
  stdout = execFileSync(process.execPath, [linterCli, "--output=json", extDir], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
} catch (error) {
  // addons-linter exits non-zero when it reports errors; the JSON report is
  // still written to stdout, so parse that rather than trusting the exit code.
  stdout = error.stdout || "";
  if (!stdout) {
    console.error("addons-linter produced no output.");
    console.error(String(error.stderr || error.message).slice(0, 2000));
    process.exit(1);
  }
}

let report;
try {
  report = JSON.parse(stdout);
} catch {
  console.error("Could not parse addons-linter JSON output.");
  console.error(stdout.slice(0, 2000));
  process.exit(1);
}

const allErrors = Array.isArray(report.errors) ? report.errors : [];
const relevant = allErrors.filter((entry) => !IGNORED_CODES.has(entry.code));
const filtered = allErrors.filter((entry) => IGNORED_CODES.has(entry.code));

for (const entry of filtered) {
  console.log(`ignored (Firefox-only): ${entry.code} - ${IGNORED_CODES.get(entry.code)}`);
}
for (const warning of report.warnings || []) {
  console.log(`warning: ${warning.code}: ${warning.message}`);
}

if (relevant.length > 0) {
  console.error(`\naddons-linter reported ${relevant.length} Chrome/Edge-relevant error(s):`);
  for (const entry of relevant) {
    console.error(`  ${entry.code} [${entry.file || "manifest.json"}]: ${entry.message}`);
  }
  process.exit(1);
}

console.log(
  `\naddons-linter passed: no Chrome/Edge-relevant errors (${filtered.length} Firefox-only finding(s) filtered).`
);
