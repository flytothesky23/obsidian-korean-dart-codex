import {
  type CachedMetadata,
  FileSystemAdapter,
  ItemView,
  Menu,
  MarkdownRenderer,
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  WorkspaceLeaf,
  normalizePath,
  setIcon,
} from "obsidian";
import type {
  CodexAppServerVisualProvider,
  NativeVisualEvent,
} from "./codex-appserver-visual";
import { KoreanDartCodexProvider, type DartAgentEvent } from "./codex-provider";
import {
  getCodexForObsidianPlugin,
  getCodexForObsidianRuntime,
  mcpCapablePermissionMode,
  type CodexRuntimeConfig,
  type CodexReasoningEffort,
} from "./codexian-bridge";
import {
  buildDataviewJsBlock,
  buildImagePromptPrompt,
  buildDartResearchPrompt,
  buildMermaidPrompt,
  type DartVisualMode,
  type DartVisualScope,
  type PanelMessage,
} from "./prompts";
import {
  buildResearchNote,
  buildResearchNotePath,
  normalizeVaultPath,
  uniqueVaultPath,
} from "./note-builder";
import {
  buildNativeVisualPlanPrompt,
  buildNativeVisualSlidePrompt,
  buildVisualAssetFolder,
  buildVisualAssetPath,
  buildVisualCollectionNote,
  buildVisualCollectionNotePath,
  parseDartVisualCollectionPlan,
  readVerifiedPng,
  type DartVisualCollectionPlan,
  type SavedVisualAsset,
} from "./visual-assets";
import {
  DEFAULT_SETTINGS,
  KoreanDartCodexSettingTab,
  type KoreanDartCodexSettings,
} from "./settings";
import {
  discoverCodexModels,
  FALLBACK_CODEX_MODELS,
  modelCatalogToOptions,
  type CodexModelCatalogItem,
} from "./codex-model-catalog";
import { KOREAN_DART_SCALE_SVG, setIconifyIcon, type IconifyName } from "./iconify";
import {
  formatCodexActivity,
  shouldUpdateStatusFromCodexStderr,
  summarizeCodexStderr,
  summarizeFailureMessage,
} from "./status-format";
import {
  type ContextPickerOptions,
  type KoreanDartContextApiV2,
} from "./context-api";
import { ContextPickerModal } from "./context-picker";
import {
  type ContextScope,
  type ContextSnapshot,
  DartContextService,
  type SelectedContextNote,
} from "./dart-context";
import {
  createVaultIndexRecord,
  type VaultSearchOptions,
  VaultIndexService,
} from "./vault-index";
import {
  renderContextButton,
  renderContextChipRow,
  renderNoContextChip,
} from "./context-ui";
import { NoteContextPolicy } from "./note-context-policy";
import {
  describeAssistantCopy,
  renderAssistantCopyButton,
} from "./message-copy";
import { StableStreamingMessage } from "./streaming-message";
import {
  discoverKoreanDartMcpStatus,
  INITIAL_KOREAN_DART_MCP_STATUS,
  summarizeMcpStatusError,
  type KoreanDartMcpStatus,
} from "./codex-mcp-status";
import {
  mcpStatusTooltip,
  mcpWelcomeLabel,
  renderMcpStatusButton,
} from "./mcp-status-ui";

const VIEW_TYPE = "korean-dart-codex-panel";

const REASONING_OPTIONS: Array<[CodexReasoningEffort, string]> = [
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["xhigh", "Extra high"],
  ["max", "Max"],
  ["ultra", "Ultra"],
];

type PanelPhase = "idle" | "preparing" | "searching" | "analyzing" | "saving" | "complete" | "failed";

interface ActiveNoteContext {
  path?: string;
  content?: string;
  selection?: string;
}

export default class KoreanDartCodexPlugin extends Plugin {
  settings: KoreanDartCodexSettings = DEFAULT_SETTINGS;
  contextApi!: KoreanDartContextApiV2;
  private readonly dartProvider = new KoreanDartCodexProvider();
  private visualProvider: CodexAppServerVisualProvider | null = null;
  private readonly vaultIndex = new VaultIndexService();
  private contextService: DartContextService | null = null;
  private readonly contextIndexFailures = new Set<string>();
  private backlinkRefreshTimer: number | null = null;
  private contextIndexEventsRegistered = false;
  private vaultIndexInitialized = false;
  private vaultIndexPromise: Promise<void> | null = null;
  private modelCatalog: CodexModelCatalogItem[] = [...FALLBACK_CODEX_MODELS];
  private modelCatalogPromise: Promise<CodexModelCatalogItem[]> | null = null;
  private modelCatalogFetchedAt = 0;
  private koreanDartMcpStatus: KoreanDartMcpStatus = { ...INITIAL_KOREAN_DART_MCP_STATUS };
  private koreanDartMcpStatusPromise: Promise<KoreanDartMcpStatus> | null = null;
  private koreanDartMcpStatusFetchedAt = 0;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.contextApi = Object.freeze({
      version: 2 as const,
      search: async (query: string, options?: VaultSearchOptions) => {
        this.ensureContextIndexEvents();
        await this.ensureVaultIndexInitialized();
        return this.vaultIndex.search(query, options).map((result) => ({
          ...result,
          matches: [...result.matches],
          record: {
            ...result.record,
            aliases: [...result.record.aliases],
            tags: [...result.record.tags],
            headings: [...result.record.headings],
            links: [...result.record.links],
            backlinks: [...result.record.backlinks],
          },
        }));
      },
      resolve: async (paths: string[], scope: ContextScope = "turn") => {
        const context = this.ensureContextIndexEvents();
        return context.resolve(paths, scope);
      },
      openPicker: async (options?: ContextPickerOptions) => this.openContextPicker(options),
      getSessionContext: () => this.contextService?.getSessionContext() ?? null,
      clearSessionContext: () => this.contextService?.clearSessionContext(),
    });
    this.addSettingTab(new KoreanDartCodexSettingTab(this.app, this));
    this.registerView(VIEW_TYPE, (leaf) => new KoreanDartCodexPanelView(leaf, this));

    this.addRibbonIcon("scale", "Open Korean DART Codex", () => {
      void this.openPanel();
    });

    this.addCommand({
      id: "open-korean-dart-codex-panel",
      name: "Open Korean DART Codex panel",
      callback: () => {
        void this.openPanel();
      },
    });

    this.addCommand({
      id: "ask-korean-dart-codex-current-note",
      name: "Ask Korean DART Codex from current note",
      checkCallback: (checking) => {
        const active = this.app.workspace.getActiveFile();
        if (!active || active.extension !== "md") return false;
        if (!checking) void this.openPanel();
        return true;
      },
    });

