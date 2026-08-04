import { existsSync, readFileSync } from "node:fs";

const required = ["main.js", "manifest.json", "styles.css", "versions.json"];
const missing = required.filter((file) => !existsSync(file));
if (missing.length) {
  console.error(`Missing release files: ${missing.join(", ")}`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const versions = JSON.parse(readFileSync("versions.json", "utf8"));

if (pkg.version !== manifest.version) {
  console.error(`Version mismatch: package.json=${pkg.version}, manifest.json=${manifest.version}`);
  process.exit(1);
}

if (lock.version !== pkg.version || lock.packages?.[""]?.version !== pkg.version) {
  console.error(`Version mismatch: package-lock.json=${lock.version}, package.json=${pkg.version}`);
  process.exit(1);
}

if (!versions[manifest.version]) {
  console.error(`versions.json does not include ${manifest.version}`);
  process.exit(1);
}

console.log(`Release check passed for ${manifest.id}@${manifest.version}`);
