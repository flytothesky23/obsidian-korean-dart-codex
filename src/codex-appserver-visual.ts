import { spawn, type ChildProcess } from "child_process";
import { AppServerTransport } from "./appserver-transport";
import {
  CodexAppServerUnavailableError,
  resolveAppServerPermission,
  type CodexAppServerPermissionConfig,
} from "./codex-appserver";
import {
  buildCodexEnvironment,
  createCodexSpawnPlan,
  decodeProcessChunk,
  resolveCodexCommand,
} from "./codex-cli";
import type { CodexPermissionMode, CodexReasoningEffort } from "./codexian-bridge";

type JsonObject = Record<string, unknown>;

interface ThreadStartResult {
  thread?: { id?: string };
}

interface TurnStartResult {
  turn?: { id?: string };
}

export interface NativeVisualTurnInput {
  command: string;
  cwd: string;
  prompt: string;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  permissionMode?: CodexPermissionMode;
  environmentVariables?: string;
  timeoutMs: number;
  appServerTimeoutMs: number;
  referenceImagePath?: string;
}

export type NativeVisualEvent =
  | { type: "progress"; content: string }
  | { type: "text-delta"; content: string }
  | { type: "text"; content: string }
  | { type: "image"; savedPath: string; revisedPrompt?: string }
  | { type: "error"; content: string; detail?: string }
  | { type: "done" };

export interface NativeImageGenerationResult {
  status: string;
  savedPath?: string;
  revisedPrompt?: string;
}

/**
 * Native visual provider uses a dedicated app-server thread. It deliberately
 * does not inherit the dart-chat thread or its korean-dart MCP instructions.
 */
export class CodexAppServerVisualProvider {
  private child: ChildProcess | null = null;
  private transport: AppServerTransport | null = null;
  private sessionId: string | null = null;
  private currentTurnId: string | null = null;
  private events: NativeVisualEvent[] = [];
  private done = false;
  private canceled = false;
  private wake: (() => void) | null = null;
  private stderr = "";
  private seenProgress = new Set<string>();

  async *plan(input: NativeVisualTurnInput): AsyncGenerator<NativeVisualEvent> {
    yield* this.runTurn(input, false);
  }

  async *generateImage(input: NativeVisualTurnInput): AsyncGenerator<NativeVisualEvent> {
    yield* this.runTurn(input, true);
  }

  cancel(): void {
    this.canceled = true;
    this.done = true;
    const transport = this.transport;
    const threadId = this.sessionId;
    const turnId = this.currentTurnId;
    this.resolve();
    if (transport && threadId && turnId) {
      void transport.request("turn/interrupt", { threadId, turnId }, 5_000).catch(() => undefined);
    }
  }

  shutdown(): void {
    this.transport?.dispose();
    this.transport = null;
    this.child?.kill();
    this.child = null;
    this.sessionId = null;
    this.currentTurnId = null;
  }