    this.app.workspace.onLayoutReady(() => {
      if (this.settings.autoOpenPanel) {
        window.setTimeout(() => {
          void this.openPanel(false);
        }, 250);
      }
    });
  }

  onunload(): void {
    if (this.backlinkRefreshTimer !== null) {
      window.clearTimeout(this.backlinkRefreshTimer);
      this.backlinkRefreshTimer = null;
    }
    this.contextService?.clearAll();
    this.dartProvider.shutdown();
    this.visualProvider?.shutdown();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  getModelCatalog(): CodexModelCatalogItem[] {
    return [...this.modelCatalog];
  }

  getModelDropdownOptions(): Record<string, string> {
    const options = modelCatalogToOptions(this.modelCatalog);
    const configured = this.settings.codexModel.trim();
    if (configured && !options[configured]) options[configured] = `${configured} · configured`;
    return options;
  }

  async refreshModelCatalog(force = false): Promise<CodexModelCatalogItem[]> {
    if (this.modelCatalogPromise) return this.modelCatalogPromise;
    if (!force && this.modelCatalogFetchedAt > 0 && Date.now() - this.modelCatalogFetchedAt < 300_000) {
      return this.getModelCatalog();
    }

    const runtime = this.getRuntime();
    this.modelCatalogPromise = discoverCodexModels({
      runtime,
      cwd: this.getVaultPath(),
      timeoutMs: this.settings.codexAppServerTimeoutSeconds * 1000,
    }).then((models) => {
      this.modelCatalog = models;
      this.modelCatalogFetchedAt = Date.now();
      return this.getModelCatalog();
    }).finally(() => {
      this.modelCatalogPromise = null;
    });
    return this.modelCatalogPromise;
  }

  invalidateModelCatalog(): void {
    this.modelCatalogFetchedAt = 0;
  }

  getKoreanDartMcpStatus(): KoreanDartMcpStatus {
    return { ...this.koreanDartMcpStatus };
  }

  async refreshKoreanDartMcpStatus(force = false): Promise<KoreanDartMcpStatus> {
    if (this.koreanDartMcpStatusPromise) return this.koreanDartMcpStatusPromise;
    if (!force && this.koreanDartMcpStatusFetchedAt > 0 && Date.now() - this.koreanDartMcpStatusFetchedAt < 300_000) {
      return this.getKoreanDartMcpStatus();
    }

    this.koreanDartMcpStatus = { ...INITIAL_KOREAN_DART_MCP_STATUS };
    const runtime = this.getRuntime();
    this.koreanDartMcpStatusPromise = discoverKoreanDartMcpStatus({
      runtime,
      cwd: this.getVaultPath(),
      timeoutMs: this.settings.codexAppServerTimeoutSeconds * 1000,
    }).catch((error) => ({
      ...INITIAL_KOREAN_DART_MCP_STATUS,
      state: "failed" as const,
      checkedAt: Date.now(),
      error: summarizeMcpStatusError(error),
    })).then((status) => {
      this.koreanDartMcpStatus = status;
      this.koreanDartMcpStatusFetchedAt = Date.now();
      return this.getKoreanDartMcpStatus();
    }).finally(() => {
      this.koreanDartMcpStatusPromise = null;
    });
    return this.koreanDartMcpStatusPromise;
  }

  invalidateKoreanDartMcpStatus(): void {
    this.koreanDartMcpStatusFetchedAt = 0;
    this.koreanDartMcpStatus = { ...INITIAL_KOREAN_DART_MCP_STATUS };
  }

  async openPanel(showNotice = true): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (existing) {
      this.app.workspace.revealLeaf(existing);
      return;
    }

    const leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getRightLeaf(true);
    if (!leaf) {
      if (showNotice) new Notice("Could not open Korean DART Codex panel.");
      return;
    }

    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  getRuntime(): CodexRuntimeConfig {
    const codexianRuntime = this.settings.codexSettingsSource === "codexian"
      ? getCodexForObsidianRuntime(this.app)
      : null;
    if (codexianRuntime) {
      return {
        ...codexianRuntime,
        permissionMode: mcpCapablePermissionMode(codexianRuntime.permissionMode),
      };
    }
    return {
      source: "custom",
      command: this.settings.codexCommand,
      model: this.settings.codexModel,
      reasoningEffort: this.settings.reasoningEffort,
      permissionMode: this.settings.permissionMode,
      environmentVariables: this.settings.environmentVariables,
    };
  }

  getVaultPath(): string {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      return adapter.getBasePath();
    }
    return "/";
  }

  async getActiveNoteContext(): Promise<ActiveNoteContext> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file ?? this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") return {};

    const selection = view?.editor?.getSelection()?.trim() || undefined;
    const content = await this.app.vault.cachedRead(file);
    return {
      path: file.path,
      content,
      selection,
    };
  }

  async runDartResearch(
    query: string,
    history: PanelMessage[],
    onEvent: (event: DartAgentEvent) => void,
    vaultContext?: ContextSnapshot | null,
    includeActiveNoteContext = true,
  ): Promise<string> {
    const runtime = this.getRuntime();
    const context = includeActiveNoteContext ? await this.getActiveNoteContext() : {};
    const prompt = buildDartResearchPrompt({
      query,
      activeFilePath: context.path,
      activeNoteContent: context.content,
      selection: context.selection,
      history,
      vaultContext,
      includeActiveNoteContext,
    });

    let answer = "";
    let errorMessage = "";
    for await (const event of this.dartProvider.query({
      command: runtime.command,
      cwd: this.getVaultPath(),
      prompt,
      model: runtime.model,
      reasoningEffort: runtime.reasoningEffort,
      permissionMode: runtime.permissionMode,
      environmentVariables: runtime.environmentVariables,
      timeoutMs: this.settings.timeoutSeconds * 1000,
      appServerTimeoutMs: this.settings.codexAppServerTimeoutSeconds * 1000,
      runtimeMode: this.settings.runtimeMode,
      appServerFallback: this.settings.appServerFallback,
      persistSession: this.settings.persistSession,
    })) {
      onEvent(event);
      if (event.type === "text-delta") answer += event.content;
      if (event.type === "text") answer = event.content;
      if (event.type === "error") errorMessage = [event.content, event.detail].filter(Boolean).join("\n");
    }

    const trimmed = answer.trim();
    if (errorMessage) throw new Error(errorMessage);
    return trimmed;
  }

  async runCodexUtility(
    prompt: string,
    onChunk: (chunk: string, stream: "stdout" | "stderr") => void,
  ): Promise<string> {
    const runtime = this.getRuntime();
    const { runCodexExec } = await import("./codex-cli");
    const result = await runCodexExec({
      command: runtime.command,
      cwd: this.getVaultPath(),
      prompt,
      model: runtime.model,
      reasoningEffort: runtime.reasoningEffort,
      permissionMode: runtime.permissionMode,
      environmentVariables: runtime.environmentVariables,
      timeoutMs: this.settings.timeoutSeconds * 1000,
      onStdout: (chunk) => onChunk(chunk, "stdout"),
      onStderr: (chunk) => onChunk(chunk, "stderr"),
    });
    return result.stdout.trim();
  }

  async saveResearchNote(
    query: string,
    response: string,
    contextSnapshot?: ContextSnapshot | null,
  ): Promise<string> {
    const folder = normalizeVaultPath(this.settings.outputFolder || DEFAULT_SETTINGS.outputFolder);
    await ensureFolder(this.app.vault.adapter, folder);
    const note = buildResearchNote({
      query,
      response,
      outputFolder: folder,
      contextSnapshot,
    });
    const path = await uniqueVaultPath(
      this.app.vault.adapter,
      buildResearchNotePath(query, folder),
    );
    await this.app.vault.create(path, note);
    await this.openVaultPath(path);
    return path;
  }

  async createNativeVisualPlan(options: {
    lastAnswer: string;
    mode: DartVisualMode;
    scope: DartVisualScope;
    slideCount: number;
    sourceTitle: string;
    onEvent: (event: NativeVisualEvent) => void;
  }): Promise<DartVisualCollectionPlan> {
    const runtime = this.getRuntime();
    let response = "";
    let errorMessage = "";
    const promptOptions = {
      lastAnswer: options.lastAnswer,
      mode: options.mode,
      scope: options.scope,
      slideCount: options.slideCount,
      sourceTitle: options.sourceTitle,
    };
    const visualProvider = await this.getVisualProvider();
    for await (const event of visualProvider.plan({
      command: runtime.command,
      cwd: this.getVaultPath(),
      prompt: buildNativeVisualPlanPrompt(promptOptions),
      model: runtime.model,
      reasoningEffort: runtime.reasoningEffort,
      permissionMode: runtime.permissionMode,
      environmentVariables: runtime.environmentVariables,
      timeoutMs: this.settings.timeoutSeconds * 1000,
      appServerTimeoutMs: this.settings.codexAppServerTimeoutSeconds * 1000,
    })) {
      options.onEvent(event);
      if (event.type === "text-delta") response += event.content;
      if (event.type === "text") response = event.content;
      if (event.type === "error") errorMessage = [event.content, event.detail].filter(Boolean).join("\n");
    }
    if (errorMessage) throw new Error(errorMessage);
    return parseDartVisualCollectionPlan(response, promptOptions);
  }

  async generateNativeVisualImage(options: {
    prompt: string;
    referenceVaultPath?: string;
    onEvent: (event: NativeVisualEvent) => void;
  }): Promise<{ savedPath: string; revisedPrompt?: string }> {
    const runtime = this.getRuntime();
    let image: { savedPath: string; revisedPrompt?: string } | null = null;
    let errorMessage = "";
    const visualProvider = await this.getVisualProvider();
    for await (const event of visualProvider.generateImage({
      command: runtime.command,
      cwd: this.getVaultPath(),
      prompt: options.prompt,
      model: runtime.model,
      reasoningEffort: runtime.reasoningEffort,
      permissionMode: runtime.permissionMode,
      environmentVariables: runtime.environmentVariables,
      timeoutMs: this.settings.timeoutSeconds * 1000,
      appServerTimeoutMs: this.settings.codexAppServerTimeoutSeconds * 1000,
      referenceImagePath: options.referenceVaultPath ? joinLocalPath(this.getVaultPath(), options.referenceVaultPath) : undefined,
    })) {
      options.onEvent(event);
      if (event.type === "image") image = { savedPath: event.savedPath, revisedPrompt: event.revisedPrompt };
      if (event.type === "error") errorMessage = [event.content, event.detail].filter(Boolean).join("\n");
    }
    if (errorMessage) throw new Error(errorMessage);
    if (!image) throw new Error("Codex app-server가 저장 가능한 PNG 경로를 반환하지 않았습니다.");
    return image;
  }

  async importNativeVisualPng(sourcePath: string, sourceTitle: string, index: number, now = new Date()): Promise<string> {
    const folder = buildVisualAssetFolder(this.settings.outputFolder || DEFAULT_SETTINGS.outputFolder, this.getRuntime().mediaFolder);
    await ensureFolder(this.app.vault.adapter, folder);
    const path = await uniqueVaultPath(
      this.app.vault.adapter,
      buildVisualAssetPath(sourceTitle, folder, index, now),
    );
    const data = await readVerifiedPng(sourcePath);
    await this.app.vault.createBinary(path, data);
    return path;
  }

  async saveVisualCollectionNote(input: {
    sourceTitle: string;
    sourceQuery: string;
    mode: DartVisualMode;
    scope: DartVisualScope;
    plan: DartVisualCollectionPlan;
    assets: SavedVisualAsset[];
    failedPages?: Array<{ index: number; reason: string }>;
  }): Promise<string> {
    const folder = normalizeVaultPath(`${this.settings.outputFolder || DEFAULT_SETTINGS.outputFolder}/Visual Assets`);
    await ensureFolder(this.app.vault.adapter, folder);
    const runtime = this.getRuntime();
    const path = await uniqueVaultPath(
      this.app.vault.adapter,
      buildVisualCollectionNotePath(input.sourceTitle, this.settings.outputFolder || DEFAULT_SETTINGS.outputFolder),
    );
    await this.app.vault.create(path, buildVisualCollectionNote({
      ...input,
      runtime: this.settings.runtimeMode === "app-server" ? "codex-app-server" : "codex-exec",
      model: runtime.model,
    }));
    await this.openVaultPath(path);
    return path;
  }

  async openVaultPath(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      const leaf = this.app.workspace.getLeaf(true);
      await leaf.openFile(file);
    }
  }

  async handoffToCodexForObsidian(notePath: string): Promise<boolean> {
    const codexForObsidian = getCodexForObsidianPlugin(this.app);
    if (!codexForObsidian) return false;
    if (notePath && codexForObsidian.pinNote) {
      await Promise.resolve(codexForObsidian.pinNote(notePath));
    } else if (codexForObsidian.attachCurrentNoteToChat) {
      await Promise.resolve(codexForObsidian.attachCurrentNoteToChat());
    }
    await Promise.resolve(codexForObsidian.activateView?.());
    codexForObsidian.refreshOpenViews?.();
    return true;
  }

  async openCodexForObsidianVisualStudio(notePath?: string): Promise<boolean> {
    const codexForObsidian = getCodexForObsidianPlugin(this.app);
    if (!codexForObsidian?.generateImageFromActiveNote) return false;
    if (notePath) {
      await this.openVaultPath(notePath);
    }
    await Promise.resolve(codexForObsidian.generateImageFromActiveNote());
    return true;
  }

  cancelActiveRequest(): void {
    this.dartProvider.cancel();
    this.visualProvider?.cancel();
  }

  resetDartSession(): void {
    this.dartProvider.resetSession();
  }

  getDartSessionId(): string | null {
    return this.dartProvider.getSessionId();
  }

  getLastRuntimeMode(): string {
    return this.dartProvider.getLastRuntimeMode() ?? this.settings.runtimeMode;
  }

  shutdownVisualProvider(): void {
    this.visualProvider?.shutdown();
    this.visualProvider = null;
  }

  private async getVisualProvider(): Promise<CodexAppServerVisualProvider> {
    if (!this.visualProvider) {
      const module = await import("./codex-appserver-visual");
      this.visualProvider = new module.CodexAppServerVisualProvider();
    }
    return this.visualProvider;
  }

  async openContextPicker(
    options: ContextPickerOptions = {},
    onUseNoContext?: (scope: ContextScope) => void,
  ): Promise<ContextSnapshot | null> {
    const context = this.ensureContextIndexEvents();
    const active = this.app.workspace.getActiveFile();
    const currentPath = active?.extension === "md" ? active.path : undefined;
    const ensureCurrent = async () => {
      if (active instanceof TFile && active.extension === "md") {
        await this.indexVaultFile(active, undefined, undefined, undefined, false);
      }
    };
    const modal = new ContextPickerModal(
      this.app,
      this.vaultIndex,
      context,
      {
        ...options,
        initialPaths: options.initialPaths ?? context
          .listSelected()
          .filter((selected) => selected.scope === (options.scope ?? "turn"))
          .map((selected) => selected.note.path),
        currentPath,
        recentPaths: context.getRecentPaths(),
        onEnsureCurrent: ensureCurrent,
        onEnsureIndex: () => this.ensureVaultIndexInitialized(),
        onRebuildIndex: () => this.ensureVaultIndexInitialized(true),
        onUseNoContext,
      },
    );
    return modal.openForResult();
  }

  getSelectedContextNotes(): SelectedContextNote[] {
    return this.contextService?.listSelected() ?? [];
  }

  previewTurnContext(): ContextSnapshot | null {
    return this.contextService?.previewTurnContext() ?? null;
  }

  prepareTurnContext(): ContextSnapshot | null {
    return this.contextService?.prepareTurnContext() ?? null;
  }

  removeContextNote(path: string, scope: ContextScope): void {
    this.contextService?.remove(path, scope);
  }

  clearConversationContext(): void {
    this.contextService?.clearAll();
  }

  clearOneTurnContext(): void {
    this.contextService?.clearOneTurnContext();
  }

  private ensureContextRuntime(): DartContextService {
    if (!this.contextService) {
      this.contextService = new DartContextService({
        read: async (path) => {
          const file = this.app.vault.getAbstractFileByPath(path);
          if (!(file instanceof TFile) || file.extension !== "md") {
            throw new Error(`Markdown note not found: ${path}`);
          }
          return {
            path: file.path,
            title: file.basename,
            content: await this.app.vault.cachedRead(file),
            modifiedAt: file.stat.mtime,
          };
        },
      });
    }
    return this.contextService;
  }

  private ensureContextIndexEvents(): DartContextService {
    const context = this.ensureContextRuntime();
    if (!this.contextIndexEventsRegistered) {
      this.contextIndexEventsRegistered = true;
      this.registerContextIndexEvents();
    }
    return context;
  }

  private registerContextIndexEvents(): void {
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof TFile && file.extension === "md" && this.shouldIndexIncrementally()) {
        void this.indexVaultFile(file);
      }
    }));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      this.contextService?.markStale(file.path, file.stat.mtime);
      this.refreshContextViews();
      if (this.shouldIndexIncrementally()) void this.indexVaultFile(file);
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      this.contextService?.markStale(file.path);
      this.refreshContextViews();
      this.contextIndexFailures.delete(file.path);
      if (this.shouldIndexIncrementally()) {
        this.vaultIndex.delete(file.path);
        this.vaultIndex.markUpdated(this.contextIndexFailures.size);
        this.scheduleBacklinkRefresh();
      }
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (!(file instanceof TFile)) return;
      this.contextIndexFailures.delete(oldPath);
      this.contextService?.markStale(oldPath);
      this.refreshContextViews();
      if (!this.shouldIndexIncrementally()) return;
      this.vaultIndex.delete(oldPath);
      this.vaultIndex.markUpdated(this.contextIndexFailures.size);
      if (file.extension === "md") void this.indexVaultFile(file, undefined, undefined, oldPath);
    }));
    this.registerEvent(this.app.metadataCache.on("changed", (file, data, cache) => {
      if (file.extension === "md" && this.shouldIndexIncrementally()) void this.indexVaultFile(file, data, cache);
    }));
    this.registerEvent(this.app.metadataCache.on("resolved", () => {
      if (this.shouldIndexIncrementally()) this.scheduleBacklinkRefresh();
    }));
  }

  private shouldIndexIncrementally(): boolean {
    return this.vaultIndexInitialized || this.vaultIndexPromise !== null;
  }

  private async initializeVaultIndex(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    this.vaultIndex.beginIndexing(files.length);
    this.vaultIndex.replaceAll([]);
    this.contextIndexFailures.clear();
    try {
      const batchSize = 12;
      for (let index = 0; index < files.length; index += batchSize) {
        const batch = files.slice(index, index + batchSize);
        await Promise.all(batch.map((file) => (
          this.indexVaultFile(file, undefined, undefined, undefined, false)
        )));
        const processed = index + batch.length;
        this.vaultIndex.reportIndexing(
          processed - this.contextIndexFailures.size,
          this.contextIndexFailures.size,
        );
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
      this.refreshBacklinkIndex();
      this.vaultIndexInitialized = true;
    } finally {
      this.vaultIndex.completeIndexing(this.contextIndexFailures.size);
    }
  }

  private ensureVaultIndexInitialized(force = false): Promise<void> {
    this.ensureContextIndexEvents();
    if (this.vaultIndexPromise) return this.vaultIndexPromise;
    if (this.vaultIndexInitialized && !force) return Promise.resolve();
    this.vaultIndexInitialized = false;
    this.vaultIndexPromise = this.initializeVaultIndex().finally(() => {
      this.vaultIndexPromise = null;
    });
    return this.vaultIndexPromise;
  }

  private async indexVaultFile(
    file: TFile,
    providedContent?: string,
    providedCache?: CachedMetadata,
    oldPath?: string,
    refreshBacklinks = true,
  ): Promise<void> {
    try {
      const content = providedContent ?? await this.app.vault.cachedRead(file);
      const cache = providedCache ?? this.app.metadataCache.getFileCache(file) ?? undefined;
      const resolvedLinks = Object.keys(this.app.metadataCache.resolvedLinks[file.path] ?? {});
      const cachedLinks = (cache?.links ?? []).map((link) => (
        this.app.metadataCache.getFirstLinkpathDest(link.link, file.path)?.path ?? link.link
      ));
      const record = createVaultIndexRecord({
        path: file.path,
        basename: file.basename,
        mtime: file.stat.mtime,
        size: content.length,
        content,
        metadata: {
          frontmatter: cache?.frontmatter,
          headings: cache?.headings?.map((heading) => heading.heading),
          tags: cache?.tags?.map((tag) => tag.tag),
          links: [...resolvedLinks, ...cachedLinks],
          backlinks: this.vaultIndex.get(file.path)?.backlinks ?? [],
        },
      });
      if (oldPath) {
        this.vaultIndex.rename(oldPath, record, refreshBacklinks);
      } else {
        this.vaultIndex.upsert(record, refreshBacklinks);
      }
      this.contextIndexFailures.delete(file.path);
      if (refreshBacklinks) this.vaultIndex.markUpdated(this.contextIndexFailures.size);
      if (refreshBacklinks) this.scheduleBacklinkRefresh();
    } catch {
      this.contextIndexFailures.add(file.path);
      if (refreshBacklinks) this.vaultIndex.markUpdated(this.contextIndexFailures.size);
      // The next vault or metadata event will retry. Never expose note contents or raw errors in logs.
    }
  }

  private scheduleBacklinkRefresh(): void {
    if (this.backlinkRefreshTimer !== null) window.clearTimeout(this.backlinkRefreshTimer);
    this.backlinkRefreshTimer = window.setTimeout(() => {
      this.backlinkRefreshTimer = null;
      this.refreshBacklinkIndex();
    }, 120);
  }

  private refreshBacklinkIndex(): void {
    const backlinks = new Map<string, string[]>();
    for (const [sourcePath, targets] of Object.entries(this.app.metadataCache.resolvedLinks)) {
      for (const targetPath of Object.keys(targets)) {
        const sources = backlinks.get(targetPath) ?? [];
        sources.push(sourcePath);
        backlinks.set(targetPath, sources);
      }
    }
    for (const record of this.vaultIndex.list()) {
      this.vaultIndex.updateBacklinks(record.path, backlinks.get(record.path) ?? []);
    }
  }

  private refreshContextViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof KoreanDartCodexPanelView) {
        leaf.view.refreshContextUi();
      }
    }
  }
}

