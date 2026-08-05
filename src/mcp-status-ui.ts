import type { CodexMcpStatus } from "./codex-mcp-status";
import { KOREA_STOCK_ENABLED_TOOLS } from "./korea-stock-mcp-config";

export function renderMcpStatusButton(
  button: HTMLButtonElement,
  status: CodexMcpStatus,
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

export function mcpStatusLabel(status: CodexMcpStatus): string {
  if (status.state === "ready") return `MCP ${status.version}`;
  if (status.state === "missing" && status.authStatus === "missing") return "API 키 필요";
  if (status.state === "missing") return "MCP 없음";
  if (status.state === "failed" && status.authStatus === "rejected") return "API 승인 확인";
  if (status.state === "failed" && status.authStatus === "api-error") return "API 오류";
  if (status.state === "failed") return "MCP 오류";
  return "MCP 확인 중";
}

export function mcpStatusTooltip(status: CodexMcpStatus): string {
  const displayName = mcpDisplayName(status);
  if (status.state === "ready") {
    const toolDetail = isKoreaStockStatus(status)
      ? `${KOREA_STOCK_ENABLED_TOOLS.length}개 허용 도구 · 서버 전체 ${status.toolCount}개`
      : `${status.toolCount}개 도구`;
    return [
      `${displayName} MCP ${status.version} 연결됨`,
      status.authStatus === "verified" ? "공식 API 실조회 확인됨" : "API 키 존재 확인됨",
      toolDetail,
      status.source === "managed" ? "플러그인 자동 관리" : "Codex 등록 설정 사용",
    ].filter(Boolean).join(" · ");
  }
  if (status.state === "missing") return status.error || `Codex MCP 설정에서 ${mcpServerName(status)} 서버를 찾지 못했습니다.`;
  if (status.state === "failed") return status.error || `${displayName} MCP 연결을 확인해야 합니다.`;
  return `${displayName} MCP 연결 상태 확인 중`;
}

export function mcpWelcomeLabel(status: CodexMcpStatus): string {
  const displayName = mcpDisplayName(status);
  if (status.state === "ready") return `${displayName} MCP ${status.version} 연결됨`;
  if (status.state === "missing" && status.authStatus === "missing") return `${mcpAuthLabel(status)} 필요`;
  if (status.state === "missing") return `${displayName} MCP 설정 필요`;
  if (status.state === "failed" && status.authStatus === "api-error") return `${displayName} 공식 API 확인 필요`;
  if (status.state === "failed") return `${displayName} MCP 확인 필요`;
  return `${displayName} MCP 확인 중`;
}

function mcpDisplayName(status: CodexMcpStatus): string {
  if (isKoreaStockStatus(status)) return "KRX";
  return "korean-dart";
}

function mcpServerName(status: CodexMcpStatus): string {
  if (status.serverId) return status.serverId;
  return status.name || "korean-dart";
}

function mcpAuthLabel(status: CodexMcpStatus): string {
  if (isKoreaStockStatus(status)) return "KRX API 키";
  return "OpenDART API 키";
}

function isKoreaStockStatus(status: CodexMcpStatus): boolean {
  return status.serverId === "korea-stock" || status.name === "korea-stock" || status.name === "korea-stock-mcp";
}
