import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const targets = (process.env.KOREAN_DART_CODEX_DEPLOY_TARGETS ?? "")
  .split(/\r?\n|,/)
  .map((target) => target.trim())
  .filter(Boolean);

if (targets.length === 0) {
  console.error([
    "Set KOREAN_DART_CODEX_DEPLOY_TARGETS to one or more plugin install directories.",
    "Example:",
    "KOREAN_DART_CODEX_DEPLOY_TARGETS=/path/to/vault/.obsidian/plugins/korean-dart-codex npm run deploy:local",
  ].join("\n"));
  process.exit(1);
}

for (const target of targets) {
  mkdirSync(target, { recursive: true });
  for (const file of ["main.js", "manifest.json", "styles.css", "versions.json"]) {
    copyFileSync(file, join(target, file));
  }
  console.log(`Deployed Korean DART Codex to ${target}`);
}
