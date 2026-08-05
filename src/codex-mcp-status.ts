import { spawn, type ChildProcess } from "child_process";
import { AppServerTransport } from "./appserver-transport";
import {
  buildCodexEnvironment,
  createCodexSpawnPlan,
  decodeProcessChunk,
  resolveCodexCommand,
} from "./codex-cli";
import type { CodexRuntimeConfig } from "./codexian-bridge";
import {
  hasDartApiKey,
  managedKoreanDartMcpConfig,
  type KoreanDartMcpSource,
} from "./korean-dart-mcp-config";
import {
  hasKrxApiKey,
  managedKoreaStockMcpConfig,
  type KoreaStockMcpSource,
} from "./korea-stock-mcp-config";
import { shouldCreateProcessGroup, terminateProcessTree } from "./process-tree";

type JsonObject = Record<string, unknown>;

export type KoreanDartMcpState = "checking" | "ready" | "missing" | "failed";
export type CodexMcpState = KoreanDartMcpState;
export type CodexMcpSource = "managed" | "codex-config";
export type CodexMcpServerId = "korean-dart" | "korea-stock";

export interface KoreanDartMcpStatus {
  state: CodexMcpState;
  name: string;
  version: string;
  toolCount: number;
  authStatus: string;
  checkedAt: number;
  error: string;
  source?: CodexMcpSource;
  serverId?: CodexMcpServerId;
}

export type CodexMcpStatus = KoreanDartMcpStatus;

export interface CodexMcpStdioConfig {
  enabled: boolean;
  command: string;
  args: string[];
  cwd: string | null;
  env: Record<string, string>;
}

export const INITIAL_KOREAN_DART_MCP_STATUS: KoreanDartMcpStatus = {
  state: "checking",
  name: "korean-dart",
  version: "",
  toolCount: 0,
  authStatus: "",
  checkedAt: 0,
  error: "",
  serverId: "korean-dart",
};

export const INITIAL_KOREA_STOCK_MCP_STATUS: CodexMcpStatus = {
  state: "checking",
  name: "korea-stock",
  version: "",
  toolCount: 0,
  authStatus: "",
  checkedAt: 0,
  error: "",
  serverId: "korea-stock",
};

export async function discoverKoreanDartMcpStatus(input: {
  runtime: CodexRuntimeConfig;
  cwd: string;
  timeoutMs: number;
  verifyApiAccess?: boolean;
}): Promise<KoreanDartMcpStatus> {
  return discoverCodexMcpStatus({
    ...input,
    server: KOREAN_DART_SERVER_DEFINITION,
    source: input.runtime.koreanDartMcpSource ?? "managed",
  });
}

export async function discoverKoreaStockMcpStatus(input: {
  runtime: CodexRuntimeConfig;
  cwd: string;
  timeoutMs: number;
  source?: KoreaStockMcpSource;
  verifyApiAccess?: boolean;
}): Promise<CodexMcpStatus> {
  return discoverCodexMcpStatus({
    ...input,
    server: KOREA_STOCK_SERVER_DEFINITION,
    source: input.source ?? "managed",
  });
}

export async function discoverCodexMcpStatus(input: {
  runtime: CodexRuntimeConfig;
  cwd: string;
  timeoutMs: number;
  server: CodexMcpServerDefinition;
  source?: CodexMcpSource;
  verifyApiAccess?: boolean;
}): Promise<CodexMcpStatus> {
  const codexCommand = resolveCodexCommand(input.runtime.command);
  const baseEnv = buildCodexEnvironment(input.runtime.environmentVariables, codexCommand, { cwd: input.cwd });
  const source = input.source ?? "managed";
  let config: CodexMcpStdioConfig;
  if (source === "managed") {
    config = { enabled: true, ...input.server.managedConfig() };
  } else {
    const configResult = await readCodexMcpConfig({
      command: codexCommand,
      cwd: input.cwd,
      env: baseEnv,
      timeoutMs: Math.min(input.timeoutMs, 10_000),
      spawn,
      createCodexSpawnPlan,
      decodeProcessChunk,
      serverName: input.server.serverId,
    });
    const configured = parseCodexMcpConfigForServer(configResult.stdout, input.server.serverId);
    if (!configured) {
      return missingStatus(`Codex MCP 설정에서 ${input.server.serverId} 서버를 찾지 못했습니다.`, input.server, source);
    }
    if (!configured.enabled) {
      return missingStatus(`Codex MCP 설정에서 ${input.server.serverId} 서버가 비활성화되어 있습니다.`, input.server, source);
    }
    config = configured;
  }

  const processEnv = { ...baseEnv, ...config.env };
  if (!input.server.hasApiKey(processEnv)) {
    return missingStatus(`${input.server.authLabel}가 설정되지 않았습니다. 플러그인 설정에서 API 키를 입력하세요.`, input.server, source, "missing");
  }

  const spawnPlan = createCodexSpawnPlan(config.command, config.args);
  const child = spawn(spawnPlan.command, spawnPlan.args, {
    cwd: config.cwd || input.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: processEnv,
    shell: spawnPlan.shell,
    detached: shouldCreateProcessGroup(),
    windowsHide: true,
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += decodeProcessChunk(chunk);
    if (stderr.length > 4_000) stderr = stderr.slice(-4_000);
  });

  const transport = new AppServerTransport(child);
  transport.start();
  transport.onServerRequest(async () => ({}));

  try {
    const initialized = await transport.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: `${input.server.serverId}-codex-mcp-status`, version: "0.2.0" },
    }, input.timeoutMs);
    transport.notify("notifications/initialized");
    const tools = await transport.request("tools/list", {}, input.timeoutMs);
    const health = parseMcpHealthForServer(initialized, tools, input.server, source);
    if (health.state !== "ready" || input.verifyApiAccess === false) return health;
    return await verifyOfficialApiAccess(transport, health, input.server, input.timeoutMs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const detail = stderr.trim();
    throw new Error([message, detail].filter(Boolean).join("\n"));
  } finally {
    transport.dispose();
    await terminateProcessTree(child);
  }
}

