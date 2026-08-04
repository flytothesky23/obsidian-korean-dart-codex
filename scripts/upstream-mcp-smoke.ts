import { spawn } from "child_process";
import { AppServerTransport } from "../src/appserver-transport";

type JsonObject = Record<string, unknown>;

const packageSpec = process.env.KOREAN_DART_MCP_PACKAGE?.trim() || "korean-dart-mcp@0.10.1";
const mode = process.env.KOREAN_DART_MCP_SMOKE_MODE === "live" ? "live" : "contract";
const dartApiKey = process.env.DART_API_KEY?.trim();
if (mode === "live" && !dartApiKey) {
  throw new Error("Live upstream MCP smoke requires DART_API_KEY.");
}
const command = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(command, ["-y", packageSpec], {
  cwd: process.cwd(),
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    DART_API_KEY: dartApiKey || "contract-smoke-placeholder",
  },
  windowsHide: true,
});

let stderr = "";
child.stderr?.on("data", (chunk: Buffer) => {
  stderr += chunk.toString("utf8");
  if (stderr.length > 8_000) stderr = stderr.slice(-8_000);
});

const transport = new AppServerTransport(child);
transport.start();
transport.onServerRequest(async () => ({}));

try {
  const initialized = await transport.request<JsonObject>("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "korean-dart-codex-upstream-smoke", version: "0.1.0" },
  }, 45_000);
  transport.notify("notifications/initialized");
  const listed = await transport.request<JsonObject>("tools/list", {}, 45_000);
  const tools = Array.isArray(listed.tools) ? listed.tools : [];
  const names = tools.flatMap((tool) => {
    const name = tool && typeof tool === "object" ? (tool as JsonObject).name : "";
    return typeof name === "string" && name ? [name] : [];
  });
  const required = ["resolve_corp_code", "search_disclosures", "get_company", "get_financials"];
  const missing = required.filter((name) => !names.includes(name));
  if (missing.length) throw new Error(`Upstream MCP is missing required tools: ${missing.join(", ")}`);
  if (names.length < 15) throw new Error(`Expected at least 15 upstream tools, received ${names.length}.`);

  let liveCompanyVerified = false;
  if (mode === "live") {
    const result = await transport.request<JsonObject>("tools/call", {
      name: "get_company",
      arguments: { corp: "00126380" },
    }, 120_000);
    if (result.isError === true) throw new Error("get_company returned an MCP tool error.");
    const serialized = JSON.stringify(result);
    if (!serialized.includes("00126380") || !serialized.includes("삼성전자")) {
      throw new Error("get_company did not return the expected Samsung Electronics identity.");
    }
    liveCompanyVerified = true;
  }

  const serverInfo = initialized.serverInfo && typeof initialized.serverInfo === "object"
    ? initialized.serverInfo as JsonObject
    : {};
  console.log(JSON.stringify({
    status: "ok",
    mode,
    packageSpec,
    server: serverInfo.name ?? "korean-dart-mcp",
    serverVersion: serverInfo.version ?? "unknown",
    toolCount: names.length,
    requiredTools: required,
    liveCompanyVerified,
  }, null, 2));
} catch (error) {
  const detail = stderr.trim();
  throw new Error([error instanceof Error ? error.message : String(error), detail].filter(Boolean).join("\n"));
} finally {
  transport.dispose();
  child.stdin?.end();
  if (!child.killed) child.kill("SIGTERM");
}
