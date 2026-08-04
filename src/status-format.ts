const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

export function summarizeCodexStderr(text: string): string {
  const stripped = stripAnsi(text);
  if (!stripped) return "Codex 실행 중";
  if (isNodeMissing(stripped)) {
    return "Node.js 경로 확인 필요";
  }
  if (isDartApiKeyMissing(stripped)) {
    return "OpenDART API 키(DART_API_KEY) 확인 필요";
  }
  if (/\bspawn\s+EINVAL\b/i.test(stripped)) {
    return "Windows Codex 실행 경로 확인 필요";
  }
  if (/\b(AuthRequired|www_authenticate_header|unauthorized|401|login|oauth)\b/i.test(stripped)) {
    return "Codex 인증 상태 확인 필요";
  }
  if (/\b(rmcp::transport|MCP|transport channel closed|tool call)\b/i.test(stripped)) {
    return "MCP 연결 로그 수신 중";
  }
  if (/\b(ERROR|failed|fatal|panic|exception)\b/i.test(stripped)) {
    return "Codex 오류 로그 수신 중";
  }
  return "Codex 실행 중";
}

export function summarizeFailureMessage(text: string): string {
  const stripped = stripAnsi(text);
  if (!stripped) return "실패";
  if (isNodeMissing(stripped)) {
    return "Node.js 경로를 찾지 못했습니다. Codex CLI path와 Node 설치를 확인하세요.";
  }
  if (isDartApiKeyMissing(stripped)) {
    return "OpenDART API 키(DART_API_KEY)가 필요합니다.";
  }
  if (/\bspawn\s+EINVAL\b/i.test(stripped)) {
    return "Windows Codex 실행 파일(.cmd/.bat/.ps1) 실행 경로를 확인하세요.";
  }
  if (/\b(AuthRequired|www_authenticate_header|unauthorized|401|login|oauth)\b/i.test(stripped)) {
    return "Codex 인증 상태 확인 필요";
  }
  if (/\b(rmcp::transport|MCP|transport channel closed|tool call)\b/i.test(stripped)) {
    return "MCP 연결 실패";
  }
  return truncateForStatus(stripped, 80);
}

export function formatCodexActivity(text: string, maxLength = 160): string {
  const stripped = redactSensitiveLog(stripAnsi(text)).replace(/\s+/g, " ").trim();
  if (!stripped) return "";
  if (isNoisyCodexLog(stripped)) return "";
  const koreanDartActivity = formatKoreanDartMcpActivity(stripped);
  if (koreanDartActivity) return truncateForStatus(koreanDartActivity, maxLength);
  return truncateForStatus(stripped, maxLength);
}

export function shouldUpdateStatusFromCodexStderr(text: string): boolean {
  const stripped = redactSensitiveLog(stripAnsi(text)).replace(/\s+/g, " ").trim();
  return Boolean(stripped) && !isNoisyCodexLog(stripped);
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "").trim();
}

function redactSensitiveLog(text: string): string {
  return text
    .replace(/(www_authenticate_header:\s*")Bearer[^"]*(")/gi, '$1Bearer [redacted]$2')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/g, "Bearer [redacted]");
}

function isNodeMissing(text: string): boolean {
  return /"?node"?\s+is not recognized/i.test(text) || /"?node"?은\(는\).*내부 또는 외부 명령/i.test(text);
}

function isDartApiKeyMissing(text: string): boolean {
  return /\bDART_API_KEY\b|OpenDART\s*(?:key|키|인증)|API\s*키|사용자\s*정보\s*검증\s*실패/i.test(text);
}

function formatKoreanDartMcpActivity(text: string): string {
  const match = text.match(/\bmcp:\s*korean-dart\/([A-Za-z0-9_-]+)\s*(?:(?:\((started|completed|failed)\))|(started|completed|failed))?/i);
  if (!match) return "";
  const tool = match[1];
  const state = (match[2] || match[3])?.toLowerCase();
  if (state === "started") return `korean-dart/${tool} 호출 중`;
  if (state === "completed") return `korean-dart/${tool} 완료`;
  if (state === "failed") return `korean-dart/${tool} 응답 없음 - 다른 조회 경로 확인 중`;
  return `korean-dart/${tool} 로그 수신`;
}

function isNoisyCodexLog(text: string): boolean {
  return [
    /codex_core_plugins::manifest: ignoring interface\./i,
    /codex_core_skills::loader: ignoring interface\./i,
    /codex_core::goals: failed to (read|pause)/i,
    /Failed to terminate MCP process group/i,
    /failed to initialize MCP client during shutdown/i,
    /mcp\.linear\.app/i,
    /mcp\.notion\.com/i,
    /Environment variable GITHUB_PAT_TOKEN for MCP server 'github' is not set/i,
  ].some((pattern) => pattern.test(text));
}

function truncateForStatus(text: string, maxLength: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxLength) return oneLine;
  return `${oneLine.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
