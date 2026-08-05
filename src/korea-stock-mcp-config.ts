import { managedMcpLauncherConfig, managedMcpWorkingDirectory } from "./managed-mcp-launcher";

export type KoreaStockMcpSource = "managed" | "codex-config";

export const KOREA_STOCK_MCP_PACKAGE = "korea-stock-mcp@1.4.1";
export const KOREA_STOCK_MCP_SERVER_NAME = "korea-stock";
export const KRX_API_KEY_ENV_NAME = "KRX_API_KEY";
export const KOREA_STOCK_ENABLED_TOOLS = [
  "get_stock_base_info",
  "get_stock_trade_info",
] as const;

export interface KoreaStockMcpLaunchConfig {
  command: string;
  args: string[];
  cwd: string | null;
  env: Record<string, string>;
}

export function koreaStockMcpWorkingDirectory(): string {
  return managedMcpWorkingDirectory("korea-stock-mcp");
}

export function managedKoreaStockMcpConfig(): KoreaStockMcpLaunchConfig {
  const launcher = managedMcpLauncherConfig(KOREA_STOCK_MCP_PACKAGE, "korea-stock-mcp");
  return {
    ...launcher,
    env: {},
  };
}

export function applyKoreaStockMcpConfig(
  args: string[],
  source: KoreaStockMcpSource = "managed",
): string[] {
  if (source !== "managed") return [...args];

  const launcher = managedMcpLauncherConfig(KOREA_STOCK_MCP_PACKAGE, "korea-stock-mcp");

  const overrides = [
    "--config",
    `mcp_servers.${KOREA_STOCK_MCP_SERVER_NAME}.command=${JSON.stringify(launcher.command)}`,
    "--config",
    `mcp_servers.${KOREA_STOCK_MCP_SERVER_NAME}.args=${JSON.stringify(launcher.args)}`,
    "--config",
    `mcp_servers.${KOREA_STOCK_MCP_SERVER_NAME}.env_vars=["${KRX_API_KEY_ENV_NAME}"]`,
    "--config",
    `mcp_servers.${KOREA_STOCK_MCP_SERVER_NAME}.enabled_tools=[${KOREA_STOCK_ENABLED_TOOLS.map((name) => `"${name}"`).join(",")}]`,
    "--config",
    `mcp_servers.${KOREA_STOCK_MCP_SERVER_NAME}.cwd=${JSON.stringify(launcher.cwd)}`,
  ];

  // The shared codexian wrapper detects exec only when it remains argv[0].
  if (args[0] === "exec") return ["exec", ...overrides, ...args.slice(1)];
  return [...overrides, ...args];
}

export function mergeKrxApiKey(environmentVariables: string, krxApiKey: string): string {
  return mergeApiKey(environmentVariables, KRX_API_KEY_ENV_NAME, krxApiKey);
}

export function extractKrxApiKey(environmentVariables: string): {
  krxApiKey: string;
  environmentVariables: string;
} {
  const extracted = extractApiKey(environmentVariables, KRX_API_KEY_ENV_NAME);
  return {
    krxApiKey: extracted.apiKey,
    environmentVariables: extracted.environmentVariables,
  };
}

export function prepareKrxRuntimeForPersistence(
  environmentVariables: string,
  storedKrxApiKey: string,
): {
  environmentVariables: string;
  krxApiKeyToStore: string;
} {
  const extracted = extractKrxApiKey(environmentVariables);
  return {
    environmentVariables: extracted.environmentVariables,
    krxApiKeyToStore: storedKrxApiKey.trim() ? "" : extracted.krxApiKey,
  };
}

export function hasKrxApiKey(env: NodeJS.ProcessEnv): boolean {
  return hasApiKey(env, KRX_API_KEY_ENV_NAME);
}

function mergeApiKey(environmentVariables: string, envName: string, apiKey: string): string {
  const key = apiKey.trim();
  if (!key) return environmentVariables;

  const keyPattern = apiKeyLinePattern(envName);
  const retained = environmentVariables
    .split(/\r?\n/)
    .filter((line) => !keyPattern.test(line));
  retained.push(`${envName}=${key}`);
  return retained.filter((line, index) => line.trim() || index < retained.length - 1).join("\n");
}

function extractApiKey(environmentVariables: string, envName: string): {
  apiKey: string;
  environmentVariables: string;
} {
  let apiKey = "";
  const keyPattern = apiKeyLinePattern(envName);
  const retained = environmentVariables.split(/\r?\n/).filter((line) => {
    const match = line.match(keyPattern);
    if (!match) return true;
    if (!apiKey) apiKey = stripOptionalQuotes(match[1].trim());
    return false;
  });
  return {
    apiKey,
    environmentVariables: retained.join("\n").replace(/^\n+|\n+$/g, ""),
  };
}

function hasApiKey(env: NodeJS.ProcessEnv, envName: string): boolean {
  const normalized = envName.toLowerCase();
  const entry = Object.entries(env).find(([name]) => name.toLowerCase() === normalized);
  return Boolean(entry?.[1]?.trim());
}

function apiKeyLinePattern(envName: string): RegExp {
  return new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(envName)}\\s*=\\s*(.*)$`, "i");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripOptionalQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) return value.slice(1, -1);
  return value;
}
