import { spawn, type ChildProcess } from "child_process";
import { AppServerTransport } from "./appserver-transport";
import {
  buildCodexEnvironment,
  createCodexSpawnPlan,
  decodeProcessChunk,
  resolveCodexCommand,
} from "./codex-cli";
import type { CodexRuntimeConfig } from "./codexian-bridge";

type JsonObject = Record<string, unknown>;

export type KoreanDartMcpState = "checking" | "ready" | "missing" | "failed";

export interface KoreanDartMcpStatus {
  state: KoreanDartMcpState;
  name: string;
  version: string;
  toolCount: number;
  authStatus: string;
  checkedAt: number;
  error: string;
}

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
};

export async function discoverKoreanDartMcpStatus(input: {
  runtime: CodexRuntimeConfig;
  cwd: string;
  timeoutMs: number;
}): Promise<KoreanDartMcpStatus> {
  const codexCommand = resolveCodexCommand(input.runtime.command);
  const baseEnv = buildCodexEnvironment(input.runtime.environmentVariables, codexCommand, { cwd: input.cwd });
  const configResult = await readCodexMcpConfig({
    command: codexCommand,
    cwd: input.cwd,
    env: baseEnv,
    timeoutMs: Math.min(input.timeoutMs, 10_000),
    spawn,
    createCodexSpawnPlan,
    decodeProcessChunk,
  });
  const config = parseCodexMcpConfig(configResult.stdout);
  if (!config) {
    return missingStatus("Codex MCP 설정에서 korean-dart 서버를 찾지 못했습니다.");
  }
  if (!config.enabled) {
    return missingStatus("Codex MCP 설정에서 korean-dart 서버가 비활성화되어 있습니다.");
  }

  const spawnPlan = createCodexSpawnPlan(config.command, config.args);
  const child = spawn(spawnPlan.command, spawnPlan.args, {
    cwd: config.cwd || input.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...baseEnv, ...config.env },
    shell: spawnPlan.shell,
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
      clientInfo: { name: "korean-dart-codex-mcp-status", version: "0.1.0" },
    }, input.timeoutMs);
    transport.notify("notifications/initialized");
    const tools = await transport.request("tools/list", {}, input.timeoutMs);
    return parseMcpHealth(initialized, tools);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const detail = stderr.trim();
    throw new Error([message, detail].filter(Boolean).join("\n"));
  } finally {
    transport.dispose();
    stopChild(child);
  }
}

export function parseCodexMcpConfig(value: string): CodexMcpStdioConfig | null {
  let root: JsonObject;
  try {
    root = asObject(JSON.parse(value));
  } catch {
    return null;
  }
  const transport = asObject(root.transport);
  if (readString(root.name) !== "korean-dart" || readString(transport.type) !== "stdio") return null;
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

export function parseMcpHealth(initializeValue: unknown, toolsValue: unknown): KoreanDartMcpStatus {
  const serverInfo = asObject(asObject(initializeValue).serverInfo);
  const version = readString(serverInfo.version);
  if (!version) {
    return failedStatus("korean-dart MCP가 초기화 응답에 버전 정보를 제공하지 않았습니다.");
  }
  const tools = asObject(toolsValue).tools;
  return {
    state: "ready",
    name: readString(serverInfo.name) || "korean-dart",
    version,
    toolCount: Array.isArray(tools) ? tools.length : 0,
    authStatus: "configured",
    checkedAt: Date.now(),
    error: "",
  };
}

export function summarizeMcpStatusError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|ghp|gho|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/gi, "[redacted]")
    .replace(/\b(DART_API_KEY|apikey|api_key|x-api-key|token)\s*([=:])\s*([^\s,;]+)/gi, "$1$2[redacted]")
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
}): Promise<{ stdout: string; stderr: string }> {
  const spawnPlan = input.createCodexSpawnPlan(input.command, ["mcp", "get", "korean-dart", "--json"]);
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

function stopChild(child: ChildProcess): void {
  child.stdin?.end();
  if (!child.killed) child.kill("SIGTERM");
}

function missingStatus(error: string): KoreanDartMcpStatus {
  return {
    ...INITIAL_KOREAN_DART_MCP_STATUS,
    state: "missing",
    checkedAt: Date.now(),
    error,
  };
}

function failedStatus(error: string): KoreanDartMcpStatus {
  return {
    ...INITIAL_KOREAN_DART_MCP_STATUS,
    state: "failed",
    checkedAt: Date.now(),
    error,
  };
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
