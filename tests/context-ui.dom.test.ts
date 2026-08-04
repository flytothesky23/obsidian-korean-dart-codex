// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import {
  buildContextChipTooltip,
  renderContextButton,
  renderContextChipRow,
  renderNoContextChip,
} from "../src/context-ui";
import {
  DartContextService,
  type SelectedContextNote,
} from "../src/dart-context";

describe("context composer DOM", () => {
  it("renders a distinct context button with accessible label, active state, and count badge", () => {
    const button = document.createElement("button");

    renderContextButton(button, 0, iconRenderer);

    expect(button.getAttribute("aria-label")).toBe("컨텍스트 추가");
    expect(button.getAttribute("title")).toBe("컨텍스트 추가");
    expect(button.querySelector("[data-icon='notebook-tabs']")).not.toBeNull();
    expect(button.classList.contains("is-active")).toBe(false);
    expect(button.querySelector(".korean-dart-codex-context-button-badge")).toBeNull();

    renderContextButton(button, 3, iconRenderer);

    expect(button.classList.contains("is-active")).toBe(true);
    expect(button.querySelector(".korean-dart-codex-context-button-badge")?.textContent).toBe("3");

    renderContextButton(button, 0, iconRenderer, "turn");

    expect(button.classList.contains("is-active")).toBe(true);
    expect(button.getAttribute("aria-label")).toBe("컨텍스트 설정 변경");
    expect(button.getAttribute("title")).toContain("노트 컨텍스트 사용 안 함");
    expect(button.querySelector(".korean-dart-codex-context-button-badge")).toBeNull();
  });

  it("renders a removable no-note context chip with explicit scope and MCP boundary", () => {
    const parent = document.createElement("div");
    const remove = vi.fn();

    const chip = renderNoContextChip(parent, "turn", {
      setIcon: iconRenderer,
      onRemove: remove,
    });

    expect(chip.textContent).toContain("노트 컨텍스트 없음");
    expect(chip.textContent).toContain("이번 질문만");
    expect(chip.getAttribute("title")).toContain("Obsidian 노트를 읽거나 전달하지 않음");
    expect(chip.getAttribute("title")).toContain("korean-dart MCP");
    chip.querySelector<HTMLButtonElement>(".korean-dart-codex-context-chip-remove")?.click();
    expect(remove).toHaveBeenCalledOnce();
  });

  it("renders removable chips above the composer with scope, snapshot, stale, and truncation text", () => {
    const parent = document.createElement("div");
    const remove = vi.fn();
    const selected = [
      selectedNote("turn", {
        stale: true,
        truncated: true,
        currentModifiedAt: 20,
      }),
      selectedNote("session", {
        path: "Contracts/Agreement.md",
        title: "계약서",
        content: "agreement",
        contentHash: "sha256:agreement",
        modifiedAt: 30,
        stale: false,
        originalChars: 9,
        includedChars: 9,
        truncated: false,
      }),
    ];

    const row = renderContextChipRow(parent, selected, {
      setIcon: iconRenderer,
      onRemove: remove,
    });

    expect(row).not.toBeNull();
    expect(parent.firstElementChild).toBe(row);
    expect(row?.getAttribute("aria-label")).toBe("적용된 컨텍스트");
    const chips = row?.querySelectorAll(".korean-dart-codex-context-chip");
    expect(chips).toHaveLength(2);
    expect(chips?.[0].textContent).toContain("이번 질문만");
    expect(chips?.[0].textContent).toContain("잘림");
    expect(chips?.[0].textContent).toContain("변경됨");
    expect(chips?.[1].textContent).toContain("현재 대화");
    expect(chips?.[0].getAttribute("title")).toContain("Facts/사실관계.md");
    expect(chips?.[0].getAttribute("title")).toContain("예상 크기 약 1.2k자");
    expect(chips?.[0].getAttribute("title")).toContain("스냅샷");
    expect(chips?.[0].getAttribute("data-snapshot-created-at")).toBe("2026-07-26T03:00:00.000Z");

    row?.querySelector<HTMLButtonElement>(".korean-dart-codex-context-chip-remove")?.click();
    expect(remove).toHaveBeenCalledWith("Facts/사실관계.md", "turn");
  });

  it("does not render an empty chip row", () => {
    const parent = document.createElement("div");
    const row = renderContextChipRow(parent, [], {
      setIcon: iconRenderer,
      onRemove: vi.fn(),
    });

    expect(row).toBeNull();
    expect(parent.childElementCount).toBe(0);
  });

  it("builds a tooltip without including note contents", () => {
    const item = selectedNote("turn");
    const tooltip = buildContextChipTooltip(item);

    expect(tooltip).toContain("Facts/사실관계.md");
    expect(tooltip).toContain("이번 질문만");
    expect(tooltip).not.toContain(item.note.content);
  });

  it("removes one-turn chips after send, keeps session chips, and clears them on new conversation", async () => {
    const service = new DartContextService({
      read: async (path) => ({
        path,
        title: path.replace(/\.md$/, ""),
        content: path,
        modifiedAt: 1,
      }),
    });
    await service.setContext(["Session.md"], "session");
    await service.setContext(["Turn.md"], "turn");

    const beforeSend = document.createElement("div");
    renderContextChipRow(beforeSend, service.listSelected(), {
      setIcon: iconRenderer,
      onRemove: vi.fn(),
    });
    expect(beforeSend.textContent).toContain("Turn");
    expect(beforeSend.textContent).toContain("Session");

    service.prepareTurnContext();
    const afterSend = document.createElement("div");
    renderContextChipRow(afterSend, service.listSelected(), {
      setIcon: iconRenderer,
      onRemove: vi.fn(),
    });
    expect(afterSend.textContent).not.toContain("Turn");
    expect(afterSend.textContent).toContain("Session");

    service.clearAll();
    const afterNewConversation = document.createElement("div");
    expect(renderContextChipRow(afterNewConversation, service.listSelected(), {
      setIcon: iconRenderer,
      onRemove: vi.fn(),
    })).toBeNull();
  });
});

function iconRenderer(element: HTMLElement, icon: string): void {
  element.setAttribute("data-icon", icon);
}

function selectedNote(
  scope: SelectedContextNote["scope"],
  overrides: Partial<SelectedContextNote["note"]> = {},
): SelectedContextNote {
  return {
    scope,
    snapshotCreatedAt: "2026-07-26T03:00:00.000Z",
    note: {
      path: "Facts/사실관계.md",
      title: "사실관계",
      content: "private note contents",
      contentHash: "sha256:private",
      modifiedAt: 10,
      stale: false,
      originalChars: 1_200,
      includedChars: 1_200,
      truncated: false,
      ...overrides,
    },
  };
}
