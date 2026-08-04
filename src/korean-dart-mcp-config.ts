export type KoreanDartMcpSource = "managed" | "codex-config";

export const KOREAN_DART_MCP_PACKAGE = "korean-dart-mcp@0.10.1";

export interface KoreanDartMcpLaunchConfig {
  command: string;
  args: string[];
  cwd: string | null;
  env: Record<string, string>;
}

export function managedKoreanDartMcpConfig(): KoreanDartMcpLaunchConfig {
  return {
    command: "npx",
    args: ["-y", KOREAN_DART_MCP_PACKAGE],
    cwd: null,
    env: {},
  };
}

export function applyKoreanDartMcpConfig(
  args: string[],
  source: KoreanDartMcpSource = "managed",
): string[] {
  if (source !== "managed") return [...args];

  const overrides = [
    "--config",
    'mcp_servers.korean-dart.command="npx"',
    "--config",
    `mcp_servers.korean-dart.args=["-y","${KOREAN_DART_MCP_PACKAGE}"]`,
    "--config",
    'mcp_servers.korean-dart.env_vars=["DART_API_KEY"]',
  ];

  // The shared codexian wrapper detects exec only when it remains argv[0].
  if (args[0] === "exec") return ["exec", ...overrides, ...args.slice(1)];
  return [...overrides, ...args];
}

export function mergeDartApiKey(environmentVariables: string, dartApiKey: string): string {
  const key = dartApiKey.trim();
  if (!key) return environmentVariables;

  const retained = environmentVariables
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:export\s+)?DART_API_KEY\s*=/i.test(line));
  retained.push(`DART_API_KEY=${key}`);
  return retained.filter((line, index) => line.trim() || index < retained.length - 1).join("\n");
}

export function extractDartApiKey(environmentVariables: string): {
  dartApiKey: string;
  environmentVariables: string;
} {
  let dartApiKey = "";
  const retained = environmentVariables.split(/\r?\n/).filter((line) => {
    const match = line.match(/^\s*(?:export\s+)?DART_API_KEY\s*=\s*(.*)$/i);
    if (!match) return true;
    if (!dartApiKey) dartApiKey = stripOptionalQuotes(match[1].trim());
    return false;
  });
  return {
    dartApiKey,
    environmentVariables: retained.join("\n").replace(/^\n+|\n+$/g, ""),
  };
}

export function prepareDartRuntimeForPersistence(
  environmentVariables: string,
  storedDartApiKey: string,
): {
  environmentVariables: string;
  dartApiKeyToStore: string;
} {
  const extracted = extractDartApiKey(environmentVariables);
  return {
    environmentVariables: extracted.environmentVariables,
    dartApiKeyToStore: storedDartApiKey.trim() ? "" : extracted.dartApiKey,
  };
}

export function hasDartApiKey(env: NodeJS.ProcessEnv): boolean {
  const entry = Object.entries(env).find(([name]) => name.toLowerCase() === "dart_api_key");
  return Boolean(entry?.[1]?.trim());
}

function stripOptionalQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) return value.slice(1, -1);
  return value;
}
