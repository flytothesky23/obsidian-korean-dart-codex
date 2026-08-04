// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { ContextPickerModal } from "../src/context-picker";
import { renderContextChipRow, renderNoContextChip } from "../src/context-ui";
import { DartContextService } from "../src/dart-context";
import { VaultIndexService, type VaultIndexRecord } from "../src/vault-index";

describe("ContextPickerModal DOM", () => {
  beforeEach(() => {
    installObsidianElementHelpers();
    document.body.replaceChildren();
  });

  it("shows the real local index state and updates live progress", () => {
    const index = new VaultIndexService();
    index.beginIndexing(2);
    const context = contextService();
    const ensure = vi.fn();
    const rebuild = vi.fn();
    const modal = new ContextPickerModal({} as App, index, context, {
      mode: "notes",
      onEnsureIndex: ensure,
      onRebuildIndex: rebuild,
    });

    void modal.openForResult();

    expect(ensure).toHaveBeenCalledOnce();
    expect(document.querySelector(".korean-dart-context-index-status-primary")?.textContent)
      .toBe("인덱싱 중 0/2");
    expect(document.querySelector(".korean-dart-context-index-status-help")?.textContent)
      .toContain("로컬 Markdown 인덱스");
    expect(document.querySelector<HTMLInputElement>(".korean-dart-context-search")?.placeholder)
      .toBe("노트 제목·경로·별칭·태그·제목 검색");

    index.upsert(record("Companies/one.md"));
    index.reportIndexing(1);
    expect(document.querySelector(".korean-dart-context-index-status-primary")?.textContent)
      .toBe("인덱싱 중 1/2");

    index.completeIndexing();
    expect(document.querySelector(".korean-dart-context-index-status-primary")?.textContent)
      .toBe("Markdown 1개 인덱싱됨 · 최신");

    document.querySelector<HTMLButtonElement>(".korean-dart-context-index-rebuild")?.click();
    expect(rebuild).toHaveBeenCalledOnce();
    modal.close();
  });

  it("does not start the Markdown index until a note-backed mode is requested", async () => {
    const index = new VaultIndexService();
    const context = contextService();
    const ensure = vi.fn();
    const useNoContext = vi.fn();
    const modal = new ContextPickerModal({} as App, index, context, {
      onEnsureIndex: ensure,
      onUseNoContext: useNoContext,
    });

    const resultPromise = modal.openForResult();

    expect(ensure).not.toHaveBeenCalled();
    expect(document.querySelector(".korean-dart-context-index-status-primary")?.textContent)
      .toBe("Markdown 색인 대기 · 노트 선택 시 시작");
    expect(document.querySelector(".korean-dart-context-empty")?.textContent)
      .toContain("노트 없이 공식 공시·재무·지분 자료");
    const apply = document.querySelector<HTMLButtonElement>(".korean-dart-context-apply");
    expect(apply?.disabled).toBe(false);
    expect(apply?.textContent).toBe("컨텍스트 없이 진행");
    apply?.click();

    expect(await resultPromise).toBeNull();
    expect(useNoContext).toHaveBeenCalledWith("turn");
    expect(document.querySelector(".korean-dart-context-modal")).toBeNull();

    const composer = document.createElement("div");
    renderNoContextChip(composer, "turn", {
      setIcon: (element, icon) => element.setAttribute("data-icon", icon),
      onRemove: vi.fn(),
    });
    expect(composer.querySelector(".korean-dart-codex-context-chip.is-none")?.textContent)
      .toContain("노트 컨텍스트 없음");
  });

  it("starts full local indexing only after the user selects a note-backed mode", () => {
    const index = new VaultIndexService();
    const context = contextService();
    const ensure = vi.fn();
    const modal = new ContextPickerModal({} as App, index, context, {
      onEnsureIndex: ensure,
    });

    void modal.openForResult();
    const notesMode = Array.from(document.querySelectorAll<HTMLButtonElement>(".korean-dart-context-mode"))
      .find((button) => button.textContent?.includes("노트 선택"));
    notesMode?.click();

    expect(ensure).toHaveBeenCalledOnce();
    expect(document.querySelector<HTMLInputElement>(".korean-dart-context-search")?.placeholder)
      .toBe("노트 제목·경로·별칭·태그·제목 검색");
    modal.close();
  });

  it("prepares only the active note when current-note mode is requested", () => {
    const index = new VaultIndexService();
    const context = contextService();
    const ensureCurrent = vi.fn();
    const ensureFullIndex = vi.fn();
    const modal = new ContextPickerModal({} as App, index, context, {
      mode: "current",
      currentPath: "Companies/반도체 사업보고서.md",
      onEnsureCurrent: ensureCurrent,
      onEnsureIndex: ensureFullIndex,
    });

    void modal.openForResult();

    expect(ensureCurrent).toHaveBeenCalledOnce();
    expect(ensureFullIndex).not.toHaveBeenCalled();
    modal.close();
  });

  it("applies a selected note, closes, and makes the chip row immediately renderable", async () => {
    const index = new VaultIndexService([record("Facts/사실관계.md", {
      title: "사실관계",
      size: 6_600,
    })]);
    const context = contextService();
    const modal = new ContextPickerModal({} as App, index, context, {
      mode: "current",
      scope: "turn",
      currentPath: "Facts/사실관계.md",
    });

    const resultPromise = modal.openForResult();
    expect(document.querySelector(".korean-dart-context-summary")?.textContent)
      .toBe("1개 선택 · 약 6.6k자 / 전체 예산 32k자 · 이번 질문만");
    const apply = document.querySelector<HTMLButtonElement>(".korean-dart-context-apply");
    expect(apply?.textContent).toBe("1개 노트 적용");
    apply?.click();

    const snapshot = await resultPromise;
    expect(snapshot?.notes[0].path).toBe("Facts/사실관계.md");
    expect(document.querySelector(".korean-dart-context-modal")).toBeNull();

    const composer = document.createElement("div");
    renderContextChipRow(composer, context.listSelected(), {
      setIcon: (element, icon) => element.setAttribute("data-icon", icon),
      onRemove: vi.fn(),
    });
    expect(composer.querySelector(".korean-dart-codex-context-chip")?.textContent)
      .toContain("이번 질문만");
  });
});

