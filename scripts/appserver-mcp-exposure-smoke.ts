import { spawn, type ChildProcess } from "child_process";
import { AppServerTransport } from "../src/appserver-transport";
import {
  buildCodexEnvironment,
  createCodexSpawnPlan,
  resolveCodexCommand,
} from "../src/codex-cli";
import { applyKoreanDartMcpConfig } from "../src/korean-dart-mcp-config";

interface McpServerStatus {
  name?: string;
  serverInfo?: { name?: string; version?: string } | null;
  tools?: Record<string, unknown>;
  authStatus?: string;
}

interface McpServerStatusResponse {
  data?: McpServerStatus[];
}

const EXPECTED_TOOL_COUNT = 18;
const CONTRACT_API_KEY = "contract-smoke-placeholder";
const REQUIRED_TOOLS = [
  "resolve_corp_code",
  "search_disclosures",
  "get_company",
  "get_financials",
] as const;
const cwd = process.cwd();
const exposureTimeoutMs = Number.parseInt(process.env.CODEX_SMOKE_TIMEOUT_MS ?? "30000", 10);
const command = resolveCodexCommand(process.env.CODEX_SMOKE_COMMAND?.trim() || "codex");
const args = applyKoreanDartMcpConfig(["app-server", "--listen", "stdio://"], "managed");
const plan = createCodexSpawnPlan(command, args);
const child = spawn(plan.command, plan.args, {
  cwd,
  env: {
    ...buildCodexEnvironment("", command, { cwd }),
    DART_API_KEY: CONTRACT_API_KEY,
  },
  shell: plan.shell,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
const transport = new AppServerTransport(child);
let stderr = "";
const koreanDartNotifications: Array<{ method: string; params: unknown }> = [];

child.stderr?.on("data", (chunk: Buffer) => {
  stderr += chunk.toString("utf8");
  if (stderr.length > 10_000) stderr = stderr.slice(-10_000);
});
transport.start();
transport.onServerRequest(async () => ({ decision: "decline" }));
transport.onNotification((method, params) => {
  const serialized = JSON.stringify(params);
  if (method.includes("mcp") && serialized.includes("korean-dart")) {
    koreanDartNotifications.push({ method, params });
  }
});

try {
  await transport.request("initialize", {
    clientInfo: { name: "korean-dart-codex-mcp-exposure-smoke", version: "0.1.1" },
    capabilities: { experimentalApi: true },
  }, 30_000);
  transport.notify("initialized");

  const config = await transport.request<Record<string, unknown>>("config/read", {
    cwd,
    includeLayers: false,
  }, 30_000);
  if (!hasKoreanDartConfig(config)) {
    throw new Error("Codex app-server did not load the managed korean-dart config with its DART_API_KEY allowlist.");
  }

  const status = await waitForKoreanDart(transport, exposureTimeoutMs);
  const toolNames = Object.keys(status.tools ?? {});

  console.log(JSON.stringify({
    status: "ok",
    configured: true,
    secretForwarding: "allowlisted",
    server: status.name,
    version: status.serverInfo?.version ?? "unknown",
    exposedTools: toolNames.length,
    requiredTools: REQUIRED_TOOLS,
    authStatus: status.authStatus ?? "unknown",
  }, null, 2));
} catch (error) {
  const detail = [error instanceof Error ? error.message : String(error), redactDiagnostics(stderr.trim())]
    .filter(Boolean)
    .join("\n");
  throw new Error([
    detail,
    `korean-dart notifications: ${redactDiagnostics(JSON.stringify(koreanDartNotifications.slice(-10)))}`,
  ].join("\n"));
} finally {
  transport.dispose();
  await terminateChild(child);
}

async function waitForKoreanDart(
  appServer: AppServerTransport,
  timeoutMs: number,
): Promise<McpServerStatus> {
  const deadline = Date.now() + timeoutMs;
  let lastNames: string[] = [];
  let lastToolNames: string[] = [];
  let lastKoreanDart: McpServerStatus | undefined;
  while (Date.now() < deadline) {
    const response = await appServer.request<McpServerStatusResponse>("mcpServerStatus/list", {
      detail: "toolsAndAuthOnly",
    }, 10_000);
    const servers = response.data ?? [];
    lastNames = servers.map((server) => server.name ?? "unknown");
    const koreanDart = servers.find((server) => server.name === "korean-dart");
    if (koreanDart) lastKoreanDart = koreanDart;
    lastToolNames = Object.keys(koreanDart?.tools ?? {});
    const hasRequiredTools = REQUIRED_TOOLS.every((name) => lastToolNames.includes(name));
    if (koreanDart && lastToolNames.length === EXPECTED_TOOL_COUNT && hasRequiredTools) {
      return koreanDart;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error([
    `Codex app-server did not expose the expected ${EXPECTED_TOOL_COUNT} korean-dart tools. Loaded servers: ${lastNames.join(", ") || "none"}`,
    `Observed korean-dart tools: ${lastToolNames.join(", ") || "none"}`,
    `Last korean-dart status: ${JSON.stringify(lastKoreanDart ?? null)}`,
  ].join("\n"));
}

async function terminateChild(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null || process.signalCode !== null) return;

  const closed = new Promise<void>((resolve) => process.once("close", () => resolve()));
  process.stdin?.end();
  process.kill("SIGTERM");
  if (await waitForClose(closed, 2_000)) return;

  process.kill("SIGKILL");
  await waitForClose(closed, 2_000);
}

async function waitForClose(closed: Promise<void>, timeoutMs: number): Promise<boolean> {
  return Promise.race([
    closed.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

function hasKoreanDartConfig(response: Record<string, unknown>): boolean {
  const config = asObject(response.config);
  const servers = asObject(config.mcp_servers);
  const koreanDart = asObject(servers["korean-dart"]);
  const envVars = Array.isArray(koreanDart.env_vars) ? koreanDart.env_vars : [];
  return Boolean(koreanDart.command) && envVars.includes("DART_API_KEY");
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function redactDiagnostics(value: string): string {
  return value
    .replace(/\b(DART_API_KEY|api[_-]?key|token)\s*([=:])\s*([^\s,;]+)/gi, "$1$2[redacted]")
    .replace(/\b[0-9a-f]{40}\b/gi, "[redacted-credential]");
}
