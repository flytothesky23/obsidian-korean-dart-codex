import { describe, expect, it } from "vitest";
import {
  buildFallbackVisualPlan,
  buildNativeVisualPlanPrompt,
  buildNativeVisualSlidePrompt,
  buildVisualAssetFolder,
  buildVisualAssetPath,
  buildVisualCollectionNote,
  buildVisualCollectionNotePath,
  isPngData,
  parseDartVisualCollectionPlan,
} from "../src/visual-assets";

const SOURCE = [
  "## 핵심 분석",
  "회사명: 삼성전자의 최근 재무 흐름을 검토한다.",
  "",
  "## 관련 공시",
  "접수번호: 20260312000736 사업보고서를 확인한다.",
  "",
  "## 재무 지표",
  "매출, 영업이익, 부채비율의 기간별 변화를 비교한다.",
  "",
  "## 후속 확인",
  "사실관계와 손해액은 추가 확인이 필요하다.",
].join("\n");

describe("dart visual asset planning", () => {
  it("builds an app-server plan request before native image generation", () => {
    const prompt = buildNativeVisualPlanPrompt({
      lastAnswer: SOURCE,
      mode: "filing-timeline",
      scope: "deck",
      slideCount: 4,
      sourceTitle: "삼성전자 공시 리서치",
    });

    expect(prompt).toContain("Do not generate an image in this turn");
    expect(prompt).toContain("Return only JSON");
    expect(prompt).toContain("Page count: 4");
    expect(prompt).toContain("Never invent companies");
  });

  it("creates distinct source-grounded fallback pages for a deck", () => {
    const plan = buildFallbackVisualPlan({
      lastAnswer: SOURCE,
      mode: "filing-timeline",
      scope: "deck",
      slideCount: 4,
      sourceTitle: "삼성전자 공시 리서치",
    });

    expect(plan.pages).toHaveLength(4);
    expect(plan.analysis.filingRefs).toContain("20260312000736");
    expect(plan.analysis.companyRefs).toContain("삼성전자");
    expect(new Set(plan.pages.map((page) => page.sourceExcerpt)).size).toBeGreaterThan(1);
    expect(plan.pages[0].role).toBe("intro");
    expect(plan.pages.at(-1)?.role).toBe("conclusion");
  });

  it("uses a reference slide only for style continuity in the native image turn", () => {
    const plan = buildFallbackVisualPlan({ lastAnswer: SOURCE, mode: "disclosure-brief", scope: "single", sourceTitle: "삼성전자" });
    const prompt = buildNativeVisualSlidePrompt({
      mode: "disclosure-brief",
      scope: "single",
      sourceTitle: "삼성전자",
      plan,
      page: plan.pages[0],
      hasReferenceImage: true,
    });

    expect(prompt).toContain("native image generation capability now");
    expect(prompt).toContain("attached previous slide is a visual-style reference only");
    expect(prompt).toContain("fake citations");
  });

  it("normalizes a valid model plan without trusting excess pages", () => {
    const result = parseDartVisualCollectionPlan(JSON.stringify({
      seriesTitle: "검증된 시각자료",
      seriesBible: "quiet disclosure brief",
      analysis: { title: "검증", filingRefs: ["20260312000736"] },
      pages: [
        { role: "intro", title: "첫 페이지", sourceExcerpt: "삼성전자 사업보고서", requiredFacts: ["20260312000736"], labels: ["공시"] },
        { role: "rule", title: "둘째 페이지", sourceExcerpt: "재무지표", requiredFacts: ["영업이익"], labels: ["재무"] },
        { role: "risk", title: "초과 페이지" },
      ],
    }), {
      lastAnswer: SOURCE,
      mode: "disclosure-brief",
      scope: "deck",
      slideCount: 2,
      sourceTitle: "삼성전자",
    });

    expect(result.seriesTitle).toBe("검증된 시각자료");
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].index).toBe(1);
    expect(result.pages[1].index).toBe(2);
  });
});

describe("dart visual asset storage", () => {
  it("uses the existing media folder when configured and builds safe vault paths", () => {
    expect(buildVisualAssetFolder("00_수집함/DART Research", "attachments/codexian")).toBe("attachments/codexian");
    expect(buildVisualAssetPath("삼성전자 / 사업보고서", "attachments/codexian", 2, new Date("2026-08-04T10:20:00")))
      .toBe("attachments/codexian/2026-08-04 1020 - 삼성전자 사업보고서 - 02.png");
    expect(buildVisualCollectionNotePath("삼성전자 / 사업보고서", "00_수집함/DART Research", new Date("2026-08-04T10:20:00")))
      .toBe("00_수집함/DART Research/Visual Assets/2026-08-04 1020 - 삼성전자 사업보고서 - 시각자료.md");
  });

  it("writes a new collection note with embeds and recovery details without source-note mutation", () => {
    const plan = buildFallbackVisualPlan({ lastAnswer: SOURCE, mode: "disclosure-brief", scope: "single", sourceTitle: "삼성전자" });
    const note = buildVisualCollectionNote({
      sourceTitle: "삼성전자",
      sourceQuery: "삼성전자 최근 사업보고서",
      mode: "disclosure-brief",
      scope: "single",
      runtime: "codex-app-server",
      plan,
      assets: [{ index: 1, path: "attachments/codexian/disclosure-brief.png" }],
      failedPages: [{ index: 2, reason: "timeout" }],
      createdAt: new Date("2026-07-11T10:20:00"),
    });

    expect(note).toContain("type: korean-dart-visual-assets");
    expect(note).toContain("![[attachments/codexian/disclosure-brief.png]]");
    expect(note).toContain("원본 리서치 노트는 자동 수정하지 않았습니다.");
    expect(note).toContain("복구 필요");
  });

  it("validates PNG signatures before vault import", () => {
    expect(isPngData(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(isPngData(new Uint8Array([0x3c, 0x73, 0x76, 0x67]))).toBe(false);
  });
});
