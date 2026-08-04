import { App, PluginSettingTab, Setting } from "obsidian";
import { getCodexForObsidianRuntime } from "./codexian-bridge";
import type KoreanDartCodexPlugin from "./plugin";
import type { CodexPermissionMode, CodexReasoningEffort } from "./codexian-bridge";
import type { DartRuntimeMode } from "./codex-provider";
import { FALLBACK_CODEX_MODELS, modelCatalogToOptions } from "./codex-model-catalog";

export interface KoreanDartCodexSettings {
  outputFolder: string;
  autoOpenPanel: boolean;
  runtimeMode: DartRuntimeMode;
  appServerFallback: boolean;
  showRuntimeDiagnostics: boolean;
  persistSession: boolean;
  codexAppServerTimeoutSeconds: number;
  codexSettingsSource: "codexian" | "custom";
  codexCommand: string;
  codexModel: string;
  reasoningEffort: CodexReasoningEffort;
  permissionMode: CodexPermissionMode;
  environmentVariables: string;
  timeoutSeconds: number;
}

export const DEFAULT_SETTINGS: KoreanDartCodexSettings = {
  outputFolder: "00_수집함/DART Research",
  autoOpenPanel: false,
  runtimeMode: "app-server",
  appServerFallback: true,
  showRuntimeDiagnostics: true,
  persistSession: true,
  codexAppServerTimeoutSeconds: 30,
  codexSettingsSource: "codexian",
  codexCommand: "codex",
  codexModel: "gpt-5.5",
  reasoningEffort: "medium",
  permissionMode: "auto",
  environmentVariables: "",
  timeoutSeconds: 600,
};

export const CODEX_MODEL_OPTIONS: Record<string, string> = modelCatalogToOptions(FALLBACK_CODEX_MODELS);

