import type { KoreanDartMcpStatus } from "./codex-mcp-status";

export function renderMcpStatusButton(
  button: HTMLButtonElement,
  status: KoreanDartMcpStatus,
  setIcon: (element: HTMLElement, icon: string) => void,
): void {
  button.classList.remove("is-checking", "is-ready", "is-missing", "is-failed");
  button.classList.add(`is-${status.state}`);
  button.replaceChildren();
  const detail = mcpStatusTooltip(status);
  button.setAttribute("aria-label", `${detail} · 클릭하여 다시 확인`);
  button.setAttribute("title", `${detail} · 클릭하여 다시 확인`);
  const icon = document.createElement("span");
  icon.className = "korean-dart-codex-mcp-status-icon";
  setIcon(icon, status.state === "ready" ? "plug-zap" : status.state === "checking" ? "loader-circle" : "unplug");
  const label = document.createElement("span");
  label.className = "korean-dart-codex-mcp-status-label";
  label.textContent = mcpStatusLabel(status);
  button.append(icon, label);
}

export function mcpStatusLabel(status: KoreanDartMcpStatus): string {
  if (status.state === "ready") return `MCP ${status.version}`;
  if (status.state === "missing" && status.authStatus === "missing") return "API 키 필요";
  if (status.state === "missing") return "MCP 없음";
  if (status.state === "failed") return "MCP 오류";
  return "MCP 확인 중";
}

export function mcpStatusTooltip(status: KoreanDartMcpStatus): string {
  if (status.state === "ready") {
    return [
      `korean-dart MCP ${status.version} 연결됨`,
      `${status.toolCount}개 공개 도구`,
      status.source === "managed" ? "플러그인 자동 관리" : "Codex 등록 설정 사용",
    ].filter(Boolean).join(" · ");
  }
  if (status.state === "missing") return status.error || "Codex MCP 설정에서 korean-dart 서버를 찾지 못했습니다.";
  if (status.state === "failed") return status.error || "korean-dart MCP 연결을 확인해야 합니다.";
  return "korean-dart MCP 연결 상태 확인 중";
}

export function mcpWelcomeLabel(status: KoreanDartMcpStatus): string {
  if (status.state === "ready") return `korean-dart MCP ${status.version} 연결됨`;
  if (status.state === "missing" && status.authStatus === "missing") return "OpenDART API 키 필요";
  if (status.state === "missing") return "korean-dart MCP 설정 필요";
  if (status.state === "failed") return "korean-dart MCP 확인 필요";
  return "korean-dart MCP 확인 중";
}
