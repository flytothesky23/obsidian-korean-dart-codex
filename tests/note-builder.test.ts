import { describe, expect, it } from "vitest";
import {
  buildResearchNote,
  buildResearchNotePath,
  parseDartMetadata,
  sanitizeFileName,
  stripMetadataBlock,
  uniqueVaultPath,
} from "../src/note-builder";

describe("parseDartMetadata", () => {
  it("parses the explicit korean-dart-codex metadata block", () => {
    const response = [
      "본문",
      "<!-- korean-dart-codex-meta",
      JSON.stringify({
        query: "삼성전자 사업보고서",
        company_names: ["삼성전자"],
        corp_codes: ["00126380"],
        receipt_numbers: ["20260312000736"],
        tools_used: ["korean-dart.search_disclosures"],
        generated_at: "2026-08-04T10:00:00.000Z",
        confidence: "high",
      }),
      "-->",
    ].join("\n");

    expect(parseDartMetadata(response, "fallback")).toEqual({
      query: "삼성전자 사업보고서",
      company_names: ["삼성전자"],
      corp_codes: ["00126380"],
      receipt_numbers: ["20260312000736"],
      tools_used: ["korean-dart.search_disclosures"],
      generated_at: "2026-08-04T10:00:00.000Z",
      confidence: "high",
    });
  });

  it("falls back to DART identifier heuristics", () => {
    const metadata = parseDartMetadata(
      "회사명: 삼성전자, corp_code: 00126380, 접수번호: 20260312000736을 korean-dart MCP로 확인했습니다.",
      "삼성전자",
      new Date("2026-08-04T01:02:03.000Z"),
    );
    expect(metadata.company_names).toEqual(["삼성전자"]);
    expect(metadata.corp_codes).toEqual(["00126380"]);
    expect(metadata.receipt_numbers).toEqual(["20260312000736"]);
    expect(metadata.tools_used).toEqual(["korean-dart"]);
  });
});

describe("research note building", () => {
  it("strips metadata blocks from the visible response", () => {
    const response = "요약 본문\n<!-- korean-dart-codex-meta\n{\"query\":\"삼성전자\"}\n-->";
    expect(stripMetadataBlock(response)).toBe("요약 본문");
  });

  it("creates DART frontmatter and body sections", () => {
    const note = buildResearchNote({
      query: "삼성전자 최근 사업보고서",
      response: [
        "삼성전자의 최근 사업보고서를 확인했습니다.",
        "<!-- korean-dart-codex-meta",
        JSON.stringify({
          query: "삼성전자 최근 사업보고서",
          company_names: ["삼성전자"],
          corp_codes: ["00126380"],
          receipt_numbers: ["20260312000736"],
          tools_used: ["korean-dart.search_disclosures"],
          generated_at: "2026-08-04T00:00:00.000Z",
          confidence: "high",
        }),
        "-->",
      ].join("\n"),
      outputFolder: "00_수집함/DART Research",
      createdAt: new Date("2026-08-04T09:10:11"),
    });

    expect(note).toContain("type: korean-dart-research");
    expect(note).toContain("source: korean-dart-mcp");
    expect(note).toContain("company_names:");
    expect(note).toContain('  - "삼성전자"');
    expect(note).toContain('  - "00126380"');
    expect(note).toContain('  - "20260312000736"');
    expect(note).toContain("# 관련 기업");
    expect(note).toContain("# 공시 식별자");
    expect(note).toContain("OpenDART 공시 리서치 기록");
    expect(note).not.toContain("korean-dart-codex-meta");
  });

  it("records context metadata without embedding source contents", () => {
    const note = buildResearchNote({
      query: "내부 메모와 공시 비교",
      response: "검토 결과입니다.",
      outputFolder: "DART Research",
      contextSnapshot: {
        id: "ctx-123",
        createdAt: "2026-07-25T00:00:00.000Z",
        scope: "mixed",
        selectedCount: 1,
        notes: [{
          path: "Companies/acme.md",
          title: "ACME",
          content: "private source text",
          contentHash: "sha256:aaa",
          modifiedAt: 1,
          stale: false,
          originalChars: 19,
          includedChars: 19,
          truncated: false,
        }],
        totalChars: 19,
        truncated: false,
        omittedPaths: [],
      },
    });
    expect(note).toContain('context_snapshot: "ctx-123"');
    expect(note).toContain('"Companies/acme.md#sha256:aaa"');
    expect(note).not.toContain("private source text");
  });

  it("builds a safe dated note path", () => {
    const path = buildResearchNotePath(
      "삼성전자 / 최근 3년: 공시?",
      "00_수집함/DART Research",
      new Date("2026-08-04T09:10:00"),
    );
    expect(path).toBe("00_수집함/DART Research/2026-08-04 0910 - 삼성전자 최근 3년 공시.md");
  });

  it("sanitizes invalid filename characters", () => {
    expect(sanitizeFileName('A/B:C*D?E"F<G>H|I#J^K[1]')).toBe("A B C D E F G H I J K 1");
  });

  it("allocates duplicate note names with numeric suffixes", async () => {
    const existing = new Set(["folder/note.md", "folder/note-2.md"]);
    await expect(uniqueVaultPath({ exists: async (path: string) => existing.has(path) } as never, "folder/note.md"))
      .resolves.toBe("folder/note-3.md");
  });
});