export class KoreanDartCodexSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: KoreanDartCodexPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("korean-dart-codex-settings");

    containerEl.createEl("h2", { text: "Korean DART Codex" });

    const runtime = getCodexForObsidianRuntime(this.app);
    containerEl.createDiv({
      cls: "korean-dart-codex-settings-status",
      text: runtime
        ? `Codex for Obsidian runtime detected: ${runtime.command} · ${runtime.model ?? "configured model"} · ${runtime.reasoningEffort ?? "configured reasoning"}`
        : "Codex for Obsidian runtime not detected. Custom Codex settings below will be used.",
    });

    new Setting(containerEl)
      .setName("Research note folder")
      .setDesc("Saved Korean DART research notes are created here.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.outputFolder)
          .setValue(this.plugin.settings.outputFolder)
          .onChange(async (value) => {
            this.plugin.settings.outputFolder = value.trim() || DEFAULT_SETTINGS.outputFolder;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Open panel on startup")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoOpenPanel).onChange(async (value) => {
          this.plugin.settings.autoOpenPanel = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Codex settings source")
      .setDesc("Reuse Codex for Obsidian when available so OAuth, model, PATH, CODEX_HOME, and image settings remain shared.")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            codexian: "Codex for Obsidian runtime",
            custom: "Custom fallback",
          })
          .setValue(this.plugin.settings.codexSettingsSource)
          .onChange(async (value) => {
            this.plugin.settings.codexSettingsSource = value === "custom" ? "custom" : "codexian";
            this.plugin.invalidateModelCatalog();
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    new Setting(containerEl)
      .setName("Runtime mode")
      .setDesc("Use app-server for panel-style streaming UX. Exec remains available as a fallback.")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            "app-server": "App-server first",
            exec: "Exec only",
          })
          .setValue(this.plugin.settings.runtimeMode)
          .onChange(async (value) => {
            this.plugin.settings.runtimeMode = value === "exec" ? "exec" : "app-server";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Fallback to codex exec")
      .setDesc("If app-server is unavailable or initialization fails, run the existing codex exec path.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.appServerFallback).onChange(async (value) => {
          this.plugin.settings.appServerFallback = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Persist app-server session")
      .setDesc("Keep the app-server thread across panel turns until the header 새 대화 button resets it.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.persistSession).onChange(async (value) => {
          this.plugin.settings.persistSession = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Show runtime diagnostics")
      .setDesc("Keep detailed progress/error lines available from the panel log copy button.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showRuntimeDiagnostics).onChange(async (value) => {
          this.plugin.settings.showRuntimeDiagnostics = value;
          await this.plugin.saveSettings();
        }),
      );

    if (this.plugin.settings.codexSettingsSource === "custom" || !runtime) {
      new Setting(containerEl)
        .setName("Codex CLI path")
        .setDesc("Leave as codex for PATH lookup, or use an absolute path. Windows npm shims such as codex.cmd are supported.")
        .addText((text) =>
          text
            .setPlaceholder("codex")
            .setValue(this.plugin.settings.codexCommand)
            .onChange(async (value) => {
              this.plugin.settings.codexCommand = value.trim() || DEFAULT_SETTINGS.codexCommand;
              this.plugin.invalidateModelCatalog();
              await this.plugin.saveSettings();
            }),
        );

      new Setting(containerEl)
        .setName("Model")
        .addDropdown((dropdown) =>
          dropdown
            .addOptions(this.plugin.getModelDropdownOptions())
            .setValue(this.plugin.settings.codexModel)
            .onChange(async (value) => {
              this.plugin.settings.codexModel = value || DEFAULT_SETTINGS.codexModel;
              await this.plugin.saveSettings();
            }),
        );

      new Setting(containerEl)
        .setName("Reasoning effort")
        .addDropdown((dropdown) =>
          dropdown
            .addOptions({
              low: "Low",
              medium: "Medium",
              high: "High",
              xhigh: "Extra high",
              max: "Max",
              ultra: "Ultra",
            })
            .setValue(this.plugin.settings.reasoningEffort)
            .onChange(async (value) => {
              this.plugin.settings.reasoningEffort = value as CodexReasoningEffort;
              await this.plugin.saveSettings();
            }),
        );

      new Setting(containerEl)
        .setName("Permission mode")
        .setDesc("Review uses workspace-write. Auto and yolo bypass approvals so non-interactive Codex exec can call MCP tools.")
        .addDropdown((dropdown) =>
          dropdown
            .addOptions({
              review: "Review",
              auto: "Auto",
              yolo: "Yolo",
            })
            .setValue(this.plugin.settings.permissionMode)
            .onChange(async (value) => {
              this.plugin.settings.permissionMode = value as CodexPermissionMode;
              await this.plugin.saveSettings();
            }),
        );

      new Setting(containerEl)
        .setName("Environment variables")
        .setDesc("One KEY=VALUE per line. Vault .env is also loaded before Codex starts; explicit values here override .env. Use DART_API_KEY here if Codex MCP config does not already define it.")
        .addTextArea((text) => {
          text
            .setPlaceholder("DART_API_KEY=your-opendart-api-key\nCODEX_HOME=~/.codex")
            .setValue(this.plugin.settings.environmentVariables)
            .onChange(async (value) => {
              this.plugin.settings.environmentVariables = value;
              this.plugin.invalidateModelCatalog();
              await this.plugin.saveSettings();
            });
          text.inputEl.rows = 6;
          text.inputEl.style.width = "100%";
        });
    }

    new Setting(containerEl)
      .setName("Codex timeout")
      .setDesc("Maximum seconds to wait for one DART disclosure research request.")
      .addSlider((slider) =>
        slider
          .setLimits(120, 1200, 60)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.timeoutSeconds)
          .onChange(async (value) => {
            this.plugin.settings.timeoutSeconds = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("App-server handshake timeout")
      .setDesc("Maximum seconds for initialize/thread/start app-server protocol calls before falling back.")
      .addSlider((slider) =>
        slider
          .setLimits(10, 120, 5)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.codexAppServerTimeoutSeconds)
          .onChange(async (value) => {
            this.plugin.settings.codexAppServerTimeoutSeconds = value;
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createDiv({
      cls: "korean-dart-codex-settings-hint",
      text: "Required MCP: korean-dart. The plugin automatically adds common Windows Node/npm and macOS Homebrew paths before launching Codex. Check `codex mcp list` if queries fail.",
    });
  }
}
