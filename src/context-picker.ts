import {
  App,
  Modal,
  Notice,
  setIcon,
} from "obsidian";
import type {
  ContextPickerMode,
  ContextPickerOptions,
} from "./context-api";
import {
  formatApplyLabel,
  formatChars,
  formatContextFooterSummary,
  formatIndexStatusText,
} from "./context-picker-format";
import {
  type ContextScope,
  type ContextSnapshot,
  DartContextService,
} from "./dart-context";
import {
  type VaultIndexRecord,
  VaultIndexService,
} from "./vault-index";

interface ContextPickerModalOptions extends ContextPickerOptions {
  currentPath?: string;
  recentPaths?: string[];
  onEnsureCurrent?: () => Promise<unknown> | unknown;
  onEnsureIndex?: () => Promise<unknown> | unknown;
  onRebuildIndex?: () => Promise<unknown> | unknown;
  onUseNoContext?: (scope: ContextScope) => void;
}

const MODE_LABELS: Array<[ContextPickerMode, string, string]> = [
  ["none", "사용 안 함", "book-x"],
  ["current", "현재 노트", "file-text"],
  ["notes", "노트 선택", "files"],
  ["folder", "폴더 선택", "folder"],
  ["related", "관련 노트 찾기", "search"],
  ["recent", "최근 사용", "history"],
];

export class ContextPickerModal extends Modal {
  private mode: ContextPickerMode;
  private contextScope: ContextScope;
  private query = "";
  private folder = "";
  private readonly selected = new Set<string>();
  private settled = false;
  private resolveResult: ((snapshot: ContextSnapshot | null) => void) | null = null;
  private unsubscribeIndexStatus: (() => void) | null = null;

  constructor(
    app: App,
    private readonly index: VaultIndexService,
    private readonly context: DartContextService,
    private readonly options: ContextPickerModalOptions = {},
  ) {
    super(app);
    this.mode = options.mode ?? ((options.initialPaths?.length ?? 0) > 0 ? "notes" : "none");
    this.contextScope = options.scope ?? "turn";
    for (const path of options.initialPaths ?? []) this.selected.add(path);
    if (this.mode === "current" && options.currentPath) this.selected.add(options.currentPath);
  }

  openForResult(): Promise<ContextSnapshot | null> {
    const promise = new Promise<ContextSnapshot | null>((resolve) => {
      this.resolveResult = resolve;
    });
    this.open();
    return promise;
  }

  onOpen(): void {
    this.modalEl.addClass("korean-dart-context-modal");
    this.setTitle("DART 공시 리서치 컨텍스트");
    this.unsubscribeIndexStatus = this.index.subscribeStatus(() => {
      if (this.modalEl.isConnected) this.render();
    });
    this.render();
    this.ensureModeIndex();
  }

  onClose(): void {
    this.unsubscribeIndexStatus?.();
    this.unsubscribeIndexStatus = null;
    this.contentEl.empty();
    if (!this.settled) this.finish(null);
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.createDiv({
      cls: "korean-dart-context-intro",
      text: "노트 컨텍스트는 선택 사항입니다. 사용 안 함이면 vault 노트를 읽지 않고 korean-dart MCP로만 조사합니다. 선택한 노트는 고정 스냅샷으로만 전달되며 원본은 수정되지 않습니다.",
    });
    this.renderIndexStatus(root);

    const modes = root.createDiv({ cls: "korean-dart-context-modes" });
    for (const [mode, label, icon] of MODE_LABELS) {
      const button = modes.createEl("button", {
        cls: `korean-dart-context-mode${this.mode === mode ? " is-active" : ""}`,
      });
      setIcon(button.createSpan(), icon);
      button.createSpan({ text: label });
      button.setAttr("title", label);
      button.addEventListener("click", () => {
        this.mode = mode;
        if (mode === "none") this.selected.clear();
        if (mode === "current" && this.options.currentPath) this.selected.add(this.options.currentPath);
        this.render();
        this.ensureModeIndex();
      });
    }

    if (this.mode !== "none") {
      const controls = root.createDiv({ cls: "korean-dart-context-controls" });
      const search = controls.createEl("input", {
        cls: "korean-dart-context-search",
        type: "search",
        placeholder: "노트 제목·경로·별칭·태그·제목 검색",
      });
      search.value = this.query;
      search.addEventListener("input", () => {
        this.query = search.value;
        this.renderResults(root);
      });

      if (this.mode === "folder") {
        const select = controls.createEl("select", { cls: "korean-dart-context-folder-select" });
        const folders = this.index.listFolders();
        if (!this.folder && folders.length) this.folder = folders[0];
        for (const folder of folders) {
          const option = select.createEl("option", { value: folder, text: folder });
          option.selected = folder === this.folder;
        }
        select.addEventListener("change", () => {
          this.folder = select.value;
          this.renderResults(root);
        });
        const selectFolder = controls.createEl("button", { cls: "korean-dart-context-select-folder" });
        selectFolder.setAttr("aria-label", "표시된 폴더 노트 선택");
        selectFolder.setAttr("title", `표시된 노트를 최대 ${this.context.budget.maxNotes}개까지 선택`);
        setIcon(selectFolder, "list-plus");
        selectFolder.addEventListener("click", () => {
          for (const record of this.recordsForMode()) {
            if (this.selected.size >= this.context.budget.maxNotes) break;
            this.selected.add(record.path);
          }
          this.render();
        });
      }
    }

    const scope = root.createDiv({ cls: "korean-dart-context-scope" });
    scope.createSpan({ text: "범위" });
    this.addScopeButton(scope, "turn", "이번 질문만");
    this.addScopeButton(scope, "session", "현재 대화");

    this.renderResults(root);
  }

