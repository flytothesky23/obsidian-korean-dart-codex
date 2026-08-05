// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import type { KoreanDartMcpStatus } from "../src/codex-mcp-status";
import { mcpWelcomeLabel, renderMcpStatusButton } from "../src/mcp-status-ui";

describe("Korean DART MCP status control", () => {
  it("renders the real version, tool count, accessible refresh hint, and ready icon", () => {
    const button = document.createElement("button");
    renderMcpStatusButton(button, status({
      state: "ready",
      version: "4.9.2",
      toolCount: 10,
      authStatus: "configured",
    }), iconRenderer);

    expect(button.textContent).toBe("MCP 4.9.2");
    expect(button.classList.contains("is-ready")).toBe(true);
    expect(button.querySelector("[data-icon='plug-zap']")).not.toBeNull();
    expect(button.getAttribute("aria-label")).toContain("10개 도구");
    expect(button.getAttribute("aria-label")).toContain("클릭하여 다시 확인");
  });

  it("uses text and an icon rather than color alone for checking and failure", () => {
    const button = document.createElement("button");
    renderMcpStatusButton(button, status({ state: "checking" }), iconRenderer);
    expect(button.textContent).toBe("MCP 확인 중");
    expect(button.querySelector("[data-icon='loader-circle']")).not.toBeNull();

    renderMcpStatusButton(button, status({ state: "failed", error: "연결 실패" }), iconRenderer);
    expect(button.textContent).toBe("MCP 오류");
    expect(button.querySelector("[data-icon='unplug']")).not.toBeNull();
    expect(button.getAttribute("title")).toContain("연결 실패");
  });

  it("distinguishes a missing OpenDART key from a missing MCP server", () => {
    const button = document.createElement("button");
    renderMcpStatusButton(button, status({
      state: "missing",
      authStatus: "missing",
      source: "managed",
      error: "OpenDART API 키가 설정되지 않았습니다.",
    }), iconRenderer);

    expect(button.textContent).toBe("API 키 필요");
    expect(button.getAttribute("title")).toContain("OpenDART API 키");
  });

  it("renders KRX labels and tooltips for korea-stock status", () => {
    const button = document.createElement("button");
    const krxStatus = status({
      state: "ready",
      name: "korea-stock-mcp",
      version: "1.4.1",
      toolCount: 2,
      authStatus: "configured",
      serverId: "korea-stock",
    });

    renderMcpStatusButton(button, krxStatus, iconRenderer);

    expect(button.textContent).toBe("MCP 1.4.1");
    expect(button.getAttribute("aria-label")).toContain("KRX MCP 1.4.1 연결됨");
    expect(button.getAttribute("aria-label")).toContain("2개 허용 도구");
    expect(button.getAttribute("aria-label")).toContain("서버 전체 2개");
    expect(mcpWelcomeLabel(krxStatus)).toBe("KRX MCP 1.4.1 연결됨");
  });

  it("renders a KRX missing-key welcome label", () => {
    expect(mcpWelcomeLabel(status({
      state: "missing",
      authStatus: "missing",
      serverId: "korea-stock",
      error: "KRX API 키가 설정되지 않았습니다.",
    }))).toBe("KRX API 키 필요");
  });

  it("does not render a green-ready badge when KRX rejects a live API probe", () => {
    const button = document.createElement("button");
    renderMcpStatusButton(button, status({
      state: "failed",
      authStatus: "rejected",
      serverId: "korea-stock",
      error: "KRX API 실조회가 거부되었습니다.",
    }), iconRenderer);

    expect(button.textContent).toBe("API 승인 확인");
    expect(button.classList.contains("is-ready")).toBe(false);
    expect(button.classList.contains("is-failed")).toBe(true);
    expect(button.getAttribute("title")).toContain("KRX API 실조회");
  });

  it("separates a temporary official API failure from an MCP startup failure", () => {
    const button = document.createElement("button");
    const apiFailure = status({
      state: "failed",
      authStatus: "api-error",
      serverId: "korea-stock",
      error: "KRX API 키는 설정되어 있지만 공식 API 실조회에 실패했습니다.",
    });

    renderMcpStatusButton(button, apiFailure, iconRenderer);

    expect(button.textContent).toBe("API 오류");
    expect(button.classList.contains("is-ready")).toBe(false);
    expect(button.classList.contains("is-failed")).toBe(true);
    expect(mcpWelcomeLabel(apiFailure)).toBe("KRX 공식 API 확인 필요");
  });
});

function status(overrides: Partial<KoreanDartMcpStatus>): KoreanDartMcpStatus {
  return {
    state: "checking",
    name: "korean-dart",
    version: "",
    toolCount: 0,
    authStatus: "",
    checkedAt: 0,
    error: "",
    ...overrides,
  };
}

function iconRenderer(element: HTMLElement, icon: string): void {
  element.dataset.icon = icon;
}
