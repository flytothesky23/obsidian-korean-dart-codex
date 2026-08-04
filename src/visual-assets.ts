import { readFile } from "fs/promises";
import { normalizeVaultPath, sanitizeFileName } from "./note-builder";
import type { DartVisualMode, DartVisualPromptOptions, DartVisualScope } from "./prompts";

type JsonObject = Record<string, unknown>;

export interface DartVisualNoteAnalysis {
  title: string;
  domain: string;
  sourceSummary: string;
  coreMessages: string[];
  filingRefs: string[];
  companyRefs: string[];
  analysisIssues: string[];
  requirements: string[];
  riskSignals: string[];
  nextActions: string[];
  includedHeadings: string[];
  excludedHeadings: string[];
}

export type DartVisualPageRole = "intro" | "issue" | "rule" | "application" | "evidence" | "risk" | "conclusion";

export interface DartVisualCollectionPage {
  index: number;
  role: DartVisualPageRole;
  title: string;
  focus: string;
  message: string;
  sourceHeading: string;
  sourceExcerpt: string;
  requiredFacts: string[];
  labels: string[];
  visualization: string;
  avoid: string[];
  layoutHint: string;
}

export interface DartVisualCollectionPlan {
  seriesTitle: string;
  seriesBible: string;
  analysis: DartVisualNoteAnalysis;
  pages: DartVisualCollectionPage[];
}

export interface SavedVisualAsset {
  index: number;
  path: string;
  revisedPrompt?: string;
}

