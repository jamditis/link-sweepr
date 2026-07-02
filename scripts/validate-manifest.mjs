// Validates manifest.json invariants with no dependencies.
// Run: node scripts/validate-manifest.mjs
import { readFileSync } from "node:fs";

let manifest;
try {
  manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
} catch (error) {
  console.error("manifest.json is not valid JSON:", error.message);
  process.exit(1);
}

const errors = [];
function check(condition, message) {
  if (!condition) errors.push(message);
}

check(manifest.manifest_version === 3, "manifest_version must be 3");
check(
  typeof manifest.name === "string" && manifest.name.length > 0,
  "name is required"
);
check(
  /^\d+(\.\d+){0,3}$/.test(String(manifest.version || "")),
  "version must be a dotted-number string, e.g. 1.1.0"
);
check(
  typeof manifest.description === "string" && manifest.description.length > 0,
  "description is required"
);
check(
  manifest.background &&
    typeof manifest.background.service_worker === "string",
  "background.service_worker is required"
);
check(Array.isArray(manifest.permissions), "permissions must be an array");

// Every permission the service worker relies on must be declared.
const required = ["history", "storage", "webNavigation", "alarms"];
for (const permission of required) {
  check(
    Array.isArray(manifest.permissions) &&
      manifest.permissions.includes(permission),
    `missing required permission: ${permission}`
  );
}

if (errors.length) {
  console.error("manifest.json validation failed:");
  for (const error of errors) console.error("  - " + error);
  process.exit(1);
}

console.log("manifest.json is valid (MV3, all required permissions present)");
