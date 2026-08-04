import { describe, expect, it } from "vitest";
import {
  formatCodexActivity,
  shouldUpdateStatusFromCodexStderr,
  summarizeCodexStderr,
  summarizeFailureMessage,
} from "../src/status-format";

describe("Codex status formatting", () => {
  it("keeps auth transport errors out of the status headline", () => {
    const log = [
      "2026-07-02T01:29:38.405700Z ERROR rmcp::transport::worker:",
      "worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError {",
      'www_authenticate_header: "Bearer token-secret"',
    ].join(" ");

    expect(summarizeCodexStderr(log)).toBe("Codex 인증 상태 확인 필요");
    expect(summarizeFailureMessage(log)).toBe("Codex 인증 상태 확인 필요");
  });

  it("redacts bearer headers and truncates activity lines", () => {
    const activity = formatCodexActivity(
      'ERROR www_authenticate_header: "Bearer token-secret" with a very long diagnostic message '.repeat(8),
      100,
    );

    expect(activity).toContain('www_authenticate_header: "Bearer [redacted]"');
    expect(activity).not.toContain("token-secret");
    expect(activity.length).toBeLessThanOrEqual(100);
  });

  it("hides unrelated Codex runtime and third-party MCP auth noise", () => {
    const linearNoise = [
      "ERROR rmcp::transport::worker: worker quit with fatal:",
      'AuthRequired(AuthRequiredError { www_authenticate_header: "Bearer token-secret",',
      'resource_metadata="https://mcp.linear.app/.well-known/oauth-protected-resource/mcp" })',
    ].join(" ");
    const pluginNoise = "WARN codex_core_plugins::manifest: ignoring interface.defaultPrompt";

    expect(formatCodexActivity(linearNoise)).toBe("");
    expect(formatCodexActivity(pluginNoise)).toBe("");
    expect(shouldUpdateStatusFromCodexStderr(linearNoise)).toBe(false);
  });

  it("renders korean-dart MCP lifecycle logs as non-alarming activity", () => {
    expect(formatCodexActivity("mcp: korean-dart/search_disclosures started")).toBe("korean-dart/search_disclosures 호출 중");
    expect(formatCodexActivity("mcp: korean-dart/search_disclosures (completed)")).toBe("korean-dart/search_disclosures 완료");
    expect(formatCodexActivity("mcp: korean-dart/search_disclosures (failed)")).toBe(
      "korean-dart/search_disclosures 응답 없음 - 다른 조회 경로 확인 중",
    );
  });

  it("summarizes desktop runtime setup failures with actionable messages", () => {
    const windowsNode = '"node"은(는) 내부 또는 외부 명령, 실행할 수 있는 프로그램, 또는 배치 파일이 아닙니다.';
    const dartAuth = "사용자 정보 검증 실패: DART_API_KEY is missing";

    expect(summarizeCodexStderr(windowsNode)).toBe("Node.js 경로 확인 필요");
    expect(summarizeFailureMessage(windowsNode)).toContain("Node.js 경로를 찾지 못했습니다");
    expect(summarizeCodexStderr(dartAuth)).toBe("OpenDART API 키(DART_API_KEY) 확인 필요");
    expect(summarizeFailureMessage("spawn EINVAL")).toContain("Windows Codex 실행 파일");
  });

  it("recognizes the Korean OpenDART credential error without an API-key label", () => {
    const dartAuth = "사용자 정보 검증 실패: 등록되지 않은 인증키입니다.";

    expect(summarizeCodexStderr(dartAuth)).toBe("OpenDART API 키(DART_API_KEY) 확인 필요");
    expect(summarizeFailureMessage(dartAuth)).toBe("OpenDART API 키(DART_API_KEY)가 필요합니다.");
  });
});