export interface DartVisualNoteInput {
  sourceTitle: string;
  sourceQuery: string;
  mode: DartVisualMode;
  scope: DartVisualScope;
  runtime: string;
  model?: string;
  plan: DartVisualCollectionPlan;
  assets: SavedVisualAsset[];
  failedPages?: Array<{ index: number; reason: string }>;
  createdAt?: Date;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function buildNativeVisualPlanPrompt(options: DartVisualPromptOptions): string {
  const mode = options.mode ?? "disclosure-brief";
  const scope = options.scope ?? "single";
  const slideCount = normalizeSlideCount(options.slideCount, scope);
  return [
    "Analyze this Korean DART disclosure research response for a native raster image set.",
    "Do not generate an image in this turn. Do not use tools, shell commands, or external search.",
    "Return only JSON with this exact shape: {seriesTitle, seriesBible, analysis, pages}.",
    "analysis must include title, domain, sourceSummary, coreMessages, filingRefs, companyRefs, analysisIssues, requirements, riskSignals, nextActions, includedHeadings, excludedHeadings.",
    "Each page must include index, role, title, focus, message, sourceHeading, sourceExcerpt, requiredFacts, labels, visualization, avoid, layoutHint.",
    `Mode: ${mode}. Scope: ${scope}. Page count: ${slideCount}.`,
    "Use only verified facts from the response. Never invent companies, receipt numbers, financial metrics, dates, quotations, or holdings.",
    "For decks, assign a different sourceExcerpt and one dominant message to each page. Keep Korean labels short and legible.",
    options.sourceTitle?.trim() ? `Source title: ${options.sourceTitle.trim()}` : "",
    options.userDirection?.trim() ? `Direction: ${options.userDirection.trim()}` : "",
    "Source response:",
    trimForVisual(options.lastAnswer, 16000),
  ].filter(Boolean).join("\n");
}

export function buildNativeVisualSlidePrompt(input: {
  mode: DartVisualMode;
  scope: DartVisualScope;
  sourceTitle: string;
  plan: DartVisualCollectionPlan;
  page: DartVisualCollectionPage;
  hasReferenceImage: boolean;
}): string {
  const page = input.page;
  return [
    "Use your native image generation capability now to create exactly one raster PNG image.",
    "Do not return SVG, do not write files yourself, do not run shell commands, and do not call external APIs.",
    `DART visual genre: ${input.mode}. Collection scope: ${input.scope}.`,
    `Source title: ${input.sourceTitle}.`,
    `Series visual system: ${input.plan.seriesBible}.`,
    `Slide ${page.index}: ${page.role}. One dominant message: ${page.message}.`,
    `Title: ${page.title}. Focus: ${page.focus}.`,
    `Source heading: ${page.sourceHeading}.`,
    `Source excerpt (the only allowed DART content): ${page.sourceExcerpt}.`,
    `Required facts: ${page.requiredFacts.join(" | ") || "No unconfirmed fact may be added."}.`,
    `Korean labels (3-5 maximum, short and high contrast): ${page.labels.join(" | ")}.`,
    `Visualization: ${page.visualization}. Layout: ${page.layoutHint}.`,
    `Avoid: ${page.avoid.join(" | ")}.`,
    input.hasReferenceImage
      ? "The attached previous slide is a visual-style reference only. Preserve its layout language, palette, typography rhythm, and framing; do not duplicate its disclosure copy."
      : "Establish a restrained, professional visual system appropriate for this disclosure research collection.",
    "Do not include fake citations, fake receipt numbers, invented metrics, tiny unreadable Korean text, timestamps, API details, logs, or interface chrome.",
    "Use a 16:9 presentation-friendly composition unless the source requires a different clearly stated format.",
  ].join("\n");
}

export function parseDartVisualCollectionPlan(
  response: string,
  options: DartVisualPromptOptions,
): DartVisualCollectionPlan {
  const fallback = buildFallbackVisualPlan(options);
  const parsed = parseJsonObject(response);
  if (!parsed) return fallback;

  const analysis = normalizeAnalysis(parsed.analysis, fallback.analysis);
  const rawPages = Array.isArray(parsed.pages) ? parsed.pages : [];
  const pages = fallback.pages.map((fallbackPage, index) => normalizePage(rawPages[index], fallbackPage, index + 1));
  return {
    seriesTitle: stringValue(parsed.seriesTitle) || fallback.seriesTitle,
    seriesBible: stringValue(parsed.seriesBible) || fallback.seriesBible,
    analysis,
    pages,
  };
}

export function buildFallbackVisualPlan(options: DartVisualPromptOptions): DartVisualCollectionPlan {
  const mode = options.mode ?? "disclosure-brief";
  const scope = options.scope ?? "single";
  const slideCount = normalizeSlideCount(options.slideCount, scope);
  const source = stripVisualNoise(options.lastAnswer);
  const headings = source.match(/^#{1,4}\s+(.+)$/gm)?.map((value) => value.replace(/^#+\s+/, "").trim()).filter(Boolean) ?? [];
  const filingRefs = uniqueMatches(source, /(?:rcept_no|rcpNo|접수번호)\s*[:=：]?\s*([0-9]{14})\b/gi, 12);
  const companyRefs = uniqueMatches(source, /(?:회사명|기업명|법인명|종목명)\s*[:：]\s*([가-힣A-Za-z0-9&().ㆍ·_-]{2,40})/g, 12)
    .map((value) => value.replace(/의$/u, ""));
  const chunks = splitSourceChunks(source, slideCount);
  const roles = roleSequence(slideCount);
  const title = options.sourceTitle?.trim() || firstUsefulLine(source) || "DART 공시 리서치 시각자료";
  const coreMessages = chunks.map((chunk) => firstUsefulLine(chunk)).filter(Boolean).slice(0, slideCount);
  const analysis: DartVisualNoteAnalysis = {
    title,
    domain: "Korean corporate disclosure research",
    sourceSummary: trimForVisual(source, 900),
    coreMessages,
    filingRefs,
    companyRefs,
    analysisIssues: headings.slice(0, 6),
    requirements: filingRefs.slice(0, 4),
    riskSignals: extractLines(source, /불확실|확인 필요|미확인|주의/, 5),
    nextActions: extractLines(source, /검토|확인|후속|재확인/, 5),
    includedHeadings: headings.slice(0, 12),
    excludedHeadings: [],
  };
  const pages = Array.from({ length: slideCount }, (_, index) => {
    const role = roles[index];
    const excerpt = chunks[index] || source;
    const message = coreMessages[index] || firstUsefulLine(excerpt) || title;
    return {
      index: index + 1,
      role,
      title: pageTitle(role, title, index + 1),
      focus: focusForRole(role),
      message,
      sourceHeading: headings[index] || headings[0] || "DART 공시 리서치",
      sourceExcerpt: trimForVisual(excerpt, 1600),
      requiredFacts: uniqueStrings([...filingRefs.slice(index, index + 2), ...companyRefs.slice(index, index + 1)]).slice(0, 3),
      labels: labelsForRole(role, filingRefs, companyRefs),
      visualization: visualizationForMode(mode, role),
      avoid: ["확인되지 않은 투자 결론", "가짜 공시·접수번호·재무수치", "작은 본문 텍스트"],
      layoutHint: `${role} page with a clear reading order and generous document-like spacing`,
    };
  });
  return {
    seriesTitle: title,
    seriesBible: "professional Korean corporate-disclosure research set; restrained high-contrast typography; consistent grid, spacing, and accent treatment; no application interface chrome",
    analysis,
    pages,
  };
}

export function buildVisualAssetFolder(outputFolder: string, mediaFolder?: string): string {
  return normalizeVaultPath(mediaFolder?.trim() || `${outputFolder}/Visual Assets`);
}

export function buildVisualAssetPath(sourceTitle: string, folder: string, index: number, now = new Date()): string {
  const timestamp = formatTimestamp(now);
  const title = sanitizeFileName(sourceTitle).slice(0, 56) || "DART-시각자료";
  return normalizeVaultPath(`${folder}/${timestamp} - ${title} - ${String(index).padStart(2, "0")}.png`);
}

export function buildVisualCollectionNotePath(sourceTitle: string, outputFolder: string, now = new Date()): string {
  const timestamp = formatTimestamp(now);
  const title = sanitizeFileName(sourceTitle).slice(0, 70) || "DART-시각자료";
  return normalizeVaultPath(`${outputFolder}/Visual Assets/${timestamp} - ${title} - 시각자료.md`);
}

export function buildVisualCollectionNote(input: DartVisualNoteInput): string {
  const createdAt = input.createdAt ?? new Date();
  const failures = input.failedPages ?? [];
  return [
    "---",
    "type: korean-dart-visual-assets",
    `source_query: ${yamlString(input.sourceQuery)}`,
    `created: ${yamlString(formatIsoLocal(createdAt))}`,
    `mode: ${yamlString(input.mode)}`,
    `scope: ${yamlString(input.scope)}`,
    `runtime: ${yamlString(input.runtime)}`,
    `model: ${yamlString(input.model ?? "configured model")}`,
    yamlArray("asset_paths", input.assets.map((asset) => asset.path)),
    "tags:",
    "  - opendart",
    "  - corporate-disclosure",
    "  - korean-dart",
    "  - codex",
    "  - visual-assets",
    "---",
    "",
    `# ${input.plan.seriesTitle}`,
    "",
    "## 생성 정보",
    "",
    `- 모드: ${input.mode}`,
    `- 범위: ${input.scope}`,
    `- 런타임: ${input.runtime}`,
    "- 원본 리서치 노트는 자동 수정하지 않았습니다.",
    "",
    "## 시각화 설계",
    "",
    input.plan.pages.map((page) => [
      `### ${page.index}. ${page.title}`,
      "",
      `- 역할: ${page.role}`,
      `- 핵심 메시지: ${page.message}`,
      `- 근거: ${page.requiredFacts.length ? page.requiredFacts.join(", ") : "원문 응답의 확인된 내용"}`,
      `- 원문 발췌: ${page.sourceExcerpt}`,
      "",
    ].join("\n")).join("\n"),
    "## 생성 이미지",
    "",
    input.assets.length
      ? input.assets.map((asset) => `![[${asset.path}]]`).join("\n\n")
      : "_생성된 PNG가 없습니다._",
    failures.length
      ? [
        "",
        "## 복구 필요",
        "",
        ...failures.map((failure) => `- ${failure.index}번 페이지: ${failure.reason}`),
        "- 성공한 이미지는 보존되었습니다. 실패한 페이지만 다시 생성할 수 있습니다.",
      ].join("\n")
      : "",
    "",
  ].join("\n");
}

export function isPngData(value: Uint8Array): boolean {
  return value.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, index) => value[index] === byte);
}