function joinLocalPath(basePath: string, relativePath: string): string {
  const normalizedBase = basePath.replace(/[/\\]+$/, "");
  const normalizedRelative = normalizePath(relativePath).replace(/^\/+/, "");
  return `${normalizedBase}/${normalizedRelative}`;
}

class KoreanDartCodexPanelView extends ItemView {
  private messages: PanelMessage[] = [];
  private promptValue = "";
  private statusText = "근거를 기다리고 있습니다.";
  private phase: PanelPhase = "idle";
  private isRunning = false;
  private lastResearchAnswer = "";
  private lastResearchQuery = "";
  private lastSavedPath = "";
  private activityLines: string[] = [];
  private diagnosticLines: string[] = [];
  private lastFailedQuery = "";
  private lastTurnContext: ContextSnapshot | null = null;
  private lastTurnIncludedActiveNoteContext = true;
  private readonly noteContextPolicy = new NoteContextPolicy();
  private renderFrame: number | null = null;
  private statusEl: HTMLElement | null = null;
  private statusMarkerEl: HTMLElement | null = null;
  private statusTextEl: HTMLElement | null = null;
  private chatEl: HTMLElement | null = null;
  private streamShouldFollow = true;
  private readonly streamingMessage = new StableStreamingMessage();
  private runStartedAt = 0;
  private elapsedTimer: number | null = null;
  private cancelRequested = false;

