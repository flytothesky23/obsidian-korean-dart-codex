import { spawn } from "child_process";
import { existsSync, readFileSync, rmSync } from "fs";
import { tmpdir, homedir } from "os";
import { delimiter, dirname, join, sep, win32 } from "path";
import type { CodexPermissionMode } from "./codexian-bridge";
import {
  applyKoreanDartMcpConfig,
  type KoreanDartMcpSource,
} from "./korean-dart-mcp-config";
import {
  applyKoreaStockMcpConfig,
  type KoreaStockMcpSource,
} from "./korea-stock-mcp-config";
import { shouldCreateProcessGroup, terminateProcessTree } from "./process-tree";

export interface CodexCliResult {
  stdout: string;
  stderr: string;
}

export interface BuildCodexEnvironmentOptions {
  platform?: NodeJS.Platform;
  baseEnv?: NodeJS.ProcessEnv;
  cwd?: string;
  readFile?: (path: string, encoding: BufferEncoding) => string;
}

export interface CodexSpawnPlan {
  command: string;
  args: string[];
  shell: boolean;
}

export const CODEX_COMMAND_CANDIDATES = [
  join(homedir(), ".local", "bin", "codexian-codex"),
  "/opt/homebrew/bin/codex",
  "/usr/local/bin/codex",
  "codex",
];

export function codexExecArgs(params: {
  model?: string;
  reasoningEffort?: string;
  permissionMode?: CodexPermissionMode;
  cwd?: string;
  outputLastMessagePath?: string;
} = {}): string[] {
  const args = ["exec", "--color", "never"];

  if (params.outputLastMessagePath?.trim()) {
    args.push("--output-last-message", params.outputLastMessagePath.trim());
  }

  if (params.permissionMode === "auto" || params.permissionMode === "yolo") {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    args.push("--sandbox", "workspace-write");
  }

  args.push("--skip-git-repo-check");

  if (params.cwd?.trim()) {
    args.push("--cd", params.cwd.trim());
  }

  if (params.model?.trim()) {
    args.push("--model", params.model.trim());
  }

  if (params.reasoningEffort?.trim()) {
    args.push("--config", `model_reasoning_effort="${params.reasoningEffort.trim()}"`);
  }

  args.push("-");
  return args;
}

export function resolveCodexCommand(
  command: string | undefined,
  candidates = CODEX_COMMAND_CANDIDATES,
  exists: (path: string) => boolean = existsSync,
): string {
  const requested = expandHome(command?.trim() || "codex");
  if (requested !== "codex") return requested;

  for (const candidate of candidates) {
    if (candidate === "codex") continue;
    if (exists(candidate)) return candidate;
  }

  return requested;
}

export function parseEnvironmentVariables(value: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^export\s+/, "");
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = stripInlineComment(trimmed.slice(equalsIndex + 1).trim());
    if (key) env[key] = stripEnvQuotes(rawValue);
  }
  return env;
}

export function buildCodexEnvironment(
  environmentVariables = "",
  command?: string,
  options: BuildCodexEnvironmentOptions = {},
): NodeJS.ProcessEnv {
  const platform = options.platform ?? process.platform;
  const baseEnv = options.baseEnv ?? process.env;
  const vaultEnv = options.cwd ? readVaultDotEnv(options.cwd, options.readFile ?? readFileSync) : {};
  const parsed = parseEnvironmentVariables(environmentVariables);
  const env: NodeJS.ProcessEnv = {
    CODEX_HOME: join(homedir(), ".codex"),
    ...baseEnv,
    ...vaultEnv,
    ...parsed,
  };

  const targetDelimiter = platform === "win32" ? ";" : delimiter;
  const existingPath = getEnvPath(env);
  const pathEntries = [
    commandDirectory(command ?? "", platform),
    ...desktopPathExtras(command, platform, baseEnv),
    ...existingPath.split(targetDelimiter),
    ...defaultPathEntries(platform),
  ];

  const joinedPath = uniquePath(pathEntries, platform).join(targetDelimiter);
  setEnvPath(env, joinedPath);
  return env;
}