export async function readVerifiedPng(path: string): Promise<ArrayBuffer> {
  if (!path.toLowerCase().endsWith(".png")) {
    throw new Error("Codex app-server did not return a PNG path.");
  }
  const data = await readFile(path);
  if (!isPngData(data)) {
    throw new Error("Codex app-server returned a file without a valid PNG signature.");
  }
  return new Uint8Array(data).slice().buffer;
}

function parseJsonObject(value: string): JsonObject | null {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? value;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonObject : null;
  } catch {
    return null;
  }
}

function normalizeAnalysis(value: unknown, fallback: DartVisualNoteAnalysis): DartVisualNoteAnalysis {
  const source = asObject(value);
  return {
    title: stringValue(source.title) || fallback.title,
    domain: stringValue(source.domain) || fallback.domain,
    sourceSummary: stringValue(source.sourceSummary) || fallback.sourceSummary,
    coreMessages: stringArray(source.coreMessages, fallback.coreMessages),
    filingRefs: stringArray(source.filingRefs, fallback.filingRefs),
    companyRefs: stringArray(source.companyRefs, fallback.companyRefs),
    analysisIssues: stringArray(source.analysisIssues, fallback.analysisIssues),
    requirements: stringArray(source.requirements, fallback.requirements),
    riskSignals: stringArray(source.riskSignals, fallback.riskSignals),
    nextActions: stringArray(source.nextActions, fallback.nextActions),
    includedHeadings: stringArray(source.includedHeadings, fallback.includedHeadings),
    excludedHeadings: stringArray(source.excludedHeadings, fallback.excludedHeadings),
  };
}

