import { build } from "esbuild";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";

const mode = process.argv[2];
if (mode !== "--contract" && mode !== "--live") {
  throw new Error("Usage: node scripts/run-upstream-mcp-smoke.mjs --contract|--live");
}
process.env.KOREAN_DART_MCP_SMOKE_MODE = mode === "--live" ? "live" : "contract";

const folder = await mkdtemp(join(tmpdir(), "korean-dart-codex-upstream-mcp-"));
const outfile = join(folder, "smoke.mjs");

try {
  await build({
    entryPoints: ["scripts/upstream-mcp-smoke.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile,
    logLevel: "warning",
  });
  await import(pathToFileURL(outfile).href);
} finally {
  await rm(folder, { recursive: true, force: true });
}