  private async *runTurn(input: NativeVisualTurnInput, requiresImage: boolean): AsyncGenerator<NativeVisualEvent> {
    this.events = [];
    this.done = false;
    this.canceled = false;
    this.currentTurnId = null;
    this.seenProgress.clear();

    await this.ensureReady(input);
    const permission = resolveAppServerPermission(input.permissionMode);
    const threadId = await this.ensureThread(input, permission);

    this.pushProgress(requiresImage ? "Codex app-server 시각자료 생성 시작" : "Codex app-server 시각자료 분석 시작");
    let timedOut = false;
    let receivedImage = false;
    const turnTimer = setTimeout(() => {
      timedOut = true;
      this.pushProgress(`Codex app-server 시각자료 timeout after ${Math.round(input.timeoutMs / 1000)}s`);
      this.cancel();
    }, input.timeoutMs);

    try {
      const turn = await this.transport!.request<TurnStartResult>("turn/start", {
        threadId,
        input: buildTurnInput(input),
        cwd: input.cwd,
        runtimeWorkspaceRoots: [input.cwd],
        approvalPolicy: permission.approvalPolicy,
        sandbox: permission.sandbox,
        model: input.model,
        effort: input.reasoningEffort,
        collaborationMode: {
          mode: "default",
          settings: {
            model: input.model,
            reasoning_effort: input.reasoningEffort,
            developer_instructions: null,
          },
        },
      }, input.appServerTimeoutMs);
      this.currentTurnId = readNestedString(turn, ["turn", "id"]);

      while (!this.done || this.events.length > 0) {
        const event = this.events.shift();
        if (event) {
          if (event.type === "image") receivedImage = true;
          yield event;
          continue;
        }
        await this.wait();
      }
    } finally {
      clearTimeout(turnTimer);
    }

    if (timedOut) {
      throw new CodexAppServerUnavailableError(`native visual turn timeout after ${Math.round(input.timeoutMs / 1000)} seconds`);
    }
    if (requiresImage && !receivedImage) {
      throw new CodexAppServerUnavailableError("Codex app-server did not return a saved native PNG.");
    }
    yield { type: "done" };
  }

  private async ensureReady(input: NativeVisualTurnInput): Promise<void> {
    if (this.child && !this.child.killed && this.transport) return;
    this.shutdown();

    const command = resolveCodexCommand(input.command);
    const env = buildCodexEnvironment(input.environmentVariables, command, { cwd: input.cwd });
    const spawnPlan = createCodexSpawnPlan(command, ["app-server", "--listen", "stdio://"]);
    this.stderr = "";

    try {
      this.child = spawn(spawnPlan.command, spawnPlan.args, {
        cwd: input.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env,
        shell: spawnPlan.shell,
        windowsHide: true,
      });
    } catch (error) {
      throw new CodexAppServerUnavailableError(error instanceof Error ? error.message : String(error));
    }

    this.child.stderr?.on("data", (chunk: Buffer) => {
      this.stderr += decodeProcessChunk(chunk);
      if (this.stderr.length > 10_000) this.stderr = this.stderr.slice(-10_000);
    });

    const transport = new AppServerTransport(this.child);
    this.transport = transport;
    transport.start();
    transport.onNotification((method, params) => this.handleNotification(method, params));
    transport.onClose((error) => this.handleClose(error));

    try {
      await transport.request("initialize", {
        clientInfo: { name: "korean-dart-codex", version: "0.1.1" },
        capabilities: { experimentalApi: true },
      }, input.appServerTimeoutMs);
      transport.notify("initialized");
      const capabilities = await transport.request("modelProvider/capabilities/read", {}, input.appServerTimeoutMs);
      if (!supportsNativeImageGeneration(capabilities)) {
        this.shutdown();
        throw new CodexAppServerUnavailableError("현재 Codex app-server가 native image generation capability를 제공하지 않습니다.");
      }
      this.pushProgress("Codex app-server native image generation 준비 완료");
    } catch (error) {
      this.shutdown();
      if (error instanceof CodexAppServerUnavailableError) throw error;
      const detail = [error instanceof Error ? error.message : String(error), this.stderr.trim()].filter(Boolean).join("\n");
      throw new CodexAppServerUnavailableError(`native visual initialize 실패: ${detail}`);
    }
  }

  private async ensureThread(input: NativeVisualTurnInput, permission: CodexAppServerPermissionConfig): Promise<string> {
    if (this.sessionId) return this.sessionId;
    this.pushProgress("Codex app-server 시각자료 thread 시작");
    let result: ThreadStartResult;
    try {
      result = await this.transport!.request<ThreadStartResult>("thread/start", {
        model: input.model,
        cwd: input.cwd,
        runtimeWorkspaceRoots: [input.cwd],
        approvalPolicy: permission.approvalPolicy,
        sandbox: permission.sandbox,
        baseInstructions: NATIVE_VISUAL_BASE_INSTRUCTIONS,
        experimentalRawEvents: true,
        persistExtendedHistory: true,
      }, input.appServerTimeoutMs);
    } catch (error) {
      throw new CodexAppServerUnavailableError(`native visual thread/start 실패: ${error instanceof Error ? error.message : String(error)}`);
    }

    const threadId = readNestedString(result, ["thread", "id"]);
    if (!threadId) throw new CodexAppServerUnavailableError("native visual thread/start 응답에 thread id가 없습니다.");
    this.sessionId = threadId;
    this.pushProgress(`Codex app-server 시각자료 thread 준비 완료: ${threadId}`);
    return threadId;
  }

