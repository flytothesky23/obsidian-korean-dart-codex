import { describe, expect, it } from "vitest";
import {
  extractCompletedAgentMessage,
  extractStreamingDelta,
  isMatchingTurnCompletion,
  resolveMcpElicitationRequest,
} from "../src/codex-appserver";

describe("app-server streaming contract", () => {
  it("preserves whitespace and Markdown boundaries in text deltas", () => {
    expect(extractStreamingDelta({ delta: "\n\n## 1. 핵심 결론\n" }))
      .toBe("\n\n## 1. 핵심 결론\n");
    expect(extractStreamingDelta({ delta: " 계약 해제 " }))
      .toBe(" 계약 해제 ");
  });

  it("uses the canonical item/completed agent message as final text", () => {
    expect(extractCompletedAgentMessage("item/completed", {
      item: {
        type: "agentMessage",
        id: "item-1",
        text: "## 결론\n\n1. 첫째\n2. 둘째",
      },
    })).toBe("## 결론\n\n1. 첫째\n2. 둘째");
    expect(extractCompletedAgentMessage("item/completed", {
      item: { type: "reasoning", text: "내부 추론" },
    })).toBe("");
  });

  it("finishes only the exact active turn on official turn/completed", () => {
    expect(isMatchingTurnCompletion("turn/completed", {
      turn: { id: "turn-1", status: "completed" },
    }, "turn-1")).toBe(true);
    expect(isMatchingTurnCompletion("turn/completed", {
      turn: { id: "turn-old", status: "completed" },
    }, "turn-1")).toBe(false);
    expect(isMatchingTurnCompletion("thread/status/changed", {
      thread: { status: "idle" },
    }, "turn-1")).toBe(false);
  });
});

describe("resolveMcpElicitationRequest", () => {
  it("accepts korean-dart MCP tool-call approval requests", () => {
    const decision = resolveMcpElicitationRequest({
      serverName: "korean-dart",
      mode: "form",
      _meta: {
        codex_approval_kind: "mcp_tool_call",
        tool_description: "[공시검색] 기업 공시 검색",
        tool_params: { corp: "삼성전자" },
      },
      message: "Allow the korean-dart MCP server to run tool \"search_disclosures\"?",
      requestedSchema: {
        type: "object",
        properties: {},
      },
    });

    expect(decision).toEqual({
      result: { action: "accept", content: {}, _meta: null },
      progress: "korean-dart/search_disclosures 실행 승인",
    });
  });

  it("does not auto-accept non-korean-dart elicitation requests", () => {
    const decision = resolveMcpElicitationRequest({
      serverName: "other-server",
      _meta: { codex_approval_kind: "mcp_tool_call" },
      requestedSchema: { type: "object", properties: {} },
    });

    expect(decision).toEqual({
      result: { action: "cancel", content: null, _meta: null },
      progress: "other-server MCP 추가 입력 요청 자동 취소",
    });
  });

  it.each(["get_stock_base_info", "get_stock_trade_info"])(
    "accepts the approved korea-stock KRX tool %s",
    (toolName) => {
      const decision = resolveMcpElicitationRequest({
        serverName: "korea-stock",
        _meta: { codex_approval_kind: "mcp_tool_call", tool_name: toolName },
        requestedSchema: { type: "object", properties: {} },
      });

      expect(decision).toEqual({
        result: { action: "accept", content: {}, _meta: null },
        progress: `korea-stock/${toolName} 실행 승인`,
      });
    },
  );

  it("rejects korea-stock duplicate DART tools", () => {
    const decision = resolveMcpElicitationRequest({
      serverName: "korea-stock",
      _meta: { codex_approval_kind: "mcp_tool_call", tool_name: "get_disclosure_list" },
      requestedSchema: { type: "object", properties: {} },
    });

    expect(decision.result).toEqual({ action: "cancel", content: null, _meta: null });
  });

  it("does not auto-answer korean-dart form requests that require fields", () => {
    const decision = resolveMcpElicitationRequest({
      serverName: "korean-dart",
      mode: "form",
      _meta: { codex_approval_kind: "mcp_tool_call" },
      requestedSchema: {
        type: "object",
        properties: {
          apiKey: { type: "string" },
        },
      },
    });

    expect(decision.result).toEqual({ action: "cancel", content: null, _meta: null });
  });
});