export function parseCodexMcpConfig(value: string): CodexMcpStdioConfig | null {
  return parseCodexMcpConfigForServer(value, "korean-dart");
}

export function parseCodexMcpConfigForServer(value: string, serverName: string): CodexMcpStdioConfig | null {
  let root: JsonObject;
  try {
    root = asObject(JSON.parse(value));
  } catch {
    return null;
  }
  const transport = asObject(root.transport);
  if (readString(root.name) !== serverName || readString(transport.type) !== "stdio") return null;
  const command = readString(transport.command);
  if (!command) return null;
  return {
    enabled: root.enabled !== false,
    command,
    args: Array.isArray(transport.args) ? transport.args.flatMap((entry) => {
      const text = readString(entry);
      return text ? [text] : [];
    }) : [],
    cwd: readString(transport.cwd) || null,
    env: Object.fromEntries(Object.entries(asObject(transport.env)).flatMap(([key, entry]) => {
      const text = readString(entry);
      return text ? [[key, text]] : [];
    })),
  };
}

export function parseMcpHealth(
  initializeValue: unknown,
  toolsValue: unknown,
  source: KoreanDartMcpSource = "codex-config",
): KoreanDartMcpStatus {
  return parseMcpHealthForServer(initializeValue, toolsValue, KOREAN_DART_SERVER_DEFINITION, source);
}

export function parseMcpHealthForServer(
  initializeValue: unknown,
  toolsValue: unknown,
  server: CodexMcpServerDefinition,
  source: CodexMcpSource = "codex-config",
): CodexMcpStatus {
  const serverInfo = asObject(asObject(initializeValue).serverInfo);
  const version = readString(serverInfo.version);
  if (!version) {
    return failedStatus(`${server.serverId} MCP가 초기화 응답에 버전 정보를 제공하지 않았습니다.`, server, source);
  }
  const tools = asObject(toolsValue).tools;
  const toolNames = Array.isArray(tools) ? tools.flatMap((tool) => {
    const name = readString(asObject(tool).name);
    return name ? [name] : [];
  }) : [];
  const missingTools = server.requiredToolNames.filter((toolName) => !toolNames.includes(toolName));
  if (missingTools.length) {
    return failedStatus(`${server.serverId} MCP 필수 도구를 찾지 못했습니다: ${missingTools.join(", ")}`, server, source);
  }
  return {
    state: "ready",
    name: readString(serverInfo.name) || server.serverId,
    version,
    toolCount: toolNames.length,
    authStatus: "configured",
    checkedAt: Date.now(),
    error: "",
    source,
    serverId: server.serverId,
  };
}

export function summarizeMcpStatusError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|ghp|gho|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/gi, "[redacted]")
    .replace(/\b(DART_API_KEY|KRX_API_KEY|apikey|api_key|x-api-key|token)\s*([=:])\s*([^\s,;]+)/gi, "$1$2[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280) || "korean-dart MCP 상태 확인에 실패했습니다.";
}

async function readCodexMcpConfig(input: {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  spawn: typeof import("child_process").spawn;
  createCodexSpawnPlan: (command: string, args: string[]) => { command: string; args: string[]; shell: boolean };
  decodeProcessChunk: (chunk: Buffer) => string;
  serverName: string;
}): Promise<{ stdout: string; stderr: string }> {
  const spawnPlan = input.createCodexSpawnPlan(input.command, ["mcp", "get", input.serverName, "--json"]);
  return await new Promise((resolve, reject) => {
    const child = input.spawn(spawnPlan.command, spawnPlan.args, {
      cwd: input.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: input.env,
      shell: spawnPlan.shell,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => finish(new Error("Codex MCP 설정 조회 시간이 초과되었습니다.")), input.timeoutMs);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        if (!child.killed) child.kill("SIGTERM");
        reject(error);
      }
      else resolve({ stdout, stderr });
    };
    child.stdout?.on("data", (chunk: Buffer) => { stdout += input.decodeProcessChunk(chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += input.decodeProcessChunk(chunk); });
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      if (code === 0) finish();
      else finish(new Error(stderr.trim() || stdout.trim() || `codex mcp get exited with code ${code ?? "unknown"}`));
    });
  });
}