  private handleNotification(method: string, params: unknown): void {
    if (this.canceled) return;
    const payload = asObject(params);
    switch (method) {
      case "turn/started": {
        const turnId = readNestedString(payload, ["turn", "id"]);
        if (turnId) this.currentTurnId = turnId;
        this.pushProgress("Codex app-server 시각자료 turn started");
        break;
      }
      case "item/agentMessage/delta":
      case "item/assistantMessage/delta":
      case "response/output_text/delta": {
        const delta = extractText(payload, ["delta", "text", "content"]);
        if (delta) this.push({ type: "text-delta", content: delta });
        break;
      }
      case "item/agentMessage/completed":
      case "item/assistantMessage/completed":
      case "response/output_text/done": {
        const text = extractText(payload, ["text", "content", "message", "delta"]);
        if (text) this.push({ type: "text", content: text });
        break;
      }
      case "item/completed": {
        const image = extractNativeImageGeneration(payload);
        if (image.status === "completed" && image.savedPath) {
          this.push({ type: "image", savedPath: image.savedPath, revisedPrompt: image.revisedPrompt });
        } else if (image.status && image.status !== "inProgress") {
          this.push({
            type: "error",
            content: `Codex native image generation ${image.status === "failed" ? "failed" : "did not complete"}.`,
          });
        }
        break;
      }
      case "thread/status/changed": {
        const status = extractThreadStatus(payload);
        this.pushProgress(`Codex 상태: ${status}`);
        if (status === "idle" && this.currentTurnId) this.finishTurn(payload);
        break;
      }
      case "turn/completed":
      case "turn/finished":
      case "turn/done":
      case "turn/cancelled":
      case "turn/interrupted": {
        this.finishTurn(payload);
        break;
      }
      case "error": {
        const message = readNestedString(payload, ["error", "message"]) || extractText(payload, ["message"]) || "Codex native visual 오류";
        this.push({ type: "error", content: message, detail: compactPayload(payload) });
        this.done = true;
        this.resolve();
        break;
      }
      case "remoteControl/status/changed":
      case "deprecationNotice":
      case "thread/settings/updated":
      case "thread/tokenUsage/updated":
      case "account/rateLimits/updated":
        break;
      default:
        this.pushProgress(`app-server visual event: ${method}`);
        break;
    }
  }

  private handleClose(error: Error): void {
    const hadActiveTurn = !!this.currentTurnId && !this.done;
    this.child = null;
    this.transport = null;
    this.sessionId = null;
    this.currentTurnId = null;
    if (hadActiveTurn && !this.canceled) {
      const detail = [error.message, this.stderr.trim()].filter(Boolean).join("\n");
      this.push({ type: "error", content: "Codex app-server 시각자료 연결이 종료되었습니다.", detail });
    }
    this.done = true;
    this.resolve();
  }

  private finishTurn(payload: JsonObject): void {
    const error = readNestedString(payload, ["turn", "error", "message"]) || readNestedString(payload, ["error", "message"]);
    if (error) this.push({ type: "error", content: error, detail: compactPayload(payload) });
    this.done = true;
    this.resolve();
  }

  private pushProgress(content: string): void {
    const normalized = content.replace(/\s+/g, " ").trim();
    if (!normalized || this.seenProgress.has(normalized)) return;
    this.seenProgress.add(normalized);
    this.push({ type: "progress", content: normalized });
  }

