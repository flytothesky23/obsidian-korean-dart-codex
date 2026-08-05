import { execFile, spawn } from "child_process";
import { AppServerTransport } from "../src/appserver-transport";
import {
  buildCodexEnvironment,
  createCodexSpawnPlan,
  resolveCodexCommand,
} from "../src/codex-cli";
import { applyKoreanDartMcpConfig } from "../src/korean-dart-mcp-config";
import { applyKoreaStockMcpConfig } from "../src/korea-stock-mcp-config";
import { shouldCreateProcessGroup, terminateProcessTree } from "../src/process-tree";

interface McpServerStatus {
  name?: string;
  serverInfo?: { name?: string; version?: string } | null;
  tools?: Record<string, unknown>;
  authStatus?: string;
}

interface McpServerStatusResponse {
  data?: McpServerStatus[];
}

const EXPECTED_DART_TOOL_COUNT = 18;
const EXPECTED_STOCK_TOOL_COUNT = 2;
const CONTRACT_API_KEY = "contract-smoke-placeholder";
const REQUIRED_DART_TOOLS = [
  "resolve_corp_code",
  "search_disclosures",
  "get_company",
  "get_financials",
] as const;
const REQUIRED_STOCK_TOOLS = ["get_stock_base_info", "get_stock_trade_info"] as const;
const cwd = process.cwd();
const exposureTimeoutMs = Number.parseInt(process.env.CODEX_SMOKE_TIMEOUT_MS ?? "30000", 10);
const command = resolveCodexCommand(process.env.CODEX_SMOKE_COMMAND?.trim() || "codex");
const args = applyKoreaStockMcpConfig(
  applyKoreanDartMcpConfig(["app-server", "--listen", "stdio://"], "managed"),
  "managed",
);
const plan = createCodexSpawnPlan(command, args);
const child = spawn(plan.command, plan.args, {
  cwd,
  env: {
    ...buildCodexEnvironment("", command, { cwd }),
    DART_API_KEY: CONTRACT_API_KEY,
    KRX_API_KEY: CONTRACT_API_KEY,
  },
  shell: plan.shell,
  detached: shouldCreateProcessGroup(),
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
const transport = new AppServerTransport(child);
let stderr = "";
const researchMcpNotifications: Array<{ method: string; params: unknown }> = [];
let trackedProcessIds: number[] = [];

child.stderr?.on("data", (chunk: Buffer) => {
  stderr += chunk.toString("utf8");
  if (stderr.length > 10_000) stderr = stderr.slice(-10_000);
});
transport.start();
transport.onServerRequest(async () => ({ decision: "decline" }));
transport.onNotification((method, params) => {
  const serialized = JSON.stringify(params);
  if (method.includes("mcp") && (serialized.includes("korean-dart") || serialized.includes("korea-stock"))) {
    researchMcpNotifications.push({ method, params });
  }
});

try {
  await transport.request("initialize", {
    clientInfo: { name: "korean-dart-codex-mcp-exposure-smoke", version: "0.2.0" },
    capabilities: { experimentalApi: true },
  }, 30_000);
  transport.notify("initialized");

  const config = await transport.request<Record<string, unknown>>("config/read", {
    cwd,
    includeLayers: false,
  }, 30_000);
  if (!hasManagedResearchConfig(config)) {
    throw new Error("Codex app-server did not load both managed MCP configs with their credential allowlists.");
  }

  const { koreanDart, koreaStock } = await waitForResearchMcps(transport, exposureTimeoutMs);
  const dartToolNames = Object.keys(koreanDart.tools ?? {});
  const stockToolNames = Object.keys(koreaStock.tools ?? {});
  const processAudit = await auditManagedProcessCommands(child.pid ?? 0);
  trackedProcessIds = processAudit.processIds;
  if (processAudit.hasCredentialAssignment) {
    throw new Error("Managed MCP process command line exposed an API-key assignment.");
  }

  const holdMs = Number.parseInt(process.env.CODEX_SMOKE_HOLD_MS ?? "0", 10);
  if (holdMs > 0) await new Promise((resolve) => setTimeout(resolve, holdMs));

  console.log(JSON.stringify({
    status: "ok",
    configured: true,
    secretForwarding: "allowlisted",
    processCommandLineCredentials: "absent",
    servers: [
      {
        server: koreanDart.name,
        version: koreanDart.serverInfo?.version ?? "unknown",
        exposedTools: dartToolNames.length,
        requiredTools: REQUIRED_DART_TOOLS,
        authStatus: koreanDart.authStatus ?? "unknown",
      },
      {
        server: koreaStock.name,
        version: koreaStock.serverInfo?.version ?? "unknown",
        exposedTools: stockToolNames.length,
        requiredTools: REQUIRED_STOCK_TOOLS,
        authStatus: koreaStock.authStatus ?? "unknown",
      },
    ],
  }, null, 2));
} catch (error) {
  const detail = [error instanceof Error ? error.message : String(error), redactDiagnostics(stderr.trim())]
    .filter(Boolean)
    .join("\n");
  throw new Error([
    detail,
    `research MCP notifications: ${redactDiagnostics(JSON.stringify(researchMcpNotifications.slice(-10)))}`,
  ].join("\n"));
} finally {
  if (!trackedProcessIds.length) {
    trackedProcessIds = (await auditManagedProcessCommands(child.pid ?? 0).catch(() => ({ processIds: [], hasCredentialAssignment: false }))).processIds;
  }
  transport.dispose();
  await terminateChild(child);
  await assertProcessesExited(trackedProcessIds);
}

async function waitForResearchMcps(
  appServer: AppServerTransport,
  timeoutMs: number,
): Promise<{ koreanDart: McpServerStatus; koreaStock: McpServerStatus }> {
  const deadline = Date.now() + timeoutMs;
  let lastNames: string[] = [];
  let lastToolNames: string[] = [];
  let lastStockToolNames: string[] = [];
  let lastKoreanDart: McpServerStatus | undefined;
  let lastKoreaStock: McpServerStatus | undefined;
  while (Date.now() < deadline) {
    const response = await appServer.request<McpServerStatusResponse>("mcpServerStatus/list", {
      detail: "toolsAndAuthOnly",
    }, 10_000);
    const servers = response.data ?? [];
    lastNames = servers.map((server) => server.name ?? "unknown");
    const koreanDart = servers.find((server) => server.name === "korean-dart");
    const koreaStock = servers.find((server) => server.name === "korea-stock");
    if (koreanDart) lastKoreanDart = koreanDart;
    if (koreaStock) lastKoreaStock = koreaStock;
    lastToolNames = Object.keys(koreanDart?.tools ?? {});
    lastStockToolNames = Object.keys(koreaStock?.tools ?? {});
    const hasRequiredDartTools = REQUIRED_DART_TOOLS.every((name) => lastToolNames.includes(name));
    const hasRequiredStockTools = REQUIRED_STOCK_TOOLS.every((name) => lastStockToolNames.includes(name));
    if (
      koreanDart
      && koreaStock
      && lastToolNames.length === EXPECTED_DART_TOOL_COUNT
      && lastStockToolNames.length === EXPECTED_STOCK_TOOL_COUNT
      && hasRequiredDartTools
      && hasRequiredStockTools
    ) {
      return { koreanDart, koreaStock };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error([
    `Codex app-server did not expose the expected DART/KRX MCP tools. Loaded servers: ${lastNames.join(", ") || "none"}`,
    `Observed korean-dart tools: ${lastToolNames.join(", ") || "none"}`,
    `Observed korea-stock tools: ${lastStockToolNames.join(", ") || "none"}`,
    `Last korean-dart status: ${JSON.stringify(lastKoreanDart ?? null)}`,
    `Last korea-stock status: ${JSON.stringify(lastKoreaStock ?? null)}`,
  ].join("\n"));
}

async function terminateChild(process: import("child_process").ChildProcess): Promise<void> {
  await terminateProcessTree(process, { gracefulTimeoutMs: 2_000, forceTimeoutMs: 2_000 });
}

async function auditManagedProcessCommands(rootPid: number): Promise<{
  processIds: number[];
  hasCredentialAssignment: boolean;
}> {
  if (!rootPid || process.platform === "win32") return { processIds: [], hasCredentialAssignment: false };
  const stdout = await execFileText("ps", ["-axo", "pid=,ppid=,command="]);
  const entries = stdout.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }] : [];
  });
  const processIds = [rootPid];
  for (let index = 0; index < processIds.length; index += 1) {
    const parent = processIds[index];
    for (const entry of entries) {
      if (entry.ppid === parent && !processIds.includes(entry.pid)) processIds.push(entry.pid);
    }
  }
  const commands = entries.filter((entry) => processIds.includes(entry.pid)).map((entry) => entry.command);
  const pgrepOutput = await execFileText("pgrep", ["-fl", "korean-dart-mcp|korea-stock-mcp|korean-dart-codex-managed-launcher"])
    .catch(() => "");
  for (const line of pgrepOutput.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(.*)$/);
    if (match && processIds.includes(Number(match[1]))) commands.push(match[2]);
  }
  return {
    processIds,
    hasCredentialAssignment: commands.some((commandLine) =>
      /(?:DART_API_KEY|KRX_API_KEY)=\S+/.test(commandLine)
      || commandLine.includes(CONTRACT_API_KEY)),
  };
}