function missingStatus(
  error: string,
  server: CodexMcpServerDefinition,
  source?: CodexMcpSource,
  authStatus = "",
): CodexMcpStatus {
  return {
    ...initialStatus(server.serverId),
    state: "missing",
    checkedAt: Date.now(),
    error,
    source,
    authStatus,
  };
}

function failedStatus(error: string, server: CodexMcpServerDefinition, source?: CodexMcpSource): CodexMcpStatus {
  return {
    ...initialStatus(server.serverId),
    state: "failed",
    checkedAt: Date.now(),
    error,
    source,
  };
}

async function verifyOfficialApiAccess(
  transport: AppServerTransport,
  health: CodexMcpStatus,
  server: CodexMcpServerDefinition,
  timeoutMs: number,
): Promise<CodexMcpStatus> {
  try {
    if (server.serverId === "korea-stock") {
      const args = {
        basDdList: [previousKoreanCalendarDate()],
        market: "KOSPI",
        codeList: ["005930"],
      };
      await callProbeTool(transport, "get_stock_base_info", args, timeoutMs);
      await callProbeTool(transport, "get_stock_trade_info", args, timeoutMs);
    } else {
      await callProbeTool(transport, "get_company", { corp: "00126380" }, timeoutMs);
    }
    return { ...health, authStatus: "verified" };
  } catch (error) {
    const detail = summarizeMcpStatusError(error);
    const authRejected = isApiAuthenticationFailure(detail);
    const guidance = authRejected
      ? server.serverId === "korea-stock"
        ? "KRX API 실조회가 거부되었습니다. 인증키와 유가증권 일별매매정보·종목기본정보 서비스 이용 승인을 확인하세요."
        : "OpenDART API 실조회가 거부되었습니다. 인증키의 발급·활성 상태를 확인하세요."
      : `${server.authLabel}는 설정되어 있지만 공식 API 실조회에 실패했습니다. 잠시 후 다시 확인하세요.`;
    return {
      ...health,
      state: "failed",
      authStatus: authRejected ? "rejected" : "api-error",
      error: `${guidance} ${detail}`.trim().slice(0, 420),
    };
  }
}

export function isApiAuthenticationFailure(value: string): boolean {
  return /(?:\b401\b|Unauthorized|잘못된 인증키|사용자 정보 검증 실패|There is no (?:KRX|DART) API KEY|인증키[^\n]{0,40}(?:거부|오류|유효하지)|API key[^\n]{0,40}(?:invalid|rejected))/i.test(value);
}

async function callProbeTool(
  transport: AppServerTransport,
  name: string,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<void> {
  const result = await transport.request<JsonObject>("tools/call", {
    name,
    arguments: args,
  }, timeoutMs);
  const serialized = JSON.stringify(result);
  if (
    result.isError === true
    || /\b(?:401|Unauthorized|잘못된 인증키|사용자 정보 검증 실패|There is no (?:KRX|DART) API KEY)\b/i.test(serialized)
  ) {
    throw new Error(extractToolError(result) || `${name} API verification failed.`);
  }
}

function extractToolError(result: JsonObject): string {
  const content = Array.isArray(result.content) ? result.content : [];
  return content.flatMap((entry) => {
    const text = readString(asObject(entry).text);
    return text ? [text] : [];
  }).join(" ").slice(0, 260);
}

function previousKoreanCalendarDate(now = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now - 86_400_000));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}${value.month}${value.day}`;
}

interface CodexMcpServerDefinition {
  serverId: CodexMcpServerId;
  authLabel: string;
  managedConfig: () => Omit<CodexMcpStdioConfig, "enabled">;
  hasApiKey: (env: NodeJS.ProcessEnv) => boolean;
  requiredToolNames: string[];
}

const KOREAN_DART_SERVER_DEFINITION: CodexMcpServerDefinition = {
  serverId: "korean-dart",
  authLabel: "OpenDART API 키",
  managedConfig: managedKoreanDartMcpConfig,
  hasApiKey: hasDartApiKey,
  requiredToolNames: [],
};

export const KOREA_STOCK_REQUIRED_TOOL_NAMES = [
  "get_stock_base_info",
  "get_stock_trade_info",
] as const;

export const KOREA_STOCK_SERVER_DEFINITION: CodexMcpServerDefinition = {
  serverId: "korea-stock",
  authLabel: "KRX API 키",
  managedConfig: managedKoreaStockMcpConfig,
  hasApiKey: hasKrxApiKey,
  requiredToolNames: [...KOREA_STOCK_REQUIRED_TOOL_NAMES],
};

function initialStatus(serverId: CodexMcpServerId): CodexMcpStatus {
  return serverId === "korea-stock" ? INITIAL_KOREA_STOCK_MCP_STATUS : INITIAL_KOREAN_DART_MCP_STATUS;
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
