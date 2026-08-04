import type { SelectedContextNote } from "./dart-context";

export type ContextIconRenderer = (element: HTMLElement, icon: string) => void;

export interface ContextChipRenderOptions {
  disabled?: boolean;
  onRemove: (path: string, scope: SelectedContextNote["scope"]) => void;
  setIcon: ContextIconRenderer;
}

export interface NoContextChipRenderOptions {
  disabled?: boolean;
  onRemove: () => void;
  setIcon: ContextIconRenderer;
}

export function renderContextButton(
  button: HTMLButtonElement,
  selectedCount: number,
  setIcon: ContextIconRenderer,
  noContextScope: SelectedContextNote["scope"] | null = null,
): void {
  button.replaceChildren();
  const active = selectedCount > 0 || noContextScope !== null;
  button.classList.toggle("is-active", active);
  button.setAttribute("aria-label", active ? "컨텍스트 설정 변경" : "컨텍스트 추가");
  button.setAttribute("title", noContextScope
    ? `노트 컨텍스트 사용 안 함 · ${noContextScope === "turn" ? "이번 질문만" : "현재 대화"}`
    : "컨텍스트 추가");

  const icon = document.createElement("span");
  icon.className = "korean-dart-codex-context-button-icon";
  setIcon(icon, "notebook-tabs");
  button.append(icon);

  if (selectedCount > 0) {
    const badge = document.createElement("span");
    badge.className = "korean-dart-codex-context-button-badge";
    badge.textContent = String(selectedCount);
    badge.setAttribute("aria-hidden", "true");
    button.append(badge);
  }
}

export function renderNoContextChip(
  parent: HTMLElement,
  scope: SelectedContextNote["scope"],
  options: NoContextChipRenderOptions,
): HTMLElement {
  let wrap = parent.querySelector<HTMLElement>(":scope > .korean-dart-codex-context-chips");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "korean-dart-codex-context-chips";
    wrap.setAttribute("aria-label", "적용된 컨텍스트");
    parent.append(wrap);
  }

  const chip = document.createElement("div");
  chip.className = "korean-dart-codex-context-chip is-none";
  chip.setAttribute("title", [
    "Obsidian 노트를 읽거나 전달하지 않음",
    scope === "turn" ? "이번 질문만" : "현재 대화",
    "공식 공시·재무 자료는 korean-dart MCP로 조회",
  ].join(" · "));

  const icon = document.createElement("span");
  icon.className = "korean-dart-codex-context-chip-icon";
  options.setIcon(icon, "book-x");

  const label = document.createElement("span");
  label.className = "korean-dart-codex-context-chip-label";
  label.textContent = "노트 컨텍스트 없음";

  const scopeLabel = document.createElement("span");
  scopeLabel.className = "korean-dart-codex-context-chip-scope";
  scopeLabel.textContent = scope === "turn" ? "이번 질문만" : "현재 대화";

  const remove = document.createElement("button");
  remove.className = "korean-dart-codex-context-chip-remove";
  remove.type = "button";
  remove.disabled = options.disabled ?? false;
  remove.setAttribute("aria-label", "노트 컨텍스트 없음 설정 제거");
  remove.setAttribute("title", "자동 활성 노트 컨텍스트 다시 사용");
  options.setIcon(remove, "x");
  remove.addEventListener("click", options.onRemove);

  chip.append(icon, label, scopeLabel, remove);
  wrap.append(chip);
  return chip;
}

export function renderContextChipRow(
  parent: HTMLElement,
  selected: SelectedContextNote[],
  options: ContextChipRenderOptions,
): HTMLElement | null {
  if (!selected.length) return null;

  const wrap = document.createElement("div");
  wrap.className = "korean-dart-codex-context-chips";
  wrap.setAttribute("aria-label", "적용된 컨텍스트");

  for (const item of selected) {
    const { scope, note, snapshotCreatedAt } = item;
    const chip = document.createElement("div");
    chip.className = [
      "korean-dart-codex-context-chip",
      note.stale ? "is-stale" : "",
      note.truncated ? "is-truncated" : "",
    ].filter(Boolean).join(" ");
    chip.setAttribute("title", buildContextChipTooltip(item));

    const noteIcon = document.createElement("span");
    noteIcon.className = "korean-dart-codex-context-chip-icon";
    options.setIcon(noteIcon, "file-text");
    chip.append(noteIcon);

    const label = document.createElement("span");
    label.className = "korean-dart-codex-context-chip-label";
    label.textContent = note.title;
    chip.append(label);

    const scopeLabel = document.createElement("span");
    scopeLabel.className = "korean-dart-codex-context-chip-scope";
    scopeLabel.textContent = scope === "turn" ? "이번 질문만" : "현재 대화";
    chip.append(scopeLabel);

    const size = document.createElement("span");
    size.className = "korean-dart-codex-context-chip-size";
    size.textContent = formatContextChars(note.includedChars);
    chip.append(size);

    if (note.truncated) {
      chip.append(createState("scissors", "잘림", options.setIcon));
    }
    if (note.stale) {
      chip.append(createState("history", "변경됨", options.setIcon));
    }

    const remove = document.createElement("button");
    remove.className = "korean-dart-codex-context-chip-remove";
    remove.type = "button";
    remove.disabled = options.disabled ?? false;
    remove.setAttribute("aria-label", `${note.title} 컨텍스트 제거`);
    remove.setAttribute("title", "컨텍스트 제거");
    options.setIcon(remove, "x");
    remove.addEventListener("click", () => {
      options.onRemove(note.path, scope);
    });
    chip.append(remove);
    wrap.append(chip);

    // Keep the timestamp in the rendered DOM contract for deterministic UI tests
    // without exposing note contents.
    chip.dataset.snapshotCreatedAt = snapshotCreatedAt;
  }

  parent.append(wrap);
  return wrap;
}

export function buildContextChipTooltip(item: SelectedContextNote): string {
  const { note, scope, snapshotCreatedAt } = item;
  return [
    note.path,
    scope === "turn" ? "이번 질문만" : "현재 대화",
    `예상 크기 약 ${formatContextChars(note.includedChars)}`,
    `스냅샷 ${formatSnapshotTime(snapshotCreatedAt)}`,
    note.truncated ? "잘림" : "",
    note.stale ? "변경됨 · 고정 스냅샷 사용" : "",
  ].filter(Boolean).join(" · ");
}

export function formatContextChars(value: number): string {
  if (value < 1_000) return `${value}자`;
  return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k자`;
}

function createState(
  iconName: string,
  label: string,
  setIcon: ContextIconRenderer,
): HTMLSpanElement {
  const state = document.createElement("span");
  state.className = "korean-dart-codex-context-chip-state";
  const icon = document.createElement("span");
  icon.className = "korean-dart-codex-context-chip-state-icon";
  setIcon(icon, iconName);
  state.append(icon, document.createTextNode(label));
  return state;
}

function formatSnapshotTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