  private push(event: NativeVisualEvent): void {
    this.events.push(event);
    this.resolve();
  }

  private wait(): Promise<void> {
    if (this.events.length > 0 || this.done) return Promise.resolve();
    return new Promise((resolve) => {
      this.wake = resolve;
    });
  }

  private resolve(): void {
    this.wake?.();
    this.wake = null;
  }
}

export function supportsNativeImageGeneration(value: unknown): boolean {
  const payload = asObject(value);
  if (payload.imageGeneration === true) return true;
  return asObject(payload.capabilities).imageGeneration === true;
}

export function extractNativeImageGeneration(value: unknown): NativeImageGenerationResult {
  const payload = asObject(value);
  const item = asObject(payload.item);
  const candidate = Object.keys(item).length > 0 ? item : payload;
  if (candidate.type !== "imageGeneration") return { status: "" };
  return {
    status: typeof candidate.status === "string" ? candidate.status : "",
    savedPath: typeof candidate.savedPath === "string" && candidate.savedPath.trim() ? candidate.savedPath.trim() : undefined,
    revisedPrompt: typeof candidate.revisedPrompt === "string" && candidate.revisedPrompt.trim()
      ? candidate.revisedPrompt.trim()
      : undefined,
  };
}

function buildTurnInput(input: NativeVisualTurnInput): JsonObject[] {
  const items: JsonObject[] = [{ type: "text", text: input.prompt, text_elements: [] }];
  if (input.referenceImagePath?.trim()) {
    items.push({ type: "localImage", path: input.referenceImagePath.trim(), detail: "high" });
  }
  return items;
}

const NATIVE_VISUAL_BASE_INSTRUCTIONS = [
  "You generate source-grounded DART disclosure visual assets inside an Obsidian vault.",
  "Use the native image generation capability only when the user asks for an image.",
  "Never edit source notes, run shell commands, write scripts, use SVG fallback, or call external APIs.",
  "Create raster PNG assets. Never invent companies, receipt numbers, filing references, financial metrics, dates, quotes, or investment conclusions.",
  "For a multi-slide set, keep visual language consistent but give each page one distinct, source-backed message.",
].join("\n");

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" ? value as JsonObject : {};
}

function readNestedString(value: unknown, parts: string[]): string | null {
  let current: unknown = value;
  for (const part of parts) {
    if (!current || typeof current !== "object") return null;
    current = (current as JsonObject)[part];
  }
  return typeof current === "string" && current.trim() ? current.trim() : null;
}

function extractText(value: unknown, keys: string[]): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const object = value as JsonObject;
  for (const key of keys) {
    const candidate = object[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (Array.isArray(candidate)) {
      const joined = candidate.map((item) => extractText(item, keys)).filter(Boolean).join("\n");
      if (joined) return joined;
    }
    if (candidate && typeof candidate === "object") {
      const nested = extractText(candidate, keys);
      if (nested) return nested;
    }
  }
  return "";
}

function compactPayload(value: unknown): string {
  const text = extractText(value, ["description", "reason", "summary", "message"]);
  if (text) return text.slice(0, 4000);
  try {
    return JSON.stringify(value, null, 2).slice(0, 4000);
  } catch {
    return String(value).slice(0, 4000);
  }
}

function extractThreadStatus(payload: JsonObject): string {
  const status = payload.status;
  if (typeof status === "string" && status.trim()) return status.trim();
  if (status && typeof status === "object") {
    const statusObject = status as JsonObject;
    if (typeof statusObject.type === "string" && statusObject.type.trim()) return statusObject.type.trim();
    if (typeof statusObject.state === "string" && statusObject.state.trim()) return statusObject.state.trim();
  }
  return readNestedString(payload, ["thread", "status", "type"])
    || readNestedString(payload, ["thread", "status"])
    || "changed";
}
