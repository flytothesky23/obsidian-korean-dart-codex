import { describe, expect, it } from "vitest";
import {
  buildDataviewJsBlock,
  buildImagePromptPrompt,
  buildDartResearchPrompt,
  buildMermaidPrompt,
} from "../src/prompts";

describe("DART research prompt", () => {
  it("contains the MCP contract, active note context, history, and metadata schema", () => {
    const prompt = buildDartResearchPrompt({
      query: "삼성전자 최근 3년 주요 공시와 재무 리스크를 정리해줘",
      activeFilePath: "Companies/Samsung.md",
      selection: "반도체 설비투자 메모",
      activeNoteContent: "내부 관찰 기록",
      history: [
        { role: "user", text: "최근 사업보고서를 찾아줘" },
        { role: "assistant", text: "원문 공시를 먼저 확인하겠습니다." },
      ],
    });

    expect(prompt).toContain("Use the `korean-dart` MCP server first");
    expect(prompt).toContain("resolve_corp_code");
    expect(prompt).toContain("Discover the current tool inventory");
    expect(prompt).toContain("Do not execute shell commands, Python, Node, or local file commands");
    expect(prompt).toContain("include only completed `korean-dart` MCP calls");
    expect(prompt).toContain("not investment advice or a recommendation to trade");
    expect(prompt).toContain("Start every heading on its own line");
    expect(prompt).toContain("valid Markdown table");
    expect(prompt).toContain("Active note path: Companies/Samsung.md");
    expect(prompt).toContain("반도체 설비투자 메모");
    expect(prompt).toContain("Recent chat history:");
    expect(prompt).toContain("korean-dart-codex-meta");
    expect(prompt).toContain('"company_names": []');
    expect(prompt).toContain('"corp_codes": []');
    expect(prompt).toContain('"receipt_numbers": []');
    expect(prompt).toContain("삼성전자 최근 3년 주요 공시와 재무 리스크를 정리해줘");
  });

  it("keeps selected vault snapshots separate from official MCP sources", () => {
    const prompt = buildDartResearchPrompt({
      query: "이 내부 메모와 최신 공시를 비교해줘",
      activeFilePath: "Active.md",
      activeNoteContent: "자동 활성 노트",
      selection: "자동 선택 텍스트",
      vaultContext: {
        id: "ctx-123",
        createdAt: "2026-07-25T00:00:00.000Z",
        scope: "session",
        selectedCount: 1,
        notes: [{
          path: "Companies/acme.md",
          title: "ACME 내부 메모",
          content: "내부 재무 관찰 기록",
          contentHash: "sha256:abc",
          modifiedAt: 10,
          currentModifiedAt: 20,
          stale: true,
          originalChars: 12,
          includedChars: 12,
          truncated: false,
        }],
        totalChars: 12,
        truncated: false,
        omittedPaths: [],
      },
    });

    expect(prompt).toContain("<vault_context");
    expect(prompt).toContain('snapshot_id="ctx-123"');
    expect(prompt).toContain("내부 재무 관찰 기록");
    expect(prompt).toContain("user notes are not official disclosure sources");
    expect(prompt).toContain("verify critical claims through `korean-dart` MCP");
    expect(prompt).toContain("state conflicts and uncertainty");
    expect(prompt).toContain('active_note_context priority="secondary"');
    expect(prompt).toContain("explicit selection as primary");
  });

  it("supports disclosure research without vault context", () => {
    const prompt = buildDartResearchPrompt({
      query: "카카오 최근 정정공시를 조사해줘",
      activeFilePath: "Private/active.md",
      activeNoteContent: "전송되면 안 되는 내부 노트",
      selection: "전송되면 안 되는 선택 텍스트",
      includeActiveNoteContext: false,
    });

    expect(prompt).toContain("Vault note context: disabled by the user for this turn.");
    expect(prompt).toContain("카카오 최근 정정공시를 조사해줘");
    expect(prompt).not.toContain("Private/active.md");
    expect(prompt).not.toContain("전송되면 안 되는 내부 노트");
    expect(prompt).not.toContain("전송되면 안 되는 선택 텍스트");
    expect(prompt).not.toMatch(/<vault_context\s+snapshot_id=/);
  });
});

describe("utility prompts", () => {
  it("builds a Mermaid prompt constrained to the source answer", () => {
    const prompt = buildMermaidPrompt("삼성전자 접수번호 20260312000736과 핵심 재무지표");
    expect(prompt).toContain("Mermaid diagram");
    expect(prompt).toContain("Do not invent authorities");
    expect(prompt).toContain("20260312000736");
  });

  it("builds a DataviewJS dashboard block for saved DART notes", () => {
    const block = buildDataviewJsBlock("00_수집함/DART Research");
    expect(block).toContain('dv.pages(\'"00_수집함/DART Research"\')');
    expect(block).toContain("p.type === 'korean-dart-research'");
    expect(block).toContain("p.company_names");
    expect(block).toContain("p.corp_codes");
    expect(block).toContain("p.receipt_numbers");
  });

  it("builds a source-grounded image prompt request", () => {
    const prompt = buildImagePromptPrompt("삼성전자 최근 3년 공시와 재무지표");
    expect(prompt).toContain("Do not generate an image");
    expect(prompt).toContain("DART visual genre");
    expect(prompt).toContain("receipt numbers");
    expect(prompt).toContain("삼성전자 최근 3년 공시와 재무지표");
  });

  it("builds a filing-timeline deck prompt", () => {
    const prompt = buildImagePromptPrompt({
      lastAnswer: "카카오 최근 3년 자본 이벤트와 정정공시",
      mode: "filing-timeline",
      scope: "deck",
      slideCount: 4,
      userDirection: "교육용 카드뉴스처럼",
      sourceTitle: "카카오 공시 리서치",
    });
    expect(prompt).toContain("공시 타임라인");
    expect(prompt).toContain("Scope: deck");
    expect(prompt).toContain("Requested page count: 4");
    expect(prompt).toContain("storyboard");
  });
});
