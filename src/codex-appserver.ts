import { spawn, type ChildProcess } from "child_process";
import { AppServerTransport } from "./appserver-transport";
import {
  buildCodexEnvironment,
  createCodexSpawnPlan,
  decodeProcessChunk,
  resolveCodexCommand,
} from "./codex-cli";
import type { CodexPermissionMode } from "./codexian-bridge";
import type { DartAgentEvent, DartAgentProvider, DartAgentQuery } from "./codex-provider";
import { applyKoreanDartMcpConfig } from "./korean-dart-mcp-config";

type JsonObject = Record<string, unknown>;

interface ThreadStartResult {
  thread?: { id?: string };
}

interface TurnStartResult {
  turn?: { id?: string };
}

export interface CodexAppServerPermissionConfig {
  approvalPolicy: "never" | "on-request";
  sandbox: "workspace-write" | "danger-full-access";
}

export class CodexAppServerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexAppServerUnavailableError";
  }
}

export class CodexAppServerDartProvider implements DartAgentProvider {
  private child: ChildProcess | null = null;
  private transport: AppServerTransport | null = null;
  private sessionId: string | null = null;
  private currentTurnId: string | null = null;
  private events: DartAgentEvent[] = [];
  private done = false;
  private canceled = false;
  private wake: (() => void) | null = null;
  private stderr = "";
  private seenProgress = new Set<string>();

