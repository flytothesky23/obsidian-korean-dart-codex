import type { DataAdapter } from "obsidian";
import type { ContextSnapshot } from "./dart-context";

export interface DartResearchMetadata {
  query: string;
  company_names: string[];
  corp_codes: string[];
  receipt_numbers: string[];
  tools_used: string[];
  generated_at: string;
  confidence: "low" | "medium" | "high";
}

export interface SavedNoteInput {
  query: string;
  response: string;
  outputFolder: string;
  createdAt?: Date;
  contextSnapshot?: ContextSnapshot | null;
}

export const DEFAULT_TAGS = ["dart", "opendart", "corporate-disclosure", "codex", "mcp"];

export function parseDartMetadata(response: string, query: string, now = new Date()): DartResearchMetadata {
  const match = response.match(/<!--\s*korean-dart-codex-meta\s*([\s\S]*?)\s*-->/);
  if (match) {
    try {
      const parsed = JSON.parse(match[1]) as Partial<DartResearchMetadata>;
      return {
        query: stringValue(parsed.query) || query,
        company_names: stringArray(parsed.company_names),
        corp_codes: stringArray(parsed.corp_codes),
        receipt_numbers: stringArray(parsed.receipt_numbers),
        tools_used: stringArray(parsed.tools_used),
        generated_at: stringValue(parsed.generated_at) || now.toISOString(),
        confidence: normalizeConfidence(parsed.confidence),
      };
    } catch {
      // Fall through to heuristic metadata.
    }
  }

  return {
    query,
    company_names: inferCompanyNames(response),
    corp_codes: inferCorpCodes(response),
    receipt_numbers: inferReceiptNumbers(response),
    tools_used: response.includes("korean-dart") ? ["korean-dart"] : [],
    generated_at: now.toISOString(),
    confidence: "medium",
  };
}

export function stripMetadataBlock(response: string): string {
  return response.replace(/<!--\s*korean-dart-codex-meta\s*[\s\S]*?\s*-->/g, "").trim();
}

export function buildResearchNote(input: SavedNoteInput): string {
  const createdAt = input.createdAt ?? new Date();
  const metadata = parseDartMetadata(input.response, input.query, createdAt);
  const cleanedResponse = stripMetadataBlock(input.response);
  const summary = firstUsefulParagraph(cleanedResponse);
  const contextFrontmatter = input.contextSnapshot
    ? [
      yamlArray("context_notes", input.contextSnapshot.notes.map((note) => note.path)),
      `context_snapshot: ${yamlString(input.contextSnapshot.id)}`,
      `context_scope: ${yamlString(input.contextSnapshot.scope)}`,
      `context_truncated: ${input.contextSnapshot.truncated}`,
      `context_stale: ${input.contextSnapshot.notes.some((note) => note.stale)}`,
      yamlArray(
        "context_hashes",
        input.contextSnapshot.notes.map((note) => `${note.path}#${note.contentHash}`),
      ),
    ]
    : [];

  return [
    "---",
    `type: korean-dart-research`,
    `query: ${yamlString(metadata.query)}`,
    `created: ${yamlString(formatIsoLocal(createdAt))}`,
    `source: korean-dart-mcp`,
    ...contextFrontmatter,
    yamlArray("company_names", metadata.company_names),
    yamlArray("corp_codes", metadata.corp_codes),
    yamlArray("receipt_numbers", metadata.receipt_numbers),
    yamlArray("tools_used", metadata.tools_used),
    `confidence: ${yamlString(metadata.confidence)}`,
    yamlArray("tags", DEFAULT_TAGS),
    "---",
    "",
    "# 질문",
    "",
    input.query.trim(),
    "",
    "# 요약",
    "",
    summary || "_요약은 원문 응답을 참고하세요._",
    "",
    "# 관련 기업",
    "",
    metadata.company_names.length ? metadata.company_names.map((item) => `- ${item}`).join("\n") : "- _원문 응답 참고_",
    "",
    "# 공시 식별자",
    "",
    metadata.receipt_numbers.length
      ? metadata.receipt_numbers.map((item) => `- 접수번호 ${item}`).join("\n")
      : "- _원문 응답 참고_",
    "",
    "# 검토 포인트",
    "",
    "- 이 노트는 Codex와 korean-dart MCP로 생성한 OpenDART 공시 리서치 기록입니다.",
    "- 투자 판단 전에는 원문 공시, 정정공시, 기준 기간, 단위와 연결·별도 재무제표 구분을 재확인하세요.",
    "",
    "# 원문 응답",
    "",
    cleanedResponse || "_응답 본문이 비어 있습니다._",
    "",
    "# 후속 질문",
    "",
    "- 기간별 핵심 재무지표를 표로 비교해줘.",
    "- 정정공시와 주요 지분 변동을 다시 확인해줘.",
    "- 기업·주주·자본 이벤트를 Mermaid 관계도로 정리해줘.",
    "",
  ].join("\n");
}

export function buildResearchNotePath(query: string, outputFolder: string, now = new Date()): string {
  const prefix = formatTimestamp(now);
  const title = sanitizeFileName(query).slice(0, 70) || "DART 리서치";
  return normalizeVaultPath(`${outputFolder}/${prefix} - ${title}.md`);
}

export async function uniqueVaultPath(adapter: DataAdapter, path: string): Promise<string> {
  const normalized = normalizeVaultPath(path);
  if (!await adapter.exists(normalized)) return normalized;
  const match = normalized.match(/^(.*?)(\.md)$/);
  const base = match?.[1] ?? normalized;
  const ext = match?.[2] ?? "";
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}${ext}`;
    if (!await adapter.exists(candidate)) return candidate;
  }
  throw new Error(`Could not allocate a unique note path for ${path}`);
}

export function sanitizeFileName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|#^\[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeVaultPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\//, "");
}

function inferCompanyNames(response: string): string[] {
  return uniqueMatches(
    response,
    /(?:회사명|기업명|법인명|종목명)\s*[:：]\s*([가-힣A-Za-z0-9&().ㆍ·_-]{2,40})/g,
  ).slice(0, 20);
}

function inferCorpCodes(response: string): string[] {
  return uniqueMatches(response, /(?:corp_code|고유번호)\s*[:=：]?\s*([0-9]{8})\b/gi).slice(0, 30);
}

function inferReceiptNumbers(response: string): string[] {
  return uniqueMatches(response, /(?:rcept_no|rcpNo|접수번호)\s*[:=：]?\s*([0-9]{14})\b/gi).slice(0, 30);
}

function uniqueMatches(value: string, regex: RegExp): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const match of value.matchAll(regex)) {
    const candidate = (match[1] ?? "").trim();
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    output.push(candidate);
  }
  return output;
}

function firstUsefulParagraph(value: string): string {
  const paragraphs = value
    .split(/\n{2,}/)
    .map((part) => part.replace(/^#+\s+/gm, "").trim())
    .filter((part) => part && !part.startsWith("```"));
  return (paragraphs[0] ?? "").slice(0, 900);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeConfidence(value: unknown): "low" | "medium" | "high" {
  return value === "low" || value === "medium" || value === "high" ? value : "medium";
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function yamlArray(key: string, values: string[]): string {
  if (values.length === 0) return `${key}: []`;
  return [
    `${key}:`,
    ...values.map((value) => `  - ${yamlString(value)}`),
  ].join("\n");
}

function formatTimestamp(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}${min}`;
}

function formatIsoLocal(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const sec = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${sec}`;
}