  constructor(leaf: WorkspaceLeaf, private plugin: KoreanDartCodexPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Korean DART Codex";
  }

  getIcon(): string {
    return "scale";
  }

  async onOpen(): Promise<void> {
    this.scheduleRender();
    void this.plugin.refreshKoreanDartMcpStatus().then(() => this.scheduleRender());
  }

  async onClose(): Promise<void> {
    if (this.isRunning) {
      this.cancelRequested = true;
      this.plugin.cancelActiveRequest();
    }
    this.cancelRender();
    this.stopElapsedClock();
    this.streamingMessage.detach();
  }

  refreshContextUi(): void {
    if (this.isRunning) {
      this.updateStatusDom();
      return;
    }
    this.render();
  }

  private render(): void {
    try {
      this.renderUnsafe();
    } catch (error) {
      this.renderFailure(error);
    }
  }

  private renderUnsafe(): void {
    this.cancelRender();
    this.streamingMessage.detach();
    this.statusEl = null;
    this.statusMarkerEl = null;
    this.statusTextEl = null;
    this.chatEl = null;
    const { contentEl } = this;
    const shouldScroll = this.shouldAutoScroll();
    contentEl.empty();
    const classes = ["korean-dart-codex-panel"];
    if (this.isRunning) classes.push("is-running");
    if (this.messages.length > 0) classes.push("has-messages");
    const root = contentEl.createDiv({
      cls: classes.join(" "),
    });
    this.renderHeader(root);
    this.renderStatus(root);
    this.renderChat(root, shouldScroll);
    this.renderComposer(root);
  }

  private renderFailure(error: unknown): void {
    this.cancelRender();
    this.streamingMessage.detach();
    this.stopElapsedClock();
    const message = error instanceof Error ? error.message : String(error);
    this.phase = "failed";
    this.statusText = "패널 렌더링 실패";
    this.pushDiagnostic(`Panel render failed: ${message}`);
    this.contentEl.empty();
    const root = this.contentEl.createDiv({ cls: "korean-dart-codex-panel korean-dart-codex-panel-error" });
    root.createEl("h2", { text: "Korean DART Codex" });
    root.createDiv({
      cls: "korean-dart-codex-error",
      text: `패널을 표시하지 못했습니다. Obsidian은 계속 사용할 수 있습니다. 오류: ${message}`,
    });
    this.addSmallButton(root, "다시 시도", "refresh-cw", () => this.render());
  }

  private scheduleRender(): void {
    if (this.renderFrame !== null) return;
    this.renderFrame = window.requestAnimationFrame(() => {
      this.renderFrame = null;
      this.render();
    });
  }

  private cancelRender(): void {
    if (this.renderFrame === null) return;
    window.cancelAnimationFrame(this.renderFrame);
    this.renderFrame = null;
  }

  private renderHeader(root: HTMLElement): void {
    const header = root.createDiv({ cls: "korean-dart-codex-header" });
    const brand = header.createDiv({ cls: "korean-dart-codex-brand" });
    const logo = brand.createDiv({ cls: "korean-dart-codex-logo" });
    logo.innerHTML = KOREAN_DART_SCALE_SVG;
    const title = brand.createDiv({ cls: "korean-dart-codex-title" });
    title.createEl("h2", { text: "Korean DART Codex" });
    title.createDiv({
      cls: "korean-dart-codex-subtitle",
      text: "DART RESEARCH WORKSPACE",
    });

    const actions = header.createDiv({ cls: "korean-dart-codex-header-actions" });
    const resetButton = actions.createEl("button", { cls: "korean-dart-codex-icon-button" });
    resetButton.disabled = this.isRunning;
    resetButton.setAttr("aria-label", "새 대화");
    resetButton.setAttr("title", "새 대화");
    setIconifyIcon(resetButton.createSpan({ cls: "korean-dart-codex-control-icon" }), "newChat");
    resetButton.addEventListener("click", () => {
      this.resetConversation();
    });
  }

  private renderStatus(root: HTMLElement): void {
    const status = root.createDiv({ cls: `korean-dart-codex-status korean-dart-codex-status-${this.phase}` });
    status.setAttr("role", "status");
    status.setAttr("aria-live", "polite");
    const marker = status.createSpan({ cls: "korean-dart-codex-status-marker" });
    setIconifyIcon(marker, phaseIcon(this.phase));
    const text = status.createSpan({
      cls: "korean-dart-codex-status-text",
      text: this.statusLine(),
    });
    text.setAttr("title", this.statusLine());
    this.statusEl = status;
    this.statusMarkerEl = marker;
    this.statusTextEl = text;
    const controls = status.createDiv({ cls: "korean-dart-codex-status-controls" });
    if (this.isRunning) {
      this.addTinyButton(controls, "취소", "square", () => this.cancelCurrent());
    }
    if (this.phase === "failed" && this.lastFailedQuery) {
      this.addTinyButton(controls, "재시도", "refresh-cw", () => void this.retryLast());
    }
    this.renderMcpStatusControl(controls);
    this.addTinyButton(controls, "로그", "clipboard-list", () => void this.copyLogs(), this.diagnosticLines.length === 0);
  }

  private renderMcpStatusControl(parent: HTMLElement): void {
    const status = this.plugin.getKoreanDartMcpStatus();
    const button = parent.createEl("button", {
      cls: `korean-dart-codex-tiny-button korean-dart-codex-mcp-status is-${status.state}`,
    });
    button.disabled = this.isRunning || status.state === "checking";
    renderMcpStatusButton(button, status, setIcon);
    button.addEventListener("click", () => {
      this.statusText = "korean-dart MCP 상태 다시 확인 중";
      this.phase = "preparing";
      this.plugin.invalidateKoreanDartMcpStatus();
      this.render();
      void this.plugin.refreshKoreanDartMcpStatus(true).then((next) => {
        this.phase = next.state === "ready" ? "complete" : "idle";
        this.statusText = mcpStatusTooltip(next);
        this.render();
      });
    });
  }