  private renderIndexStatus(root: HTMLElement): void {
    const status = this.index.getStatus();
    const bar = root.createDiv({ cls: "korean-dart-context-index-status" });
    const statusText = bar.createDiv({ cls: "korean-dart-context-index-status-text" });
    const primary = statusText.createSpan({ text: formatIndexStatusText(status) });
    primary.addClass("korean-dart-context-index-status-primary");
    statusText.createSpan({
      cls: "korean-dart-context-index-status-help",
      text: "로컬 Markdown 인덱스 기반 · 노트 원문 외부 캐시 없음",
    });
    if (status.updatedAt) {
      statusText.createSpan({
        cls: "korean-dart-context-index-status-time",
        text: `갱신 ${formatUpdatedAt(status.updatedAt)}`,
      });
    }

    const rebuild = bar.createEl("button", { cls: "korean-dart-context-index-rebuild" });
    rebuild.type = "button";
    rebuild.disabled = status.phase === "indexing" || !this.options.onRebuildIndex;
    rebuild.setAttr("aria-label", "Markdown 인덱스 다시 만들기");
    rebuild.setAttr("title", "Markdown 인덱스 다시 만들기");
    setIcon(rebuild, "refresh-cw");
    rebuild.addEventListener("click", () => {
      const result = this.options.onRebuildIndex?.();
      if (result && typeof (result as Promise<unknown>).then === "function") {
        void (result as Promise<unknown>).catch(() => {
          new Notice("Markdown 인덱스 갱신을 시작하지 못했습니다.", 8_000);
        });
      }
    });
  }

  private renderResults(root: HTMLElement): void {
    root.querySelector(".korean-dart-context-results")?.remove();
    root.querySelector(".korean-dart-context-footer")?.remove();

    const results = root.createDiv({ cls: "korean-dart-context-results" });
    const records = this.recordsForMode();
    if (!records.length) {
      results.createDiv({
        cls: "korean-dart-context-empty",
        text: this.mode === "none"
          ? "노트 없이 공식 공시·재무·지분 자료를 korean-dart MCP로 바로 조사합니다."
          : this.mode === "current" && !this.options.currentPath
          ? "활성 Markdown 노트가 없습니다."
          : "조건에 맞는 Markdown 노트가 없습니다.",
      });
    }
    for (const record of records) this.renderRecord(results, record);

    const footer = root.createDiv({ cls: "korean-dart-context-footer" });
    const estimate = this.index.estimate([...this.selected], this.context.budget);
    const summary = footer.createDiv({ cls: `korean-dart-context-summary${estimate.truncated ? " is-truncated" : ""}` });
    summary.createSpan({
      text: formatContextFooterSummary(
        estimate.selectedCount,
        estimate.estimatedChars,
        this.context.budget.maxChars,
        this.contextScope,
      ),
    });
    if (estimate.truncated) {
      summary.createSpan({
        cls: "korean-dart-context-warning",
        text: `잘림 · 최대 ${this.context.budget.maxNotes}개 / ${formatChars(this.context.budget.maxChars)} 예산 초과`,
      });
    }

    const apply = footer.createEl("button", {
      cls: "mod-cta korean-dart-context-apply",
      text: formatApplyLabel(estimate.selectedCount),
    });
    apply.addEventListener("click", () => {
      void this.applySelection();
    });
  }