function normalizePage(value: unknown, fallback: DartVisualCollectionPage, index: number): DartVisualCollectionPage {
  const source = asObject(value);
  return {
    index,
    role: roleValue(source.role) || fallback.role,
    title: stringValue(source.title) || fallback.title,
    focus: stringValue(source.focus) || fallback.focus,
    message: stringValue(source.message) || fallback.message,
    sourceHeading: stringValue(source.sourceHeading) || fallback.sourceHeading,
    sourceExcerpt: stringValue(source.sourceExcerpt) || fallback.sourceExcerpt,
    requiredFacts: stringArray(source.requiredFacts, fallback.requiredFacts).slice(0, 5),
    labels: stringArray(source.labels, fallback.labels).slice(0, 5),
    visualization: stringValue(source.visualization) || fallback.visualization,
    avoid: stringArray(source.avoid, fallback.avoid).slice(0, 6),
    layoutHint: stringValue(source.layoutHint) || fallback.layoutHint,
  };
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const values = value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  return values.length ? uniqueStrings(values) : fallback;
}

function roleValue(value: unknown): DartVisualPageRole | null {
  return value === "intro" || value === "issue" || value === "rule" || value === "application" || value === "evidence" || value === "risk" || value === "conclusion"
    ? value
    : null;
}

function normalizeSlideCount(value: number | undefined, scope: DartVisualScope): number {
  if (scope === "single") return 1;
  const requested = Number.isFinite(value) ? Math.round(value as number) : 4;
  return Math.min(6, Math.max(2, requested));
}

function stripVisualNoise(value: string): string {
  return value
    .replace(/<!--\s*korean-dart-codex-meta[\s\S]*?-->/g, "")
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/```[\s\S]*?```/g, "")
    .trim();
}