  private openModelMenu(event: MouseEvent): void {
    const anchor = { x: event.clientX, y: event.clientY };
    const modelCatalog = this.plugin.getModelCatalog();
    void this.plugin.refreshModelCatalog().catch(() => undefined);

    const menu = new Menu();
    const runtime = this.plugin.getRuntime();
    const codexForObsidianRuntime = getCodexForObsidianRuntime(this.plugin.app);

    if (codexForObsidianRuntime) {
      menu.addItem((item) => {
        item
          .setTitle(`${this.plugin.settings.codexSettingsSource === "codexian" ? "✓ " : ""}Codex for Obsidian 런타임 사용`)
          .onClick(() => {
            void this.saveRuntimeChoice("codexian", "Codex for Obsidian 런타임을 사용합니다.");
          });
      });
    } else {
      menu.addItem((item) => {
        item.setTitle("Codex for Obsidian 런타임 미감지").setDisabled(true);
      });
    }

    menu.addSeparator();
    for (const modelInfo of modelCatalog) {
      const model = modelInfo.model;
      const label = `${modelInfo.displayName}${modelInfo.isDefault ? " · Codex default" : ""}`;
      menu.addItem((item) => {
        item
          .setTitle(`${runtime.model === model && this.plugin.settings.codexSettingsSource === "custom" ? "✓ " : ""}${label}`)
          .onClick(() => {
            this.copyRuntimeIntoCustomSettings(runtime);
            this.plugin.settings.codexModel = model;
            if (!modelInfo.supportedReasoningEfforts.includes(this.plugin.settings.reasoningEffort)) {
              this.plugin.settings.reasoningEffort = modelInfo.defaultReasoningEffort;
            }
            void this.saveRuntimeChoice("custom", `모델 변경: ${model}`);
          });
      });
    }

    menu.addSeparator();
    const selectedModel = modelCatalog.find((model) => model.model === runtime.model);
    const supportedEfforts = selectedModel?.supportedReasoningEfforts ?? REASONING_OPTIONS.map(([effort]) => effort);
    for (const [effort, label] of REASONING_OPTIONS.filter(([effort]) => supportedEfforts.includes(effort))) {
      menu.addItem((item) => {
        item
          .setTitle(`${runtime.reasoningEffort === effort && this.plugin.settings.codexSettingsSource === "custom" ? "✓ " : ""}Reasoning · ${label}`)
          .onClick(() => {
            this.copyRuntimeIntoCustomSettings(runtime);
            this.plugin.settings.reasoningEffort = effort;
            void this.saveRuntimeChoice("custom", `추론 모드 변경: ${effort}`);
          });
      });
    }

    menu.showAtPosition(anchor);
  }

  private copyRuntimeIntoCustomSettings(runtime: CodexRuntimeConfig): void {
    if (this.plugin.settings.codexSettingsSource !== "codexian") return;
    this.plugin.settings.codexCommand = runtime.command;
    if (runtime.model) this.plugin.settings.codexModel = runtime.model;
    this.plugin.settings.permissionMode = runtime.permissionMode;
    this.plugin.settings.environmentVariables = runtime.environmentVariables;
  }

  private async saveRuntimeChoice(source: "codexian" | "custom", message: string): Promise<void> {
    this.plugin.settings.codexSettingsSource = source;
    await this.plugin.saveSettings();
    this.plugin.invalidateModelCatalog();
    this.plugin.invalidateKoreanDartMcpStatus();
    this.plugin.resetDartSession();
    this.plugin.shutdownVisualProvider();
    this.phase = "complete";
    this.statusText = message;
    this.pushActivity(message);
    this.render();
    void this.plugin.refreshKoreanDartMcpStatus(true).then(() => this.scheduleRender());
  }

  private resetConversation(): void {
    if (this.isRunning) return;
    this.messages = [];
    this.promptValue = "";
    this.statusText = "근거를 기다리고 있습니다.";
    this.phase = "idle";
    this.lastResearchAnswer = "";
    this.lastResearchQuery = "";
    this.lastSavedPath = "";
    this.activityLines = [];
    this.diagnosticLines = [];
    this.lastFailedQuery = "";
    this.lastTurnContext = null;
    this.lastTurnIncludedActiveNoteContext = true;
    this.noteContextPolicy.clearConversation();
    this.plugin.resetDartSession();
    this.plugin.clearConversationContext();
    this.render();
  }

  private renderChat(root: HTMLElement, shouldScroll: boolean): void {
    const chat = root.createDiv({ cls: "korean-dart-codex-chat" });
    this.chatEl = chat;
    if (this.messages.length === 0) {
      const welcome = chat.createDiv({ cls: "korean-dart-codex-empty klc-welcome" });
      const card = welcome.createDiv({ cls: "klc-welcome-card" });
      const markWrap = card.createDiv({ cls: "klc-scale-stage", attr: { "aria-hidden": "true" } });
      markWrap.createDiv({ cls: "klc-scale-ripple klc-scale-ripple-a" });
      markWrap.createDiv({ cls: "klc-scale-ripple klc-scale-ripple-b" });
      const mark = markWrap.createDiv({ cls: "klc-scale-mark" });
      mark.innerHTML = KOREAN_DART_SCALE_SVG;
      card.createDiv({ cls: "klc-welcome-kicker", text: "KOREAN DART CODEX" });
      card.createDiv({
        cls: "klc-welcome-maxim",
        text: "Let evidence speak; let judgment find its balance.",
      });
      card.createDiv({ cls: "klc-welcome-title", text: "원문 공시에서 시작하는 기업 리서치" });
      card.createDiv({
        cls: "klc-welcome-subtitle",
        text: `Codex app-server · ${mcpWelcomeLabel(this.plugin.getKoreanDartMcpStatus())}`,
      });
    }
    for (const [index, message] of this.messages.entries()) {
      const item = chat.createDiv({ cls: `korean-dart-codex-message korean-dart-codex-message-${message.role}` });
      const isActiveStream = this.isRunning
        && message.role === "assistant"
        && index === this.messages.length - 1;
      const messageHead = item.createDiv({ cls: "korean-dart-codex-message-head" });
      messageHead.createDiv({
        cls: "korean-dart-codex-message-role",
        text: message.role === "user" ? "나" : "Codex",
      });
      if (message.role === "assistant" && message.text.trim() && !isActiveStream) {
        const copy = describeAssistantCopy(message.text);
        renderAssistantCopyButton(messageHead, copy, {
          setIcon: (element, icon) => setIconifyIcon(element, icon),
          onCopy: () => this.copyMessageMarkdown(copy.markdown),
        });
      }
      const body = item.createDiv({ cls: "korean-dart-codex-message-body" });
      if (isActiveStream) {
        body.addClass("korean-dart-codex-streaming");
        body.setText(message.text || "응답 수신 중…");
        this.streamingMessage.attach(body, () => this.afterStreamPaint());
        this.streamingMessage.queue(message.text);
      } else if (message.role === "assistant" && message.text.trim()) {
        body.addClass("korean-dart-codex-markdown");
        void MarkdownRenderer.render(this.app, message.text, body, "", this);
      } else {
        body.setText(message.text || (message.role === "assistant" ? "응답 수신 중..." : ""));
      }
    }
    if (this.lastSavedPath) {
      const saved = chat.createDiv({ cls: "korean-dart-codex-saved" });
      saved.createDiv({ text: `저장됨: ${this.lastSavedPath}` });
      this.addSmallButton(saved, "열기", "file-text", () => {
        void this.plugin.openVaultPath(this.lastSavedPath);
      });
    }
    if (shouldScroll) {
      window.requestAnimationFrame(() => {
        if (!chat.isConnected) return;
        chat.scrollTo({ top: chat.scrollHeight, behavior: this.isRunning ? "auto" : "smooth" });
      });
    }
  }

  private renderActions(root: HTMLElement): void {
    const actions = root.createDiv({ cls: "korean-dart-codex-actions" });
    const hasAnswer = !!this.latestAssistantText();
    this.addActionButton(actions, "복사", "copy", () => void this.copyLatest(), !hasAnswer || this.isRunning);
    this.addActionButton(actions, "노트 저장", "save", () => void this.saveLatest(), !this.lastResearchAnswer || this.isRunning);
    this.addActionButton(actions, "관계도", "mermaid", () => void this.generateMermaid(), !this.lastResearchAnswer || this.isRunning);
    this.addActionButton(actions, "색인", "dataview", () => this.generateDataview(), this.isRunning);
    this.addActionButton(actions, "시각자료", "image", (event) => this.openVisualMenu(event), this.isRunning);
  }

