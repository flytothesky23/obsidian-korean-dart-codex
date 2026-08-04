import { discoverKoreanDartMcpStatus } from "../src/codex-mcp-status";

const minimumVersion = "0.9.0";
const status = await discoverKoreanDartMcpStatus({
  runtime: {
    source: "custom",
    command: process.env.CODEX_SMOKE_COMMAND?.trim() || "codex",
    permissionMode: "auto",
    environmentVariables: "",
  },
  cwd: process.cwd(),
  timeoutMs: 30_000,
});

if (status.state !== "ready") {
  throw new Error(status.error || `korean-dart MCP status is ${status.state}`);
}
if (!isAtLeast(status.version, minimumVersion)) {
  throw new Error(`korean-dart MCP ${status.version} is older than required ${minimumVersion}`);
}
if (status.toolCount < 1) {
  throw new Error("The korean-dart MCP configured in Codex did not expose any tools.");
}

console.log(JSON.stringify({
  status: "ok",
  server: status.name,
  version: status.version,
  exposedTools: status.toolCount,
  authStatus: status.authStatus,
}, null, 2));

function isAtLeast(actual: string, minimum: string): boolean {
  const left = actual.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = minimum.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftPart = left[index] ?? 0;
    const rightPart = right[index] ?? 0;
    if (leftPart !== rightPart) return leftPart > rightPart;
  }
  return true;
}
