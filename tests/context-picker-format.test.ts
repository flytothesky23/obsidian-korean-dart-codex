import { describe, expect, it } from "vitest";
import {
  formatApplyLabel,
  formatContextFooterSummary,
  formatIndexStatusText,
} from "../src/context-picker-format";

describe("context picker visible copy", () => {
  it("shows live Markdown index readiness and progress", () => {
    expect(formatIndexStatusText({
      phase: "ready",
      indexedCount: 72,
      totalCount: 72,
      updatedAt: 1,
      failureCount: 0,
    })).toBe("Markdown 72개 인덱싱됨 · 최신");

    expect(formatIndexStatusText({
      phase: "indexing",
      indexedCount: 12,
      totalCount: 72,
      updatedAt: 0,
      failureCount: 0,
    })).toBe("인덱싱 중 12/72");

    expect(formatIndexStatusText({
      phase: "idle",
      indexedCount: 0,
      totalCount: 0,
      updatedAt: 0,
      failureCount: 0,
    })).toBe("Markdown 색인 대기 · 노트 선택 시 시작");
  });

  it("summarizes selected count, estimate, budget, and scope", () => {
    expect(formatContextFooterSummary(1, 6600, 32000, "turn"))
      .toBe("1개 선택 · 약 6.6k자 / 전체 예산 32k자 · 이번 질문만");
    expect(formatContextFooterSummary(3, 21000, 32000, "session"))
      .toBe("3개 선택 · 약 21k자 / 전체 예산 32k자 · 현재 대화");
  });

  it("uses count-specific apply labels", () => {
    expect(formatApplyLabel(0)).toBe("컨텍스트 없이 진행");
    expect(formatApplyLabel(1)).toBe("1개 노트 적용");
    expect(formatApplyLabel(4)).toBe("4개 노트 적용");
  });
});