  private renderComposer(root: HTMLElement): void {
    const composer = root.createDiv({ cls: "korean-dart-codex-composer" });
    this.renderContextChips(composer);
    const input = composer.createEl("textarea", { cls: "korean-dart-codex-input" });
    input.placeholder = "예: 삼성전자 최근 3년 재무지표와 주요 공시 리스크를 정리해줘";
    input.value = this.promptValue;
    input.disabled = this.isRunning;
    input.addEventListener("input", () => {
      this.promptValue = input.value;
    });
    input.addEventListener("keydown", (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
      event.preventDefault();
      this.promptValue = input.value;
      void this.ask();
    });

    const toolbar = composer.createDiv({ cls: "korean-dart-codex-composer-toolbar" });
    const modeBar = toolbar.createDiv({ cls: "korean-dart-codex-composer-modebar" });
    const contextButton = modeBar.createEl("button", { cls: "korean-dart-codex-context-button" });
    contextButton.disabled = this.isRunning;
    renderContextButton(
      contextButton,
      this.plugin.getSelectedContextNotes().length,
      setIcon,
      this.noteContextPolicy.getDisabledScope(),
    );
    contextButton.addEventListener("click", () => {
      void this.openContextPicker();
    });
    const runtime = this.plugin.getRuntime();
    const modelButton = modeBar.createEl("button", { cls: "korean-dart-codex-model-chip" });
    modelButton.disabled = this.isRunning;
    modelButton.setAttr("aria-label", "모델 및 추론 모드 변경");
    modelButton.setAttr("title", [
      "모델 및 추론 모드 변경",
      this.runtimeLabel(),
      runtime.source === "codexian" ? "Codex for Obsidian runtime" : "Custom runtime",
    ].join(" · "));
    setIconifyIcon(modelButton.createSpan({ cls: "korean-dart-codex-model-chip-icon" }), "model");
    modelButton.createSpan({
      cls: "korean-dart-codex-model-chip-text",
      text: `${formatModelLabel(runtime.model)} · ${runtime.reasoningEffort ?? "reasoning"}`,
    });
    modelButton.addEventListener("click", (event) => {
      void this.openModelMenu(event);
    });
    modeBar.createSpan({
      cls: "korean-dart-codex-runtime",
      text: this.runtimeLabel(),
      attr: {
        title: [
          runtime.source === "codexian" ? "Codex for Obsidian runtime" : "Custom runtime",
          runtime.model ?? "configured model",
          runtime.reasoningEffort ?? "configured reasoning",
          `${this.plugin.settings.timeoutSeconds}s`,
        ].join(" · "),
      },
    });

    const actionBar = toolbar.createDiv({ cls: "korean-dart-codex-composer-actions" });
    this.renderActions(actionBar);

    const send = actionBar.createEl("button", { cls: "korean-dart-codex-send" });
    send.disabled = this.isRunning;
    setIconifyIcon(send, "send");
    send.setAttr("aria-label", "질문");
    send.setAttr("title", "질문");
    send.addEventListener("click", () => {
      this.promptValue = input.value;
      void this.ask();
    });
  }

  private renderContextChips(parent: HTMLElement): void {
    const selected = this.plugin.getSelectedContextNotes();
    let wrap = renderContextChipRow(parent, selected, {
      disabled: this.isRunning,
      setIcon,
      onRemove: (path, scope) => {
        this.plugin.removeContextNote(path, scope);
        const remaining = this.plugin.getSelectedContextNotes().length;
        if (remaining === 0) {
          this.phase = "idle";
          this.statusText = "근거를 기다리고 있습니다.";
        } else {
          this.phase = "complete";
          this.statusText = `${remaining}개 노트 컨텍스트 준비됨`;
        }
        this.render();
      },
    });
    const disabledScope = this.noteContextPolicy.getDisabledScope();
    if (disabledScope) {
      const chip = renderNoContextChip(parent, disabledScope, {
        disabled: this.isRunning,
        setIcon,
        onRemove: () => {
          this.noteContextPolicy.enable();
          this.phase = "idle";
          this.statusText = "자동 활성 노트 컨텍스트를 다시 사용합니다.";
          this.render();
        },
      });
      wrap = chip.parentElement;
    }
    if (!wrap) return;
    const preview = this.plugin.previewTurnContext();
    if (preview?.truncated || preview?.omissions?.some((omission) => omission.reason === "unreadable")) {
      const unreadable = preview.omissions?.filter((omission) => omission.reason === "unreadable").length ?? 0;
      const warning = document.createElement("div");
      warning.className = "korean-dart-codex-context-budget-warning";
      warning.textContent = [
        `${preview.notes.length}/${preview.selectedCount}개 · ${preview.totalChars.toLocaleString("ko-KR")}자 사용`,
        preview.truncated ? "예산 잘림" : "",
        unreadable ? `${unreadable}개 읽기 실패` : "",
      ].filter(Boolean).join(" · ");
      wrap.append(warning);
    }
  }

  private async openContextPicker(): Promise<void> {
    let noContextScope: ContextScope | null = null;
    const snapshot = await this.plugin.openContextPicker({ scope: "turn" }, (scope) => {
      noContextScope = scope;
      this.noteContextPolicy.disable(scope);
      if (scope === "session") this.plugin.clearConversationContext();
      else this.plugin.clearOneTurnContext();
    });
    if (!snapshot) {
      if (!noContextScope) return;
      this.statusText = noContextScope === "turn"
        ? "이번 질문은 노트 없이 korean-dart MCP로 조사합니다."
        : "현재 대화는 노트 없이 korean-dart MCP로 조사합니다.";
      this.phase = "complete";
      this.render();
      return;
    }
    this.noteContextPolicy.enable();
    const unreadable = snapshot.omissions?.filter((omission) => omission.reason === "unreadable").length ?? 0;
    this.statusText = [
      `${snapshot.notes.length}개 노트 컨텍스트 준비됨`,
      snapshot.truncated ? "일부 잘림" : "",
      unreadable ? `${unreadable}개 읽기 실패` : "",
    ].filter(Boolean).join(" · ");
    this.phase = "complete";
    this.render();
  }

  private async ask(
    contextOverride?: ContextSnapshot | null,
    includeActiveNoteContextOverride?: boolean,
  ): Promise<void> {
    if (this.isRunning) return;
    const query = this.promptValue.trim();
    if (!query) {
      this.statusText = "질문을 입력하세요.";
      this.render();
      return;
    }

    this.messages.push({ role: "user", text: query });
    const assistant: PanelMessage = { role: "assistant", text: "" };
    this.messages.push(assistant);
    this.promptValue = "";
    this.activityLines = [];
    this.diagnosticLines = [];
    this.lastSavedPath = "";
    this.lastFailedQuery = "";
    this.cancelRequested = false;
    const isRetry = includeActiveNoteContextOverride !== undefined;
    const decision = isRetry ? null : this.noteContextPolicy.prepareTurn();
    const includeActiveNoteContext = includeActiveNoteContextOverride
      ?? !decision?.excludeNoteContext;
    const preparedContext = isRetry
      ? (contextOverride ?? null)
      : this.plugin.prepareTurnContext();
    const turnContext = includeActiveNoteContext ? preparedContext : null;
    this.lastTurnContext = turnContext;
    this.lastTurnIncludedActiveNoteContext = includeActiveNoteContext;
    this.start("preparing", "질의 준비 중");

    try {
      const history = this.messages.slice(0, -2);
      this.phase = "searching";
      this.statusText = "공시 근거와 재무 흐름을 확인하는 중...";
      this.pushActivity(this.statusText);
      this.updateStatusDom();
      const answer = await this.plugin.runDartResearch(
        query,
        history,
        (event) => {
          this.ingestAgentEvent(event, assistant);
        },
        turnContext,
        includeActiveNoteContext,
      );
      if (this.cancelRequested) {
        assistant.text = answer || "요청이 취소되었습니다.";
        this.finish("failed", "응답 취소됨");
        return;
      }
      assistant.text = answer;
      this.lastResearchAnswer = answer;
      this.lastResearchQuery = query;
      this.finish("complete", "응답 완료");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastFailedQuery = query;
      assistant.text = `실패: ${message}`;
      this.finish("failed", summarizeFailureMessage(message));
      new Notice(`Korean DART Codex failed: ${message}`, 12000);
    } finally {
      this.isRunning = false;
      this.render();
    }
  }

  private async copyLatest(): Promise<void> {
    const text = this.latestAssistantText();
    if (!text) return;
    await this.copyMessageMarkdown(text);
  }

  private async copyMessageMarkdown(text: string): Promise<void> {
    const copy = describeAssistantCopy(text);
    try {
      await navigator.clipboard.writeText(copy.markdown);
      this.statusText = copy.copiedStatus;
      this.phase = "complete";
      this.pushActivity(this.statusText);
      this.updateStatusDom();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.statusText = "클립보드 복사 실패";
      this.phase = "failed";
      this.pushActivity(this.statusText);
      this.updateStatusDom();
      new Notice(`Copy failed: ${message}`, 8000);
      throw error;
    }
  }

