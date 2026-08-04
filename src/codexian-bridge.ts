import type { App } from "obsidian";
import type { KoreanDartMcpSource } from "./korean-dart-mcp-config";

export type CodexPermissionMode = "review" | "auto" | "yolo";
export type CodexReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

export interface CodexRuntimeConfig {
  source: "codexian" | "custom";
  command: string;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  permissionMode: CodexPermissionMode;
  environmentVariables: string;
  mediaFolder?: string;
  koreanDartMcpSource?: KoreanDartMcpSource;
}

interface CodexForObsidianRuntimeSettings {
  codexCliPath?: string;
  codexModel?: string;
  reasoningEffort?: string;
  permissionMode?: string;
  environmentVariables?: string;
  mediaFolder?: string;
}

interface CodexForObsidianIntegrationApiV1 {
  version: 1;
  getRuntimeSettings: () => CodexForObsidianRuntimeSettings;
  activateView: () => void | Promise<void>;
  pinNote: (path: string) => void | Promise<void>;
  attachCurrentNoteToChat: () => void | Promise<void>;
  refreshOpenViews: () => void;
  openVisualAssetStudio: () => void | Promise<void>;
}

interface CodexForObsidianPluginInstance {
  integrationApi?: unknown;
  settings?: CodexForObsidianRuntimeSettings;
  activateView?: () => void | Promise<void>;
  pinNote?: (path: string) => void | Promise<void>;
  attachCurrentNoteToChat?: () => void | Promise<void>;
  refreshOpenViews?: () => void;
  generateImageFromActiveNote?: () => void | Promise<void>;
}

export interface CodexForObsidianPluginApi {
  settings?: CodexForObsidianRuntimeSettings;
  activateView?: () => void | Promise<void>;
  pinNote?: (path: string) => void | Promise<void>;
  attachCurrentNoteToChat?: () => void | Promise<void>;
  refreshOpenViews?: () => void;
  generateImageFromActiveNote?: () => void | Promise<void>;
}

type ObsidianAppWithPlugins = App & {
  plugins?: {
    plugins?: Record<string, unknown>;
  };
  commands?: {
    findCommand?: (id: string) => unknown;
    executeCommandById?: (id: string) => unknown;
  };
};

const VISUAL_COMMAND_ID = "codexian:generate-visual-from-note";

export function getCodexForObsidianPlugin(app: App): CodexForObsidianPluginApi | null {
  const obsidianApp = app as ObsidianAppWithPlugins;
  const plugin = obsidianApp.plugins?.plugins?.codexian;
  if (!plugin || typeof plugin !== "object") return null;
  const instance = plugin as CodexForObsidianPluginInstance;
  const integrationApi = parseIntegrationApi(instance.integrationApi);

  if (integrationApi) {
    return {
      settings: integrationApi.getRuntimeSettings(),
      activateView: () => integrationApi.activateView(),
      pinNote: (path) => integrationApi.pinNote(path),
      attachCurrentNoteToChat: () => integrationApi.attachCurrentNoteToChat(),
      refreshOpenViews: () => integrationApi.refreshOpenViews(),
      generateImageFromActiveNote: () => integrationApi.openVisualAssetStudio(),
    };
  }

  const commandFallback = buildVisualCommandFallback(obsidianApp);
  if (instance.settings || instance.activateView || instance.generateImageFromActiveNote || commandFallback) {
    return {
      settings: instance.settings,
      activateView: instance.activateView?.bind(instance),
      pinNote: instance.pinNote?.bind(instance),
      attachCurrentNoteToChat: instance.attachCurrentNoteToChat?.bind(instance),
      refreshOpenViews: instance.refreshOpenViews?.bind(instance),
      generateImageFromActiveNote: instance.generateImageFromActiveNote?.bind(instance) ?? commandFallback,
    };
  }
  return null;
}

export function getCodexForObsidianRuntime(app: App): CodexRuntimeConfig | null {
  const settings = getCodexForObsidianPlugin(app)?.settings;
  if (!settings) return null;

  const command = settings.codexCliPath?.trim();
  const model = settings.codexModel?.trim();
  const mediaFolder = settings.mediaFolder?.trim();

  return {
    source: "codexian",
    command: command || "codex",
    model: model || undefined,
    reasoningEffort: normalizeReasoningEffort(settings.reasoningEffort),
    permissionMode: normalizePermissionMode(settings.permissionMode),
    environmentVariables: settings.environmentVariables ?? "",
    mediaFolder: mediaFolder || undefined,
  };
}

/** @deprecated Use getCodexForObsidianPlugin. Kept for persisted integrations. */
export const getCodexianPlugin = getCodexForObsidianPlugin;

/** @deprecated Use getCodexForObsidianRuntime. Kept for persisted integrations. */
export const getCodexianRuntime = getCodexForObsidianRuntime;

function parseIntegrationApi(value: unknown): CodexForObsidianIntegrationApiV1 | null {
  if (!value || typeof value !== "object") return null;
  const api = value as Partial<CodexForObsidianIntegrationApiV1>;
  if (
    api.version !== 1
    || typeof api.getRuntimeSettings !== "function"
    || typeof api.activateView !== "function"
    || typeof api.pinNote !== "function"
    || typeof api.attachCurrentNoteToChat !== "function"
    || typeof api.refreshOpenViews !== "function"
    || typeof api.openVisualAssetStudio !== "function"
  ) return null;
  return api as CodexForObsidianIntegrationApiV1;
}

function buildVisualCommandFallback(
  app: ObsidianAppWithPlugins,
): (() => Promise<void>) | undefined {
  const commands = app.commands;
  if (!commands?.executeCommandById) return undefined;
  if (commands.findCommand && !commands.findCommand(VISUAL_COMMAND_ID)) return undefined;
  return async () => {
    const result = commands.executeCommandById?.(VISUAL_COMMAND_ID);
    if (result === false) {
      throw new Error("Codex for Obsidian 시각자료 명령을 실행하지 못했습니다.");
    }
  };
}

export function normalizeReasoningEffort(value: string | undefined): CodexReasoningEffort | undefined {
  if (
    value === "low"
    || value === "medium"
    || value === "high"
    || value === "xhigh"
    || value === "max"
    || value === "ultra"
  ) return value;
  return undefined;
}

export function normalizePermissionMode(value: string | undefined): CodexPermissionMode {
  if (value === "auto" || value === "yolo") return value;
  return "review";
}

export function mcpCapablePermissionMode(value: CodexPermissionMode): CodexPermissionMode {
  return value === "review" ? "auto" : value;
}