function trimForVisual(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars)}…`;
}

function splitSourceChunks(source: string, count: number): string[] {
  const paragraphs = source.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  if (paragraphs.length === 0) return ["원문 응답에서 확인된 사실만 사용합니다."];
  const chunks: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = Math.floor((paragraphs.length * index) / count);
    const end = Math.max(start + 1, Math.floor((paragraphs.length * (index + 1)) / count));
    chunks.push(paragraphs.slice(start, end).join("\n\n"));
  }
  return chunks;
}

function uniqueMatches(value: string, regex: RegExp, limit: number): string[] {
  const seen = new Set<string>();
  for (const match of value.matchAll(regex)) {
    const candidate = (match[1] ?? "").trim();
    if (candidate) seen.add(candidate);
    if (seen.size >= limit) break;
  }
  return [...seen];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function extractLines(source: string, pattern: RegExp, limit: number): string[] {
  return source.split("\n").map((line) => line.trim()).filter((line) => pattern.test(line)).slice(0, limit);
}

function firstUsefulLine(value: string): string {
  return value.split("\n").map((line) => line.replace(/^#+\s+/, "").replace(/^[-*]\s+/, "").trim()).find(Boolean) ?? "";
}

function roleSequence(count: number): DartVisualPageRole[] {
  if (count === 1) return ["conclusion"];
  const base: DartVisualPageRole[] = ["intro", "rule", "application", "conclusion", "evidence", "risk"];
  return base.slice(0, count);
}

function pageTitle(role: DartVisualPageRole, sourceTitle: string, index: number): string {
  const labels: Record<DartVisualPageRole, string> = {
    intro: "핵심 질문",
    issue: "주요 분석 쟁점",
    rule: "공시와 비교 기준",
    application: "수치와 해석",
    evidence: "공시 근거",
    risk: "리스크와 확인",
    conclusion: "잠정 정리",
  };
  return `${index}. ${labels[role]} · ${sourceTitle}`;
}

function focusForRole(role: DartVisualPageRole): string {
  const focus: Record<DartVisualPageRole, string> = {
    intro: "question framing",
    issue: "issue separation",
    rule: "filings and comparison criteria",
    application: "metrics and interpretation",
    evidence: "claims and supporting evidence",
    risk: "uncertainty and next checks",
    conclusion: "qualified conclusion",
  };
  return focus[role];
}

function labelsForRole(role: DartVisualPageRole, filingRefs: string[], companyRefs: string[]): string[] {
  const base: Record<DartVisualPageRole, string[]> = {
    intro: ["질문", "범위", "확인 기준"],
    issue: ["분석 쟁점", "기간", "비교 기준"],
    rule: ["공시", "기준", "범위"],
    application: ["수치", "변화", "해석"],
    evidence: ["주장", "공시 근거", "확인"],
    risk: ["불확실", "리스크", "후속 확인"],
    conclusion: ["잠정 결론", "근거", "다음 확인"],
  };
  return uniqueStrings([...base[role], ...filingRefs.slice(0, 1), ...companyRefs.slice(0, 1)]).slice(0, 5);
}

function visualizationForMode(mode: DartVisualMode, role: DartVisualPageRole): string {
  const byMode: Record<DartVisualMode, string> = {
    "disclosure-brief": "disclosure brief with compact metric cards, filing evidence, risks, and a qualified conclusion",
    "company-map": "clear company, ownership, executive, and capital-event relationship map",
    "filing-timeline": "chronological rail with source-backed filing and corporate-event cards",
    "financial-matrix": "evidence-aware financial comparison matrix with confirmed and pending cells",
    "evidence-board": "claim-to-evidence board with source confidence badges",
    "risk-matrix": "likelihood-by-impact matrix with practical next-check cards",
    "card-news": "one-concept educational card with large concise Korean labels",
  };
  return `${byMode[mode]}; page role ${role}`;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function yamlArray(key: string, values: string[]): string {
  if (values.length === 0) return `${key}: []`;
  return [key + ":", ...values.map((value) => `  - ${yamlString(value)}`)].join("\n");
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