  async *query(input: DartAgentQuery): AsyncGenerator<DartAgentEvent> {
    this.events = [];
    this.done = false;
    this.canceled = false;
    this.currentTurnId = null;
    this.seenProgress.clear();

    if (!input.persistSession) this.resetSession();
    await this.ensureReady(input);
    const permission = resolveAppServerPermission(input.permissionMode);
    const threadId = await this.ensureThread(input, permission);

    this.pushProgress("Codex app-server turn 시작");
    let timedOut = false;
    const turnTimer = setTimeout(() => {
      timedOut = true;
      this.pushProgress(`Codex app-server turn timeout after ${Math.round(input.timeoutMs / 1000)}s`);
      this.cancel();
    }, input.timeoutMs);
    const turn = await this.transport!.request<TurnStartResult>("turn/start", {
      threadId,
      input: [{ type: "text", text: input.prompt, text_elements: [] }],
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

    try {
      while (!this.done || this.events.length > 0) {
        const event = this.events.shift();
        if (event) {
          yield event;
          continue;
        }
        await this.wait();
      }
    } finally {
      clearTimeout(turnTimer);
    }
    if (timedOut) {
      throw new CodexAppServerUnavailableError(`turn timeout after ${Math.round(input.timeoutMs / 1000)} seconds`);
    }
    yield { type: "done" };
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

  resetSession(): void {
    this.sessionId = null;
    this.currentTurnId = null;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  setSessionId(id: string | null): void {
    this.sessionId = id;
  }

  shutdown(): void {
    this.transport?.dispose();
    this.transport = null;
    this.child?.kill();
    this.child = null;
    this.resetSession();
  }

  private async ensureReady(input: DartAgentQuery): Promise<void> {
    if (this.child && !this.child.killed && this.transport) return;
    this.shutdown();

    const command = resolveCodexCommand(input.command);
    const env = buildCodexEnvironment(input.environmentVariables, command, { cwd: input.cwd });
    const args = applyKoreanDartMcpConfig(
      ["app-server", "--listen", "stdio://"],
      input.koreanDartMcpSource,
    );
    const spawnPlan = createCodexSpawnPlan(command, args);
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
    transport.onServerRequest((_id, method, params) => this.handleServerRequest(method, params));
    transport.onClose((error) => this.handleClose(error));

    try {
      await transport.request("initialize", {
        clientInfo: { name: "korean-dart-codex", version: "0.1.1" },
        capabilities: { experimentalApi: true },
      }, input.appServerTimeoutMs);
      transport.notify("initialized");
      this.pushProgress("Codex app-server 연결 완료");
    } catch (error) {
      this.shutdown();
      const detail = [error instanceof Error ? error.message : String(error), this.stderr.trim()].filter(Boolean).join("\n");
      throw new CodexAppServerUnavailableError(`initialize 실패: ${detail}`);
    }
  }

  private async ensureThread(input: DartAgentQuery, permission: CodexAppServerPermissionConfig): Promise<string> {
    if (this.sessionId) return this.sessionId;
    this.pushProgress("Codex app-server thread 시작");
    let result: ThreadStartResult;
    try {
      result = await this.transport!.request<ThreadStartResult>("thread/start", {
        model: input.model,
        cwd: input.cwd,
        runtimeWorkspaceRoots: [input.cwd],
        approvalPolicy: permission.approvalPolicy,
        sandbox: permission.sandbox,
        baseInstructions: KOREAN_DART_BASE_INSTRUCTIONS,
        experimentalRawEvents: true,
        persistExtendedHistory: true,
      }, input.appServerTimeoutMs);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new CodexAppServerUnavailableError(`thread/start 실패: ${detail}`);
    }

    const threadId = readNestedString(result, ["thread", "id"]);
    if (!threadId) throw new CodexAppServerUnavailableError("thread/start 응답에 thread id가 없습니다.");
    this.sessionId = threadId;
    this.pushProgress(`Codex app-server thread 준비 완료: ${threadId}`);
    return threadId;
  }

  private handleNotification(method: string, params: unknown): void {
    if (this.canceled) return;
    const payload = asObject(params);
    const eventTurnId = extractTurnId(payload);
    if (this.currentTurnId && eventTurnId && eventTurnId !== this.currentTurnId) {
      this.pushProgress("이전 app-server turn 이벤트 무시");
      return;
    }
    switch (method) {
      case "thread/started": {
        const threadId = readNestedString(payload, ["thread", "id"]);
        if (threadId) this.sessionId = threadId;
        this.pushProgress("Codex app-server thread started");
        break;
      }
      case "turn/started": {
        const turnId = readNestedString(payload, ["turn", "id"]);
        if (turnId) this.currentTurnId = turnId;
        this.pushProgress("Codex app-server turn started");
        break;
      }
      case "item/agentMessage/delta":
      case "item/assistantMessage/delta":
      case "response/output_text/delta": {
        const delta = extractStreamingDelta(payload);
        if (delta) this.push({ type: "text-delta", content: delta });
        break;
      }
      case "item/completed":
      case "item/agentMessage/completed":
      case "item/assistantMessage/completed":
      case "response/output_text/done": {
        const text = extractCompletedAgentMessage(method, payload);
        if (text) this.push({ type: "text", content: text });
        break;
      }
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta":
      case "turn/plan/updated":
      case "item/plan/delta": {
        this.pushProgress("Codex 분석/계획 업데이트 수신");
        break;
      }
      case "item/toolCall/started":
      case "item/toolCall/completed":
      case "mcp/tool/started":
      case "mcp/tool/completed": {
        this.pushProgress(formatToolProgress(method, payload));
        break;
      }
      case "item/commandExecution/outputDelta":
      case "command/exec/outputDelta":
      case "process/outputDelta": {
        const text = extractText(payload, ["delta", "text", "content"]);
        if (text) this.pushProgress(text.slice(0, 240));
        break;
      }
      case "thread/status/changed": {
        const status = extractThreadStatus(payload);
        this.pushProgress(`Codex 상태: ${status}`);
        break;
      }
      case "mcpServer/startupStatus/updated": {
        const server = extractText(payload, ["server", "serverName", "name", "id"]);
        const status = extractText(payload, ["status", "state", "message"]);
        if (server.includes("korean-dart") || status.includes("korean-dart")) {
          this.pushProgress(`korean-dart MCP 상태: ${status || "startup updated"}`);
        }
        break;
      }
      case "remoteControl/status/changed":
      case "deprecationNotice": {
        break;
      }
      case "turn/completed": {
        if (isMatchingTurnCompletion(method, payload, this.currentTurnId)) {
          this.finishTurn(payload);
        }
        break;
      }
      case "error": {
        const message = readNestedString(payload, ["error", "message"]) || extractText(payload, ["message"]) || "Codex app-server 오류";
        this.push({ type: "error", content: message, detail: compactPayload(payload) });
        break;
      }
      default: {
        this.pushProgress(`app-server event: ${method}`);
        break;
      }
    }
  }

  private async handleServerRequest(method: string, params: unknown): Promise<unknown> {
    if (method.includes("requestApproval") || method.includes("Approval")) {
      const title = method.includes("file") ? "파일 변경 승인 요청" : "명령 실행 승인 요청";
      const body = compactPayload(params);
      this.push({ type: "approval-request", id: `${Date.now()}`, title, body });
      this.pushProgress(`${title} 자동 거절 - Korean DART Codex는 원본 노트를 자동 수정하지 않습니다.`);
      return method.includes("permissions")
        ? { permissions: {}, scope: "turn" }
        : { decision: method.includes("applyPatch") || method.includes("execCommand") ? "denied" : "decline" };
    }
    if (method === "item/tool/requestUserInput") {
      this.pushProgress("Codex가 사용자 입력을 요청했으나 패널 내 추가 입력은 아직 지원하지 않습니다.");
      return { answers: {} };
    }
    if (method === "mcpServer/elicitation/request") {
      const decision = resolveMcpElicitationRequest(params);
      this.pushProgress(decision.progress);
      return decision.result;
    }
    this.pushProgress(`지원하지 않는 app-server 요청 자동 거절: ${method}`);
    return { decision: "decline" };
  }

  private handleClose(error: Error): void {
    const hadActiveTurn = !!this.currentTurnId && !this.done;
    this.child = null;
    this.transport = null;
    this.resetSession();
    if (hadActiveTurn && !this.canceled) {
      const detail = [error.message, this.stderr.trim()].filter(Boolean).join("\n");
      this.push({ type: "error", content: "Codex app-server 연결이 종료되었습니다.", detail });
    }
    this.done = true;
    this.resolve();
  }

  private finishTurn(payload: JsonObject): void {
    const error = readNestedString(payload, ["turn", "error", "message"]) || readNestedString(payload, ["error", "message"]);
    const status = readNestedString(payload, ["turn", "status"]) || readNestedString(payload, ["status"]);
    if (error || status === "failed" || status === "interrupted") {
      this.push({
        type: "error",
        content: error || `Codex app-server turn ${status}`,
        detail: compactPayload(payload),
      });
    }
    this.done = true;
    this.resolve();
  }

  private pushProgress(content: string): void {
    const normalized = content.replace(/\s+/g, " ").trim();
    if (!normalized || this.seenProgress.has(normalized)) return;
    this.seenProgress.add(normalized);
    this.push({ type: "progress", content: normalized });
  }

  private push(event: DartAgentEvent): void {
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

const KOREAN_DART_BASE_INSTRUCTIONS = [
  "You are Korean DART Codex inside Obsidian.",
  "Use korean-dart MCP for Korean corporate-disclosure and financial research before general reasoning.",
  "Do not edit the user's source note automatically.",
  "Write Korean disclosure research notes, not investment advice or trading recommendations.",
].join("\n");

export function resolveAppServerPermission(mode: CodexPermissionMode | undefined): CodexAppServerPermissionConfig {
  if (mode === "yolo") return { approvalPolicy: "never", sandbox: "danger-full-access" };
  if (mode === "auto") return { approvalPolicy: "never", sandbox: "workspace-write" };
  return { approvalPolicy: "on-request", sandbox: "workspace-write" };
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" ? value as JsonObject : {};
}

export function extractStreamingDelta(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const object = value as JsonObject;
  for (const key of ["delta", "text", "content"]) {
    const candidate = object[key];
    if (typeof candidate === "string") return candidate;
    if (candidate && typeof candidate === "object") {
      const nested = extractStreamingDelta(candidate);
      if (nested) return nested;
    }
  }
  return "";
}

export function extractCompletedAgentMessage(method: string, value: unknown): string {
  const payload = asObject(value);
  const item = asObject(payload.item);
  if (method === "item/completed") {
    const type = typeof item.type === "string" ? item.type : "";
    if (type !== "agentMessage" && type !== "assistantMessage") return "";
    return exactString(item.text) || exactString(item.content);
  }
  return exactString(item.text)
    || exactString(item.content)
    || exactString(payload.text)
    || exactString(payload.content)
    || exactString(asObject(payload.message).text)
    || exactString(payload.message);
}

export function isMatchingTurnCompletion(
  method: string,
  value: unknown,
  activeTurnId: string | null,
): boolean {
  if (method !== "turn/completed" || !activeTurnId) return false;
  return extractTurnId(asObject(value)) === activeTurnId;
}

function exactString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function extractTurnId(payload: JsonObject): string {
  return exactString(payload.turnId)
    || readNestedString(payload, ["turn", "id"])
    || readNestedString(payload, ["item", "turnId"])
    || "";
}

export function resolveMcpElicitationRequest(params: unknown): {
  result: JsonObject;
  progress: string;
} {
  const payload = asObject(params);
  const serverName = extractText(payload, ["serverName", "server", "name"]);
  const meta = asObject(payload._meta);
  const approvalKind = typeof meta.codex_approval_kind === "string" ? meta.codex_approval_kind : "";
  const requestedSchema = asObject(payload.requestedSchema);
  const properties = requestedSchema.properties;
  const hasNoRequestedFields = !properties
    || (typeof properties === "object" && !Array.isArray(properties) && Object.keys(properties).length === 0);

  if (serverName === "korean-dart" && approvalKind === "mcp_tool_call" && hasNoRequestedFields) {
    const toolName = extractMcpToolName(payload);
    return {
      result: { action: "accept", content: {}, _meta: null },
      progress: toolName
        ? `korean-dart/${toolName} 실행 승인`
        : "korean-dart MCP 도구 실행 승인",
    };
  }

  return {
    result: { action: "cancel", content: null, _meta: null },
    progress: serverName
      ? `${serverName} MCP 추가 입력 요청 자동 취소`
      : "MCP 추가 입력 요청 자동 취소",
  };
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

function extractMcpToolName(payload: JsonObject): string {
  const direct = extractText(payload, ["toolName", "name", "tool"]);
  if (direct) return direct;
  const meta = asObject(payload._meta);
  const metaTool = extractText(meta, ["tool_name", "toolName", "tool"]);
  if (metaTool) return metaTool;
  const message = typeof payload.message === "string" ? payload.message : "";
  const match = message.match(/tool\s+"([^"]+)"/i);
  return match?.[1] ?? "";
}

function compactPayload(value: unknown): string {
  const text = extractText(value, ["description", "reason", "summary", "command", "cmd", "diff", "patch", "message"]);
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
    const type = statusObject.type;
    const state = statusObject.state;
    if (typeof type === "string" && type.trim()) return type.trim();
    if (typeof state === "string" && state.trim()) return state.trim();
  }
  return readNestedString(payload, ["thread", "status", "type"])
    || readNestedString(payload, ["thread", "status"])
    || "changed";
}

function formatToolProgress(method: string, payload: JsonObject): string {
  const name = extractText(payload, ["name", "toolName", "server", "method"]) || method;
  return method.includes("completed") ? `${name} 완료` : `${name} 호출 중`;
}