async function assertProcessesExited(processIds: number[]): Promise<void> {
  if (!processIds.length || process.platform === "win32") return;
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (processIds.every((pid) => !isProcessAlive(pid))) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const alive = processIds.filter((pid) => isProcessAlive(pid));
  if (alive.length) throw new Error(`Managed MCP process tree remained alive after shutdown (${alive.length} process(es)).`);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function execFileText(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8" }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function hasManagedResearchConfig(response: Record<string, unknown>): boolean {
  const config = asObject(response.config);
  const servers = asObject(config.mcp_servers);
  const koreanDart = asObject(servers["korean-dart"]);
  const envVars = Array.isArray(koreanDart.env_vars) ? koreanDart.env_vars : [];
  const koreaStock = asObject(servers["korea-stock"]);
  const stockEnvVars = Array.isArray(koreaStock.env_vars) ? koreaStock.env_vars : [];
  const stockEnabledTools = Array.isArray(koreaStock.enabled_tools) ? koreaStock.enabled_tools : [];
  return Boolean(koreanDart.command)
    && envVars.includes("DART_API_KEY")
    && Boolean(koreaStock.command)
    && stockEnvVars.includes("KRX_API_KEY")
    && !stockEnvVars.includes("DART_API_KEY")
    && REQUIRED_STOCK_TOOLS.every((tool) => stockEnabledTools.includes(tool))
    && stockEnabledTools.length === REQUIRED_STOCK_TOOLS.length;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function redactDiagnostics(value: string): string {
  return value
    .replace(/\b(DART_API_KEY|KRX_API_KEY|api[_-]?key|token)\s*([=:])\s*([^\s,;]+)/gi, "$1$2[redacted]")
    .replace(/\b[0-9a-f]{40}\b/gi, "[redacted-credential]");
}
