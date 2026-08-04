import { CodexAppServerDartProvider } from "../src/codex-appserver";
import type { DartAgentEvent } from "../src/codex-provider";
import { buildDartResearchPrompt } from "../src/prompts";

const provider = new CodexAppServerDartProvider();
const model = process.env.CODEX_SMOKE_MODEL?.trim() || "gpt-5.6-sol";
const startedAt = Date.now();
const events: DartAgentEvent[] = [];
let streamedText = "";
let finalText = "";

try {
  const prompt = buildDartResearchPrompt({
    query: [
      "삼성전자의 최근 사업보고서 한 건을 korean-dart MCP로 확인해 다음 형식으로 짧게 정리해줘.",
      "반드시 ## 결론, 1. 2. 순서 목록, 구분/내용 두 열의 Markdown 표,",
      "> [!note] 공시 검증 메모를 각각 별도 줄과 빈 줄로 구분해 포함해줘.",
    ].join(" "),
  });

  for await (const event of provider.query({
    command: process.env.CODEX_SMOKE_COMMAND?.trim() || "codex",
    cwd: process.cwd(),
    prompt,
    model,
    reasoningEffort: "low",
    permissionMode: "auto",
    timeoutMs: 180_000,
    appServerTimeoutMs: 30_000,
    runtimeMode: "app-server",
    appServerFallback: false,
    persistSession: false,
  })) {
    events.push(event);
    if (event.type === "text-delta") streamedText += event.content;
    if (event.type === "text") finalText = event.content;
  }

  const answer = (finalText || streamedText).trim();
  const errors = events.filter((event): event is Extract<DartAgentEvent, { type: "error" }> => event.type === "error");
  const doneCount = events.filter((event) => event.type === "done").length;
  const deltaCount = events.filter((event) => event.type === "text-delta").length;

  if (errors.length > 0) {
    throw new Error(errors.map((event) => [event.content, event.detail].filter(Boolean).join("\n")).join("\n"));
  }
  if (doneCount !== 1) throw new Error(`Expected one done event, received ${doneCount}.`);
  if (deltaCount === 0) throw new Error("The app-server did not emit streaming text deltas.");
  if (!finalText.trim()) throw new Error("The canonical completed agent message was not received.");
  assertReaderReadyMarkdown(answer);

  console.log(JSON.stringify({
    status: "ok",
    model,
    elapsedMs: Date.now() - startedAt,
    deltaCount,
    streamedChars: streamedText.length,
    finalChars: finalText.length,
    finalMatchesStream: finalText === streamedText,
    structure: {
      heading: true,
      orderedList: true,
      table: true,
      callout: true,
    },
  }, null, 2));
} finally {
  provider.shutdown();
}

function assertReaderReadyMarkdown(answer: string): void {
  const required = [
    { label: "level-two heading", pattern: /(?:^|\n)##\s+\S/u },
    { label: "ordered list item 1", pattern: /(?:^|\n)1\.\s+\S/u },
    { label: "ordered list item 2", pattern: /(?:^|\n)2\.\s+\S/u },
    { label: "Markdown table separator", pattern: /(?:^|\n)\|\s*:?-{3,}/u },
    { label: "Obsidian callout", pattern: /(?:^|\n)>\s*\[!note\]/iu },
  ];
  for (const check of required) {
    if (!check.pattern.test(answer)) throw new Error(`Missing ${check.label} in final Markdown.`);
  }
  if (/[^\n]#{2,3}\s+\S/u.test(answer)) {
    throw new Error("A Markdown heading was concatenated onto the preceding sentence.");
  }
  if (/[^\n](?:1|2)\.\s+\S/u.test(answer)) {
    throw new Error("An ordered-list marker was concatenated onto the preceding sentence.");
  }
}