export function createCodexSpawnPlan(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): CodexSpawnPlan {
  if (platform !== "win32") {
    return { command, args, shell: false };
  }

  const extension = win32.extname(unquote(command)).toLowerCase();
  if (extension === ".ps1") {
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", command, ...args],
      shell: false,
    };
  }

  if (extension === ".cmd" || extension === ".bat" || extension === "") {
    return { command, args, shell: true };
  }

  return { command, args, shell: false };
}

export function decodeProcessChunk(chunk: Buffer, platform: NodeJS.Platform = process.platform): string {
  const utf8 = chunk.toString("utf8");
  if (platform !== "win32" || !utf8.includes("\uFFFD")) return utf8;
  try {
    return new TextDecoder("windows-949").decode(chunk);
  } catch {
    return utf8;
  }
}

export async function runCodexExec(params: {
  command: string;
  cwd: string;
  prompt: string;
  model?: string;
  reasoningEffort?: string;
  permissionMode?: CodexPermissionMode;
  environmentVariables?: string;
  koreanDartMcpSource?: KoreanDartMcpSource;
  koreaStockMcpSource?: KoreaStockMcpSource;
  timeoutMs: number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  signal?: AbortSignal;
}): Promise<CodexCliResult> {
  return new Promise((resolve, reject) => {
    if (params.signal?.aborted) {
      reject(new Error("Codex CLI request cancelled."));
      return;
    }

    const command = resolveCodexCommand(params.command);
    const outputLastMessagePath = join(
      tmpdir(),
      `korean-dart-codex-last-message-${Date.now()}-${Math.random().toString(36).slice(2)}.md`,
    );
    const env = buildCodexEnvironment(params.environmentVariables, command, { cwd: params.cwd });
    const args = applyKoreaStockMcpConfig(
      applyKoreanDartMcpConfig(codexExecArgs({
        model: params.model,
        reasoningEffort: params.reasoningEffort,
        permissionMode: params.permissionMode,
        cwd: params.cwd,
        outputLastMessagePath,
      }), params.koreanDartMcpSource),
      params.koreaStockMcpSource,
    );
    const spawnPlan = createCodexSpawnPlan(command, args);
    const child = spawn(spawnPlan.command, spawnPlan.args, {
      cwd: params.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env,
      shell: spawnPlan.shell,
      detached: shouldCreateProcessGroup(),
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      params.signal?.removeEventListener("abort", abort);
      rmSync(outputLastMessagePath, { force: true });
    };
    const abort = () => {
      if (settled) return;
      settled = true;
      void terminateProcessTree(child).finally(() => {
        cleanup();
        reject(new Error("Codex CLI request cancelled."));
      });
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void terminateProcessTree(child).finally(() => {
        cleanup();
        reject(new Error(`Codex CLI timed out after ${Math.round(params.timeoutMs / 1000)} seconds.`));
      });
    }, params.timeoutMs);
    params.signal?.addEventListener("abort", abort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      const text = decodeProcessChunk(chunk);
      stdout += text;
      params.onStdout?.(text);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = decodeProcessChunk(chunk);
      stderr += text;
      params.onStderr?.(text);
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(buildSpawnError(error as NodeJS.ErrnoException, command, env));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      const lastMessage = readOutputLastMessage(outputLastMessagePath);
      cleanup();
      if (code === 0) {
        resolve({ stdout: lastMessage || stdout, stderr });
      } else {
        const output = stderr || stdout;
        const diagnostic = explainCodexFailure(output);
        reject(new Error([
          `Codex CLI exited with code ${code ?? "unknown"}.`,
          diagnostic,
          output,
        ].filter(Boolean).join("\n")));
      }
    });

    child.stdin.write(params.prompt);
    child.stdin.end();
  });
}

function readOutputLastMessage(path: string): string {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith(`~${sep}`)) return join(homedir(), value.slice(2));
  return value;
}

function readVaultDotEnv(
  cwd: string,
  readFile: (path: string, encoding: BufferEncoding) => string,
): Record<string, string> {
  try {
    return parseEnvironmentVariables(readFile(join(cwd, ".env"), "utf8"));
  } catch {
    return {};
  }
}

function defaultPathEntries(platform: NodeJS.Platform): string[] {
  if (platform === "win32") return [];
  return [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];
}

