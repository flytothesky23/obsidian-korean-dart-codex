import {
  discoverKoreaStockMcpStatus,
  discoverKoreanDartMcpStatus,
} from "../src/codex-mcp-status";

const minimumVersion = "0.9.0";
const runtime = {
  source: "custom" as const,
  command: process.env.CODEX_SMOKE_COMMAND?.trim() || "codex",
  permissionMode: "auto" as const,
  environmentVariables: "DART_API_KEY=contract-smoke-placeholder\nKRX_API_KEY=contract-smoke-placeholder",
};
const [status, stockStatus] = await Promise.all([discoverKoreanDartMcpStatus({
  runtime: {
    ...runtime,
  },
  cwd: process.cwd(),
  timeoutMs: 30_000,
  verifyApiAccess: false,
}), discoverKoreaStockMcpStatus({
  runtime,
  cwd: process.cwd(),
  timeoutMs: 30_000,
  source: "managed",
  verifyApiAccess: false,
})]);

if (status.state !== "ready") {
  throw new Error(status.error || `korean-dart MCP status is ${status.state}`);
}
if (!isAtLeast(status.version, minimumVersion)) {
  throw new Error(`korean-dart MCP ${status.version} is older than required ${minimumVersion}`);
}
if (status.toolCount < 1) {
  throw new Error("The korean-dart MCP configured in Codex did not expose any tools.");
}
if (stockStatus.state !== "ready") {
  throw new Error(stockStatus.error || `korea-stock MCP status is ${stockStatus.state}`);
}
if (stockStatus.toolCount !== 8) {
  throw new Error(`korea-stock MCP exposed ${stockStatus.toolCount} tools instead of the audited 8-tool package contract.`);
}

console.log(JSON.stringify({
  status: "ok",
  servers: [
    {
      server: status.name,
      version: status.version,
      exposedTools: status.toolCount,
      authStatus: status.authStatus,
    },
    {
      server: stockStatus.name,
      version: stockStatus.version,
      exposedTools: stockStatus.toolCount,
      authStatus: stockStatus.authStatus,
    },
  ],
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
