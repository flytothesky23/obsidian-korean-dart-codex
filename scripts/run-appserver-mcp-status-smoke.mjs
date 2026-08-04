import { build } from "esbuild";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";

const folder = await mkdtemp(join(tmpdir(), "korean-dart-codex-mcp-status-"));
const outfile = join(folder, "smoke.mjs");

try {
  await build({
    entryPoints: ["scripts/appserver-mcp-status-smoke.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile,
    logLevel: "warning",
  });
  await import(pathToFileURL(outfile).href);
} finally {
  await rm(folder, { recursive: true, force: true });
}
