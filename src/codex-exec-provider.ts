import { runCodexExec } from "./codex-cli";
import type { DartAgentEvent, DartAgentProvider, DartAgentQuery } from "./codex-provider";

export class ExecDartProvider implements DartAgentProvider {
  private abortController: AbortController | null = null;
  private sessionId: string | null = null;

  async *query(input: DartAgentQuery): AsyncGenerator<DartAgentEvent> {
    this.abortController = new AbortController();
    const queue = new AgentEventQueue();
    queue.push({ type: "progress", content: "codex exec fallback 실행 중" });

    void runCodexExec({
      command: input.command,
      cwd: input.cwd,
      prompt: input.prompt,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      permissionMode: input.permissionMode,
      environmentVariables: input.environmentVariables,
      koreanDartMcpSource: input.koreanDartMcpSource,
      koreaStockMcpSource: input.koreaStockMcpSource,
      timeoutMs: input.timeoutMs,
      signal: this.abortController.signal,
      onStdout: (chunk) => queue.push({ type: "text-delta", content: chunk }),
      onStderr: (chunk) => queue.push({ type: "progress", content: chunk }),
    })
      .then((result) => {
        queue.push({ type: "text", content: result.stdout.trim() });
      })
      .catch((error: unknown) => {
        queue.push({ type: "error", content: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => {
        this.abortController = null;
        queue.done();
      });

    yield* queue.consume();
    yield { type: "done" };
  }

  cancel(): void {
    this.abortController?.abort();
  }

  resetSession(): void {
    this.sessionId = null;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  setSessionId(id: string | null): void {
    this.sessionId = id;
  }
}

class AgentEventQueue {
  private events: DartAgentEvent[] = [];
  private finished = false;
  private wake: (() => void) | null = null;

  push(event: DartAgentEvent): void {
    this.events.push(event);
    this.resolve();
  }

  done(): void {
    this.finished = true;
    this.resolve();
  }

  async *consume(): AsyncGenerator<DartAgentEvent> {
    while (!this.finished || this.events.length > 0) {
      const event = this.events.shift();
      if (event) {
        yield event;
        continue;
      }
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }

  private resolve(): void {
    this.wake?.();
    this.wake = null;
  }
}