function contextService(): DartContextService {
  return new DartContextService({
    read: async (path) => ({
      path,
      title: path.split("/").pop()?.replace(/\.md$/, "") ?? path,
      content: "x".repeat(6_600),
      modifiedAt: 100,
    }),
  });
}

function record(path: string, overrides: Partial<VaultIndexRecord> = {}): VaultIndexRecord {
  const basename = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
  return {
    path,
    title: basename,
    basename,
    folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
    aliases: [],
    tags: [],
    frontmatter: "",
    headings: [],
    links: [],
    backlinks: [],
    mtime: 1,
    size: 100,
    excerpt: "",
    ...overrides,
  };
}

function installObsidianElementHelpers(): void {
  const prototype = HTMLElement.prototype as unknown as Record<string, unknown>;
  prototype.addClass = function addClass(this: HTMLElement, ...classes: string[]) {
    this.classList.add(...classes);
  };
  prototype.empty = function empty(this: HTMLElement) {
    this.replaceChildren();
  };
  prototype.setAttr = function setAttr(this: HTMLElement, name: string, value: string) {
    this.setAttribute(name, value);
  };
  prototype.setText = function setText(this: HTMLElement, value: string) {
    this.textContent = value;
  };
  prototype.createDiv = function createDiv(
    this: HTMLElement,
    options: { cls?: string; text?: string; attr?: Record<string, string> } = {},
  ) {
    return createChild(this, "div", options) as HTMLDivElement;
  };
  prototype.createSpan = function createSpan(
    this: HTMLElement,
    options: { cls?: string; text?: string; attr?: Record<string, string> } = {},
  ) {
    return createChild(this, "span", options) as HTMLSpanElement;
  };
  prototype.createEl = function createEl(
    this: HTMLElement,
    tag: string,
    options: { cls?: string; text?: string; type?: string; value?: string; placeholder?: string } = {},
  ) {
    const child = createChild(this, tag, options);
    if (options.type) child.setAttribute("type", options.type);
    if (options.value) child.setAttribute("value", options.value);
    if (options.placeholder) child.setAttribute("placeholder", options.placeholder);
    return child;
  };
}

function createChild(
  parent: HTMLElement,
  tag: string,
  options: { cls?: string; text?: string; attr?: Record<string, string> },
): HTMLElement {
  const child = document.createElement(tag);
  if (options.cls) child.className = options.cls;
  if (options.text !== undefined) child.textContent = options.text;
  for (const [name, value] of Object.entries(options.attr ?? {})) child.setAttribute(name, value);
  parent.append(child);
  return child;
}
