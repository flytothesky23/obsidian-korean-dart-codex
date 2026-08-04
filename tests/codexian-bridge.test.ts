import { describe, expect, it } from "vitest";
import {
  getCodexForObsidianPlugin,
  getCodexForObsidianRuntime,
  mcpCapablePermissionMode,
  normalizePermissionMode,
  normalizeReasoningEffort,
} from "../src/codexian-bridge";

describe("Codex for Obsidian bridge", () => {
  it("detects the legacy direct plugin API", () => {
    const generateImageFromActiveNote = () => undefined;
    const plugin = {
      settings: { codexCliPath: "/opt/homebrew/bin/codex" },
      generateImageFromActiveNote,
    };
    const app = fakeApp(plugin);

    expect(getCodexForObsidianPlugin(app)?.settings).toEqual(plugin.settings);
    expect(getCodexForObsidianPlugin(app)?.generateImageFromActiveNote).toBeTypeOf("function");
  });

  it("uses the versioned integration API exposed by Codex for Obsidian", async () => {
    const calls: string[] = [];
    const app = fakeApp({
      integrationApi: {
        version: 1,
        getRuntimeSettings: () => ({
          codexCliPath: "/opt/homebrew/bin/codex",
          codexModel: "gpt-5.6-sol",
          reasoningEffort: "max",
          permissionMode: "auto",
          environmentVariables: "CODEX_HOME=/tmp/codex-home",
          mediaFolder: "attachments/codex-for-obsidian",
        }),
        activateView: async () => { calls.push("activate"); },
        pinNote: async (path: string) => { calls.push(`pin:${path}`); },
        attachCurrentNoteToChat: async () => { calls.push("attach"); },
        refreshOpenViews: () => { calls.push("refresh"); },
        openVisualAssetStudio: async () => { calls.push("visual"); },
      },
    });

    const plugin = getCodexForObsidianPlugin(app);
    await plugin?.pinNote?.("Dart/research.md");
    await plugin?.generateImageFromActiveNote?.();

    expect(calls).toEqual(["pin:Dart/research.md", "visual"]);
    expect(getCodexForObsidianRuntime(app)).toMatchObject({
      source: "codexian",
      command: "/opt/homebrew/bin/codex",
      model: "gpt-5.6-sol",
      reasoningEffort: "max",
      mediaFolder: "attachments/codex-for-obsidian",
    });
  });

  it("falls back to the registered visual command for pre-integration releases", async () => {
    const calls: string[] = [];
    const app = fakeApp({}, {
      findCommand: (id: string) => id === "codexian:generate-visual-from-note" ? { id } : undefined,
      executeCommandById: (id: string) => {
        calls.push(id);
        return true;
      },
    });

    await getCodexForObsidianPlugin(app)?.generateImageFromActiveNote?.();

    expect(calls).toEqual(["codexian:generate-visual-from-note"]);
  });

  it("returns null when Codex for Obsidian is not loaded", () => {
    expect(getCodexForObsidianPlugin(fakeApp(undefined))).toBeNull();
    expect(getCodexForObsidianRuntime(fakeApp(undefined))).toBeNull();
  });

  it("reads runtime settings without mutating them", () => {
    const runtime = getCodexForObsidianRuntime(fakeApp({
      settings: {
        codexCliPath: "/home/example/.local/bin/codexian-codex",
        codexModel: "gpt-5.5",
        reasoningEffort: "high",
        permissionMode: "auto",
        environmentVariables: "DART_API_KEY=test-oc-key",
        mediaFolder: "Assets/Codexian",
      },
    }));

    expect(runtime).toEqual({
      source: "codexian",
      command: "/home/example/.local/bin/codexian-codex",
      model: "gpt-5.5",
      reasoningEffort: "high",
      permissionMode: "auto",
      environmentVariables: "DART_API_KEY=test-oc-key",
      mediaFolder: "Assets/Codexian",
    });
  });

  it("falls back for invalid runtime values", () => {
    const runtime = getCodexForObsidianRuntime(fakeApp({
      settings: {
        codexCliPath: "",
        codexModel: "",
        reasoningEffort: "invalid",
        permissionMode: "unknown",
      },
    }));

    expect(runtime?.command).toBe("codex");
    expect(runtime?.model).toBeUndefined();
    expect(runtime?.reasoningEffort).toBeUndefined();
    expect(runtime?.permissionMode).toBe("review");
  });
});

describe("Codex runtime setting normalizers", () => {
  it("normalizes reasoning effort", () => {
    expect(normalizeReasoningEffort("low")).toBe("low");
    expect(normalizeReasoningEffort("medium")).toBe("medium");
    expect(normalizeReasoningEffort("high")).toBe("high");
    expect(normalizeReasoningEffort("xhigh")).toBe("xhigh");
    expect(normalizeReasoningEffort("max")).toBe("max");
    expect(normalizeReasoningEffort("ultra")).toBe("ultra");
    expect(normalizeReasoningEffort("invalid")).toBeUndefined();
  });

  it("normalizes permission mode", () => {
    expect(normalizePermissionMode("auto")).toBe("auto");
    expect(normalizePermissionMode("yolo")).toBe("yolo");
    expect(normalizePermissionMode("review")).toBe("review");
    expect(normalizePermissionMode("invalid")).toBe("review");
  });

  it("upgrades review mode for non-interactive MCP calls", () => {
    expect(mcpCapablePermissionMode("review")).toBe("auto");
    expect(mcpCapablePermissionMode("auto")).toBe("auto");
    expect(mcpCapablePermissionMode("yolo")).toBe("yolo");
  });
});

function fakeApp(plugin: unknown, commands?: unknown): never {
  return {
    plugins: {
      plugins: plugin === undefined ? {} : { codexian: plugin },
    },
    commands,
  } as never;
}