function desktopPathExtras(
  command: string | undefined,
  platform: NodeJS.Platform,
  baseEnv: NodeJS.ProcessEnv,
): string[] {
  const commandDir = commandDirectory(command ?? "", platform);
  if (platform === "win32") {
    const programFiles = getEnvValue(baseEnv, "ProgramFiles");
    const programFilesX86 = getEnvValue(baseEnv, "ProgramFiles(x86)");
    const appData = getEnvValue(baseEnv, "APPDATA");
    const localAppData = getEnvValue(baseEnv, "LOCALAPPDATA");
    const userProfile = getEnvValue(baseEnv, "USERPROFILE");
    return [
      commandDir,
      programFiles ? win32.join(programFiles, "nodejs") : "",
      programFilesX86 ? win32.join(programFilesX86, "nodejs") : "",
      appData ? win32.join(appData, "npm") : "",
      localAppData ? win32.join(localAppData, "Programs", "nodejs") : "",
      userProfile ? win32.join(userProfile, ".volta", "bin") : "",
    ];
  }
  return [
    commandDir,
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
}

function commandDirectory(command: string, platform: NodeJS.Platform): string {
  const expanded = expandHome(unquote(command.trim()));
  if (!expanded || expanded === "codex") return "";
  if (platform === "win32") {
    if (!/[\\/]/.test(expanded)) return "";
    return win32.dirname(expanded);
  }
  if (!expanded.includes("/")) return "";
  return dirname(expanded);
}

function uniquePath(entries: string[], platform: NodeJS.Platform): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const entry of entries) {
    const trimmed = entry.trim();
    const key = platform === "win32" ? trimmed.toLowerCase() : trimmed;
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    output.push(trimmed);
  }
  return output;
}

function getEnvPath(env: NodeJS.ProcessEnv): string {
  const key = Object.keys(env).find((name) => name.toLowerCase() === "path");
  return key ? env[key] ?? "" : "";
}

function setEnvPath(env: NodeJS.ProcessEnv, value: string): void {
  let found = false;
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() !== "path") continue;
    env[key] = value;
    found = true;
  }
  if (!found) env.PATH = value;
  env.PATH = value;
}

function getEnvValue(env: NodeJS.ProcessEnv, key: string): string {
  const actual = Object.keys(env).find((name) => name.toLowerCase() === key.toLowerCase());
  return actual ? env[actual] ?? "" : "";
}

function stripEnvQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function stripInlineComment(value: string): string {
  if (value.startsWith('"') || value.startsWith("'")) return value;
  const match = value.match(/\s+#/);
  return match ? value.slice(0, match.index).trimEnd() : value;
}

function unquote(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

function buildSpawnError(error: NodeJS.ErrnoException, command: string, env: NodeJS.ProcessEnv): Error {
  if (error.code === "ENOENT") {
    return new Error([
      `Codex CLI executable not found: ${command}.`,
      "Codex 설정에서 절대 경로를 지정하거나 Codexian의 Codex CLI path를 확인하세요.",
      `Checked PATH: ${getEnvPath(env) || "(empty)"}`,
    ].join("\n"));
  }
  if (error.code === "EINVAL") {
    return new Error([
      `Codex CLI launch failed with spawn EINVAL: ${command}.`,
      "Windows npm shim(.cmd/.bat/.ps1) 실행 문제가 의심됩니다. 플러그인을 최신 버전으로 업데이트하고 Codex CLI path를 확인하세요.",
    ].join("\n"));
  }
  return error;
}

function explainCodexFailure(text: string): string {
  if (!text) return "";
  if (/"?node"?\s+is not recognized/i.test(text) || /"?node"?은\(는\).*내부 또는 외부 명령/i.test(text)) {
    return "진단: Node.js 경로를 찾지 못했습니다. Windows에서는 Program Files\\nodejs, AppData\\Roaming\\npm, Codex CLI 폴더가 PATH에 자동 보강됩니다. 그래도 실패하면 Node.js 설치와 Codexian Codex CLI path를 확인하세요.";
  }
  if (/\bDART_API_KEY\b|사용자\s*정보\s*검증\s*실패|OC\s*(?:key|키|인증)|API\s*키/i.test(text)) {
    return "진단: OpenDART API 인증키(DART_API_KEY)가 필요합니다. Codex MCP config의 [mcp_servers.korean-dart.env], Korean DART Codex 환경변수, 또는 vault 루트 .env에 DART_API_KEY를 설정하세요.";
  }
  return "";
}