  private async saveLatest(): Promise<void> {
    if (!this.lastResearchAnswer || !this.lastResearchQuery || this.isRunning) return;
    this.start("saving", "Obsidian 노트 저장 중");
    try {
      const path = await this.plugin.saveResearchNote(
        this.lastResearchQuery,
        this.lastResearchAnswer,
        this.lastTurnContext,
      );
      this.lastSavedPath = path;
      this.finish("complete", "DART 공시 리서치 노트를 저장했습니다.");
      new Notice(`Saved Korean DART research: ${path}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.finish("failed", summarizeFailureMessage(message));
      new Notice(`Save failed: ${message}`, 12000);
    } finally {
      this.isRunning = false;
      this.render();
    }
  }

  private async generateMermaid(): Promise<void> {
    await this.runUtility("관계도", buildMermaidPrompt(this.lastResearchAnswer), "analyzing");
  }

  private generateDataview(): void {
    const block = buildDataviewJsBlock(this.plugin.settings.outputFolder || DEFAULT_SETTINGS.outputFolder);
    this.messages.push({ role: "assistant", text: block });
    this.statusText = "색인 블록 생성 완료";
    this.phase = "complete";
    this.pushActivity(this.statusText);
    this.render();
  }

  private async runUtility(label: string, prompt: string, phase: PanelPhase): Promise<void> {
    if (!this.lastResearchAnswer || this.isRunning) return;
    const assistant: PanelMessage = { role: "assistant", text: "" };
    this.messages.push(assistant);
    this.start(phase, `${label} 생성 중`);
    try {
      assistant.text = await this.plugin.runCodexUtility(prompt, (chunk, stream) => {
        if (stream === "stdout") {
          assistant.text += chunk;
          this.updateStreamingAssistant(assistant.text);
        }
        this.ingestChunk(chunk, stream);
      });
      this.finish("complete", `${label} 완료`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      assistant.text = `실패: ${message}`;
      this.finish("failed", summarizeFailureMessage(message));
      new Notice(`${label} failed: ${message}`, 12000);
    } finally {
      this.isRunning = false;
      this.render();
    }
  }

  private async generateVisualAsset(): Promise<void> {
    if (this.isRunning) return;
    let notePath = this.lastSavedPath || undefined;
    try {
      if (!notePath && this.lastResearchAnswer && this.lastResearchQuery) {
        this.start("saving", "이미지 생성을 위해 리서치 노트 저장 중");
        notePath = await this.plugin.saveResearchNote(
          this.lastResearchQuery,
          this.lastResearchAnswer,
          this.lastTurnContext,
        );
        this.lastSavedPath = notePath;
      }

      this.isRunning = false;
      const ok = await this.plugin.openCodexForObsidianVisualStudio(notePath);
      if (ok) {
        this.finish("complete", notePath ? "Codex for Obsidian 시각자료 스튜디오 열림" : "현재 노트로 시각자료 스튜디오 열림");
      } else {
        this.finish("failed", "Codex for Obsidian 시각자료 스튜디오를 찾을 수 없습니다.");
        new Notice("Codex for Obsidian을 활성화하거나 최신 버전으로 업데이트하세요.", 8000);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.finish("failed", summarizeFailureMessage(message));
      new Notice(`Image generation handoff failed: ${message}`, 12000);
    } finally {
      this.isRunning = false;
      this.render();
    }
  }

  private openVisualMenu(event: MouseEvent): void {
    const menu = new Menu();
    const hasAnswer = !!this.lastResearchAnswer;
    this.addVisualPromptMenuItem(menu, "공시 브리프 1장", "disclosure-brief", "single", 1, !hasAnswer);
    this.addVisualPromptMenuItem(menu, "기업 관계도 1장", "company-map", "single", 1, !hasAnswer);
    this.addVisualPromptMenuItem(menu, "공시 타임라인 4장", "filing-timeline", "deck", 4, !hasAnswer);
    this.addVisualPromptMenuItem(menu, "쟁점 매트릭스 4장", "financial-matrix", "deck", 4, !hasAnswer);
    this.addVisualPromptMenuItem(menu, "증거 보드 4장", "evidence-board", "deck", 4, !hasAnswer);
    this.addVisualPromptMenuItem(menu, "리스크 매트릭스 1장", "risk-matrix", "single", 1, !hasAnswer);
    this.addVisualPromptMenuItem(menu, "카드뉴스 4장", "card-news", "deck", 4, !hasAnswer);
    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle("Codex for Obsidian 시각자료 스튜디오")
        .onClick(() => {
          void this.generateVisualAsset();
        });
    });
    menu.showAtMouseEvent(event);
  }

  private addVisualPromptMenuItem(
    menu: Menu,
    title: string,
    mode: DartVisualMode,
    scope: DartVisualScope,
    slideCount: number,
    disabled: boolean,
  ): void {
    menu.addItem((item) => {
      item
        .setTitle(title)
        .setDisabled(disabled)
        .onClick(() => {
          void this.generateVisualPrompt(mode, scope, slideCount, title);
        });
    });
  }

  private async generateVisualPrompt(
    mode: DartVisualMode,
    scope: DartVisualScope,
    slideCount: number,
    label: string,
  ): Promise<void> {
    if (!this.lastResearchAnswer || this.isRunning) return;
    const promptOptions = {
      lastAnswer: this.lastResearchAnswer,
      mode,
      scope,
      slideCount,
      sourceTitle: this.lastResearchQuery,
    };
    if (this.plugin.settings.runtimeMode !== "app-server") {
      await this.runUtility(label, buildImagePromptPrompt(promptOptions), "analyzing");
      return;
    }

    const assistant: PanelMessage = { role: "assistant", text: "" };
    this.messages.push(assistant);
    this.start("analyzing", `${label} 시각자료 분석 중`);
    const assets: SavedVisualAsset[] = [];
    const failures: Array<{ index: number; reason: string }> = [];
    let plan: DartVisualCollectionPlan | null = null;

    try {
      plan = await this.plugin.createNativeVisualPlan({
        ...promptOptions,
        onEvent: (event) => this.ingestNativeVisualEvent(event),
      });
      this.pushActivity(`시각자료 storyboard 준비 완료 · ${plan.pages.length}장`);

      let previousVaultPath: string | undefined;
      for (const page of plan.pages) {
        this.phase = "analyzing";
        this.statusText = `시각자료 ${page.index}/${plan.pages.length} 생성 중`;
        this.pushActivity(this.statusText);
        this.render();
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          try {
            const result = await this.plugin.generateNativeVisualImage({
              prompt: buildNativeVisualSlidePrompt({
                mode,
                scope,
                sourceTitle: this.lastResearchQuery,
                plan,
                page,
                hasReferenceImage: !!previousVaultPath,
              }),
              referenceVaultPath: previousVaultPath,
              onEvent: (event) => this.ingestNativeVisualEvent(event),
            });
            const assetPath = await this.plugin.importNativeVisualPng(result.savedPath, this.lastResearchQuery, page.index);
            assets.push({ index: page.index, path: assetPath, revisedPrompt: result.revisedPrompt });
            previousVaultPath = assetPath;
            this.pushActivity(`시각자료 ${page.index}/${plan.pages.length} PNG 저장 완료`);
            break;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (attempt === 2) {
              failures.push({ index: page.index, reason: summarizeFailureMessage(message) });
              throw error;
            }
            this.pushActivity(`시각자료 ${page.index}/${plan.pages.length} 재시도 중`);
          }
        }
      }

      const notePath = await this.plugin.saveVisualCollectionNote({
        sourceTitle: this.lastResearchQuery,
        sourceQuery: this.lastResearchQuery,
        mode,
        scope,
        plan,
        assets,
      });
      assistant.text = [
        `### ${label} 생성 완료`,
        "",
        `- native app-server PNG ${assets.length}/${plan.pages.length}장 생성`,
        `- 컬렉션 노트: [[${notePath}]]`,
        "- 원본 리서치 노트는 수정하지 않았습니다.",
      ].join("\n");
      this.finish("complete", `${label} ${assets.length}장 생성 완료`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (assets.length > 0 && plan) {
        const recoveryPath = await this.plugin.saveVisualCollectionNote({
          sourceTitle: this.lastResearchQuery,
          sourceQuery: this.lastResearchQuery,
          mode,
          scope,
          plan,
          assets,
          failedPages: failures.length ? failures : [{ index: assets.length + 1, reason: summarizeFailureMessage(message) }],
        });
        assistant.text = [
          `### ${label} 부분 생성`,
          "",
          `- PNG ${assets.length}/${plan.pages.length}장 보존`,
          `- 복구 노트: [[${recoveryPath}]]`,
          `- 실패 원인: ${summarizeFailureMessage(message)}`,
        ].join("\n");
        this.finish("failed", `${label} 일부만 생성됨 · 복구 노트 저장`);
      } else if (this.plugin.settings.appServerFallback) {
        this.pushActivity("native app-server 시각자료 실패 · codex exec 프롬프트 fallback 전환");
        try {
          const fallbackPrompt = await this.plugin.runCodexUtility(buildImagePromptPrompt(promptOptions), (chunk, stream) => {
            this.ingestChunk(chunk, stream);
          });
          assistant.text = [
            `### ${label} native 생성 unavailable`,
            "",
            "`codex exec` 호환 이미지 프롬프트를 생성했습니다. 필요하면 시각자료 메뉴에서 Codex for Obsidian 시각자료 스튜디오를 열 수 있습니다.",
            "",
            fallbackPrompt,
          ].join("\n");
          this.finish("complete", `${label} exec fallback 프롬프트 완료`);
        } catch (fallbackError) {
          const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          assistant.text = `실패: ${fallbackMessage}`;
          this.finish("failed", summarizeFailureMessage(fallbackMessage));
        }
      } else {
        assistant.text = `실패: ${message}`;
        this.finish("failed", summarizeFailureMessage(message));
      }
    } finally {
      this.plugin.shutdownVisualProvider();
      this.isRunning = false;
      this.render();
    }
  }

  private start(phase: PanelPhase, text: string): void {
    this.isRunning = true;
    this.phase = phase;
    this.statusText = text;
    this.startElapsedClock();
    this.pushActivity(text);
    this.render();
  }

  private finish(phase: PanelPhase, text: string): void {
    this.phase = phase;
    this.statusText = text;
    this.stopElapsedClock();
    this.pushActivity(text);
    this.updateStatusDom();
  }

  private ingestChunk(chunk: string, stream: "stdout" | "stderr"): void {
    const activity = formatCodexActivity(chunk);
    if (stream === "stderr" && shouldUpdateStatusFromCodexStderr(chunk)) {
      this.statusText = summarizeCodexStderr(chunk);
    }
    if (!activity) return;
    const visibleActivity = activity.startsWith("korean-dart/")
      ? activity
      : "Codex runtime activity";
    this.statusText = activity.startsWith("korean-dart/")
      ? activity
      : this.statusText;
    this.pushActivity(visibleActivity);
    this.updateStatusDom();
  }

  private ingestAgentEvent(event: DartAgentEvent, assistant: PanelMessage): void {
    const diagnostic = event.type === "text" || event.type === "text-delta"
      ? `${event.type}: ${event.content.length} chars`
      : event.type;
    this.pushDiagnostic(diagnostic);
    switch (event.type) {
      case "text-delta":
        assistant.text += event.content;
        this.updateStreamingAssistant(assistant.text);
        break;
      case "text":
        assistant.text = event.content;
        this.updateStreamingAssistant(assistant.text);
        break;
      case "progress":
        this.ingestChunk(event.content, "stderr");
        break;
      case "approval-request":
        this.statusText = event.title;
        this.pushActivity("Codex 승인 요청");
        this.updateStatusDom();
        break;
      case "error":
        this.statusText = summarizeFailureMessage([event.content, event.detail].filter(Boolean).join("\n"));
        this.pushActivity(this.statusText);
        this.updateStatusDom();
        break;
      case "done":
        this.pushActivity("Codex turn 완료");
        break;
    }
  }

  private ingestNativeVisualEvent(event: NativeVisualEvent): void {
    this.pushDiagnostic(event.type);
    if (event.type === "progress") {
      this.ingestChunk(event.content, "stderr");
      return;
    }
    if (event.type === "image") {
      this.pushActivity("Codex native PNG 수신");
      this.scheduleRender();
      return;
    }
    if (event.type === "error") {
      this.statusText = summarizeFailureMessage([event.content, event.detail].filter(Boolean).join("\n"));
      this.pushActivity(this.statusText);
      this.scheduleRender();
    }
  }

  private latestAssistantText(): string {
    for (let index = this.messages.length - 1; index >= 0; index -= 1) {
      const message = this.messages[index];
      if (message.role === "assistant" && message.text.trim()) return message.text.trim();
    }
    return "";
  }

  private addActionButton(parent: HTMLElement, label: string, icon: IconifyName, onClick: (event: MouseEvent) => void, disabled = false): void {
    const button = parent.createEl("button", { cls: "korean-dart-codex-action" });
    button.disabled = disabled;
    button.setAttr("aria-label", label);
    button.setAttr("title", label);
    const iconEl = button.createSpan({ cls: "korean-dart-codex-action-icon" });
    setIconifyIcon(iconEl, icon);
    button.createSpan({ cls: "korean-dart-codex-action-label", text: label });
    button.addEventListener("click", onClick);
  }

  private addSmallButton(parent: HTMLElement, label: string, icon: string, onClick: () => void): void {
    const button = parent.createEl("button", { cls: "korean-dart-codex-small-button" });
    setIcon(button.createSpan(), icon);
    button.createSpan({ text: label });
    button.addEventListener("click", onClick);
  }

  private addTinyButton(parent: HTMLElement, label: string, icon: string, onClick: () => void, disabled = false): void {
    const button = parent.createEl("button", { cls: "korean-dart-codex-tiny-button" });
    button.disabled = disabled;
    button.setAttr("aria-label", label);
    button.setAttr("title", label);
    setIcon(button.createSpan(), icon);
    button.createSpan({ text: label });
    button.addEventListener("click", onClick);
  }

  private cancelCurrent(): void {
    if (!this.isRunning) return;
    this.cancelRequested = true;
    this.plugin.cancelActiveRequest();
    this.statusText = "취소 요청 전송";
    this.phase = "failed";
    this.stopElapsedClock();
    this.pushActivity(this.statusText);
    this.updateStatusDom();
  }

  private async retryLast(): Promise<void> {
    if (!this.lastFailedQuery || this.isRunning) return;
    this.promptValue = this.lastFailedQuery;
    await this.ask(this.lastTurnContext, this.lastTurnIncludedActiveNoteContext);
  }

  private async copyLogs(): Promise<void> {
    if (this.diagnosticLines.length === 0) return;
    await navigator.clipboard.writeText(this.diagnosticLines.join("\n"));
    this.statusText = "진단 로그 복사됨";
    this.phase = "complete";
    this.render();
  }

  private pushActivity(text: string): void {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) return;
    const time = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    this.activityLines = [...this.activityLines, `${time} · ${normalized}`].slice(-5);
    this.pushDiagnostic(`${time} · ${normalized}`);
  }

