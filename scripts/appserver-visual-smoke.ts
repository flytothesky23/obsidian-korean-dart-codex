import { access, stat } from "fs/promises";
import { CodexAppServerVisualProvider, type NativeVisualEvent } from "../src/codex-appserver-visual";
import { buildFallbackVisualPlan, buildNativeVisualSlidePrompt, isPngData } from "../src/visual-assets";

const source = [
  "## 핵심 분석",
  "회사명: 삼성전자의 최근 재무 흐름을 공시 근거로 정리한다.",
  "",
  "## 관련 공시",
  "접수번호: 20260312000736의 사업보고서를 확인한다.",
  "",
  "## 검토 포인트",
  "정정공시, 단위, 연결·별도 기준은 추가 확인이 필요하다.",
].join("\n");

const provider = new CodexAppServerVisualProvider();
const model = process.env.CODEX_SMOKE_MODEL?.trim() || "gpt-5.6-sol";
const plan = buildFallbackVisualPlan({
  lastAnswer: source,
  mode: "disclosure-brief",
  scope: "deck",
  slideCount: 2,
  sourceTitle: "삼성전자 공시 연구 메모",
});

const report: Array<{ slide: number; savedPath: string; bytes: number }> = [];
let referenceImagePath: string | undefined;

try {
  for (const page of plan.pages) {
    const events = await collect(provider.generateImage({
      command: "codex",
      cwd: process.cwd(),
      prompt: buildNativeVisualSlidePrompt({
        mode: "disclosure-brief",
        scope: "deck",
        sourceTitle: "삼성전자 공시 연구 메모",
        plan,
        page,
        hasReferenceImage: !!referenceImagePath,
      }),
      model,
      reasoningEffort: "medium",
      permissionMode: "auto",
      timeoutMs: 600_000,
      appServerTimeoutMs: 30_000,
      referenceImagePath,
    }));
    const image = events.find((event): event is Extract<NativeVisualEvent, { type: "image" }> => event.type === "image");
    const errors = events.filter((event): event is Extract<NativeVisualEvent, { type: "error" }> => event.type === "error");
    if (errors.length) throw new Error(errors.map((event) => event.content).join("\n"));
    if (!image) throw new Error(`Slide ${page.index} did not return an imageGeneration savedPath.`);
    await access(image.savedPath);
    const info = await stat(image.savedPath);
    if (!info.isFile() || info.size < 1024) throw new Error(`Slide ${page.index} PNG file is missing or unexpectedly small.`);
    const signature = await readSignature(image.savedPath);
    if (!isPngData(signature)) throw new Error(`Slide ${page.index} did not have a PNG signature.`);
    report.push({ slide: page.index, savedPath: image.savedPath, bytes: info.size });
    referenceImagePath = image.savedPath;
  }
  console.log(JSON.stringify({
    status: "ok",
    model,
    slideCount: report.length,
    continuityReferenceUsed: true,
    report,
  }, null, 2));
} finally {
  provider.shutdown();
}

async function collect(generator: AsyncGenerator<NativeVisualEvent>): Promise<NativeVisualEvent[]> {
  const events: NativeVisualEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

async function readSignature(path: string): Promise<Uint8Array> {
  const { open } = await import("fs/promises");
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(8);
    await handle.read(buffer, 0, buffer.length, 0);
    return buffer;
  } finally {
    await handle.close();
  }
}
