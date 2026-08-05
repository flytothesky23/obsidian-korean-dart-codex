import type { ResearchMode } from "./research-mode";

export function renderResearchModeTabs(
  parent: HTMLElement,
  activeMode: ResearchMode,
  disabled: boolean,
  onSelect: (mode: ResearchMode) => void,
): HTMLElement {
  const group = document.createElement("div");
  group.className = "korean-dart-codex-source-tabs";
  group.setAttribute("role", "tablist");
  group.setAttribute("aria-label", "리서치 데이터 소스");
  parent.append(group);

  for (const [mode, label] of [["dart", "DART"], ["krx", "KRX"]] as const) {
    const button = document.createElement("button");
    button.className = `korean-dart-codex-source-tab${activeMode === mode ? " is-active" : ""}`;
    button.textContent = label;
    button.type = "button";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(activeMode === mode));
    button.tabIndex = activeMode === mode ? 0 : -1;
    button.title = mode === "dart" ? "OpenDART 공시 리서치 우선" : "KRX 일별 시세 리서치 우선";
    button.disabled = disabled;
    button.addEventListener("click", () => {
      if (!disabled && mode !== activeMode) onSelect(mode);
    });
    group.append(button);
  }

  return group;
}