  private renderRecord(parent: HTMLElement, record: VaultIndexRecord): void {
    const row = parent.createEl("label", {
      cls: `korean-dart-context-result${this.selected.has(record.path) ? " is-selected" : ""}`,
    });
    const checkbox = row.createEl("input", { type: "checkbox" });
    checkbox.checked = this.selected.has(record.path);
    checkbox.disabled = !checkbox.checked && this.selected.size >= this.context.budget.maxNotes;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        if (this.selected.size >= this.context.budget.maxNotes) {
          checkbox.checked = false;
          new Notice(`컨텍스트는 최대 ${this.context.budget.maxNotes}개 노트까지 선택할 수 있습니다.`);
          return;
        }
        this.selected.add(record.path);
      } else {
        this.selected.delete(record.path);
      }
      this.render();
    });
    const body = row.createDiv({ cls: "korean-dart-context-result-body" });
    body.createDiv({ cls: "korean-dart-context-result-title", text: record.title });
    body.createDiv({ cls: "korean-dart-context-result-path", text: record.path });
    const detail = body.createDiv({ cls: "korean-dart-context-result-detail" });
    if (record.tags.length) detail.createSpan({ text: record.tags.slice(0, 3).map((tag) => `#${tag}`).join(" ") });
    detail.createSpan({ text: `${formatChars(record.size)} · ${formatModified(record.mtime)}` });
    if (record.excerpt) body.createDiv({ cls: "korean-dart-context-result-excerpt", text: record.excerpt });
  }

  private recordsForMode(): VaultIndexRecord[] {
    let records: VaultIndexRecord[];
    switch (this.mode) {
      case "none":
        records = [];
        break;
      case "current":
        records = this.options.currentPath ? this.index.resolve([this.options.currentPath]) : [];
        break;
      case "folder":
        records = this.query.trim()
          ? this.index.search(this.query, { folder: this.folder, limit: 100 }).map((result) => result.record)
          : this.index.list().filter((record) => record.folder === this.folder || record.folder.startsWith(`${this.folder}/`));
        break;
      case "related":
        records = this.options.currentPath
          ? this.index.findRelated(this.options.currentPath, 100).map((result) => result.record)
          : [];
        break;
      case "recent":
        records = this.index.resolve(this.options.recentPaths ?? []);
        break;
      case "notes":
      default:
        records = this.query.trim()
          ? this.index.search(this.query, { limit: 100 }).map((result) => result.record)
          : this.index.list().slice(0, 100);
        break;
    }
    if (!this.query.trim() || this.mode === "notes" || this.mode === "folder") return records;
    const matches = new Set(this.index.search(this.query, { limit: 500 }).map((result) => result.record.path));
    return records.filter((record) => matches.has(record.path));
  }

  private addScopeButton(parent: HTMLElement, scope: ContextScope, label: string): void {
    const button = parent.createEl("button", {
      cls: `korean-dart-context-scope-button${this.contextScope === scope ? " is-active" : ""}`,
      text: label,
    });
    button.addEventListener("click", () => {
      this.contextScope = scope;
      this.render();
    });
  }

  private async applySelection(): Promise<void> {
    if (!this.selected.size) {
      this.options.onUseNoContext?.(this.contextScope);
      this.finish(null);
      this.close();
      return;
    }
    try {
      const snapshot = await this.context.setContext([...this.selected], this.contextScope);
      this.finish(snapshot);
      this.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`컨텍스트 스냅샷 생성 실패: ${message}`, 10_000);
    }
  }

  private ensureModeIndex(): void {
    if (this.mode === "none") return;
    const result = this.mode === "current"
      ? this.options.onEnsureCurrent?.()
      : this.options.onEnsureIndex?.();
    if (result && typeof (result as Promise<unknown>).then === "function") {
      void (result as Promise<unknown>).catch(() => {
        new Notice("Markdown 인덱스 준비를 시작하지 못했습니다.", 8_000);
      });
    }
  }

  private finish(snapshot: ContextSnapshot | null): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveResult?.(snapshot);
    this.resolveResult = null;
  }
}

function formatModified(mtime: number): string {
  if (!mtime) return "수정시각 미상";
  return new Date(mtime).toLocaleDateString("ko-KR", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatUpdatedAt(value: number): string {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
