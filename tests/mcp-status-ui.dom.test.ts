// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import type { KoreanDartMcpStatus } from "../src/codex-mcp-status";
import { renderMcpStatusButton } from "../src/mcp-status-ui";

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
    expect(button.getAttribute("aria-label")).toContain("10개 공개 도구");
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