  private pushDiagnostic(text: string): void {
    if (!this.plugin.settings.showRuntimeDiagnostics) return;
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) return;
    this.diagnosticLines = [...this.diagnosticLines, normalized].slice(-200);
  }

  private shouldAutoScroll(): boolean {
    const current = this.chatEl ?? this.contentEl.querySelector(".korean-dart-codex-chat");
    if (!(current instanceof HTMLElement)) return true;
    return current.scrollTop + current.clientHeight >= current.scrollHeight - 96;
  }

  private updateStreamingAssistant(text: string): void {
    this.streamShouldFollow = this.shouldAutoScroll();
    this.streamingMessage.queue(text);
  }

  private afterStreamPaint(): void {
    const chat = this.chatEl;
    if (!chat?.isConnected || !this.streamShouldFollow) return;
    chat.scrollTo({ top: chat.scrollHeight, behavior: "auto" });
  }

  private statusLine(): string {
    const elapsed = this.isRunning && this.runStartedAt > 0
      ? ` · 경과 ${formatElapsedTime(Date.now() - this.runStartedAt)} · 취소 가능`
      : "";
    return `${phaseLabel(this.phase)} · ${this.statusText}${elapsed}`;
  }

  private updateStatusDom(): void {
    if (!this.statusEl?.isConnected || !this.statusTextEl?.isConnected) return;
    for (const phase of PANEL_PHASES) {
      this.statusEl.removeClass(`korean-dart-codex-status-${phase}`);
    }
    this.statusEl.addClass(`korean-dart-codex-status-${this.phase}`);
    if (this.statusMarkerEl?.isConnected) {
      setIconifyIcon(this.statusMarkerEl, phaseIcon(this.phase));
    }
    const line = this.statusLine();
    this.statusTextEl.setText(line);
    this.statusTextEl.setAttr("title", line);
  }

  private startElapsedClock(): void {
    this.stopElapsedClock();
    this.runStartedAt = Date.now();
    this.elapsedTimer = window.setInterval(() => {
      this.updateStatusDom();
    }, 1000);
  }

  private stopElapsedClock(): void {
    if (this.elapsedTimer !== null) {
      window.clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    }
    this.runStartedAt = 0;
  }

  private runtimeLabel(): string {
    const mode = this.plugin.getLastRuntimeMode();
    if (mode === "exec-fallback") return "exec fallback";
    if (mode === "app-server") return "app-server";
    return "exec";
  }
}

const PANEL_PHASES: readonly PanelPhase[] = [
  "idle",
  "preparing",
  "searching",
  "analyzing",
  "saving",
  "complete",
  "failed",
];

function formatElapsedTime(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function ensureFolder(adapter: { exists(path: string): Promise<boolean>; mkdir(path: string): Promise<void> }, folder: string): Promise<void> {
  const normalized = normalizePath(folder);
  const parts = normalized.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!await adapter.exists(current)) {
      await adapter.mkdir(current);
    }
  }
}

function phaseLabel(phase: PanelPhase): string {
  switch (phase) {
    case "preparing":
      return "준비";
    case "searching":
      return "검색";
    case "analyzing":
      return "분석";
    case "saving":
      return "저장";
    case "complete":
      return "완료";
    case "failed":
      return "실패";
    case "idle":
    default:
      return "대기";
  }
}

function phaseIcon(phase: PanelPhase): IconifyName {
  switch (phase) {
    case "searching":
      return "search";
    case "analyzing":
      return "brain";
    case "saving":
      return "saveStatus";
    case "complete":
      return "check";
    case "failed":
      return "warning";
    case "preparing":
    case "idle":
    default:
      return "brain";
  }
}

function formatModelLabel(model?: string): string {
  if (!model) return "model";
  return model
    .replace(/^gpt-/, "GPT ")
    .replace("-codex-spark", " spark")
    .replace("-codex", " codex");
}
