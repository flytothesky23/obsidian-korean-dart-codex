import {
  normalizeReasoningEffort,
  type CodexReasoningEffort,
  type CodexRuntimeConfig,
} from "./codexian-bridge";

type JsonObject = Record<string, unknown>;

export interface CodexModelCatalogItem {
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  defaultReasoningEffort: CodexReasoningEffort;
  supportedReasoningEfforts: CodexReasoningEffort[];
}

export interface CodexModelCatalogPage {
  models: CodexModelCatalogItem[];
  nextCursor: string | null;
}

export const FALLBACK_CODEX_MODELS: CodexModelCatalogItem[] = [
  createFallbackModel("gpt-5.6-sol", "GPT-5.6-Sol", "low", ["low", "medium", "high", "xhigh", "max", "ultra"], true),
  createFallbackModel("gpt-5.6-terra", "GPT-5.6-Terra", "medium", ["low", "medium", "high", "xhigh", "max", "ultra"]),
  createFallbackModel("gpt-5.6-luna", "GPT-5.6-Luna", "medium", ["low", "medium", "high", "xhigh", "max"]),
  createFallbackModel("gpt-5.5", "GPT-5.5", "medium", ["low", "medium", "high", "xhigh"]),
  createFallbackModel("gpt-5.4", "GPT-5.4", "medium", ["low", "medium", "high", "xhigh"]),
  createFallbackModel("gpt-5.4-mini", "GPT-5.4-Mini", "medium", ["low", "medium", "high", "xhigh"]),
  createFallbackModel("gpt-5.3-codex-spark", "GPT-5.3-Codex-Spark", "high", ["low", "medium", "high", "xhigh"]),
];

export async function discoverCodexModels(input: {
  runtime: CodexRuntimeConfig;
  cwd: string;
  timeoutMs: number;
}): Promise<CodexModelCatalogItem[]> {
  const [
    { spawn },
    { AppServerTransport },
    {
      buildCodexEnvironment,
      createCodexSpawnPlan,
      decodeProcessChunk,
      resolveCodexCommand,
    },
  ] = await Promise.all([
    import("child_process"),
    import("./appserver-transport"),
    import("./codex-cli"),
  ]);
  const command = resolveCodexCommand(input.runtime.command);
  const env = buildCodexEnvironment(input.runtime.environmentVariables, command, { cwd: input.cwd });
  const spawnPlan = createCodexSpawnPlan(command, ["app-server", "--listen", "stdio://"]);
  const child = spawn(spawnPlan.command, spawnPlan.args, {
    cwd: input.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env,
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
    await transport.request("initialize", {
      clientInfo: { name: "korean-dart-codex-model-catalog", version: "0.2.0" },
      capabilities: { experimentalApi: true },
    }, input.timeoutMs);
    transport.notify("initialized");

    const models = new Map<string, CodexModelCatalogItem>();
    let cursor: string | null = null;
    do {
      const response = await transport.request("model/list", {
        cursor,
        limit: 100,
        includeHidden: false,
      }, input.timeoutMs);
      const page = parseCodexModelCatalogPage(response);
      for (const model of page.models) models.set(model.model, model);
      cursor = page.nextCursor;
    } while (cursor);

    if (models.size === 0) throw new Error("Codex app-server returned an empty model catalog.");
    return [...models.values()].sort((left, right) => Number(right.isDefault) - Number(left.isDefault));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const detail = stderr.trim();
    throw new Error([message, detail].filter(Boolean).join("\n"));
  } finally {
    transport.dispose();
    child.kill();
  }
}

export function parseCodexModelCatalogPage(value: unknown): CodexModelCatalogPage {
  const root = asObject(value);
  const data = Array.isArray(root.data) ? root.data : [];
  const models = data.flatMap((entry) => {
    const item = asObject(entry);
    if (item.hidden === true) return [];
    const model = readString(item.model) || readString(item.id);
    if (!model) return [];
    const supportedReasoningEfforts = parseReasoningEfforts(item.supportedReasoningEfforts);
    const defaultReasoningEffort = normalizeReasoningEffort(readString(item.defaultReasoningEffort))
      ?? supportedReasoningEfforts[0]
      ?? "medium";
    return [{
      model,
      displayName: readString(item.displayName) || model,
      description: readString(item.description),
      isDefault: item.isDefault === true,
      defaultReasoningEffort,
      supportedReasoningEfforts: supportedReasoningEfforts.length > 0
        ? supportedReasoningEfforts
        : ["low", "medium", "high", "xhigh"],
    } satisfies CodexModelCatalogItem];
  });
  return {
    models,
    nextCursor: readString(root.nextCursor) || null,
  };
}

export function modelCatalogToOptions(models: CodexModelCatalogItem[]): Record<string, string> {
  return Object.fromEntries(models.map((model) => [
    model.model,
    `${model.displayName}${model.isDefault ? " · Codex default" : ""}`,
  ]));
}

function createFallbackModel(
  model: string,
  displayName: string,
  defaultReasoningEffort: CodexReasoningEffort,
  supportedReasoningEfforts: CodexReasoningEffort[],
  isDefault = false,
): CodexModelCatalogItem {
  return {
    model,
    displayName,
    description: "",
    isDefault,
    defaultReasoningEffort,
    supportedReasoningEfforts,
  };
}

function parseReasoningEfforts(value: unknown): CodexReasoningEffort[] {
  if (!Array.isArray(value)) return [];
  const efforts: CodexReasoningEffort[] = [];
  for (const entry of value) {
    const effort = normalizeReasoningEffort(readString(asObject(entry).reasoningEffort) || readString(entry));
    if (effort && !efforts.includes(effort)) efforts.push(effort);
  }
  return efforts;
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
