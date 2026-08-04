import type { ChildProcess } from "child_process";
import { createInterface, type Interface } from "readline";

type JsonRpcId = string | number;
type NotificationHandler = (method: string, params: unknown) => void;
type ServerRequestHandler = (id: JsonRpcId, method: string, params: unknown) => Promise<unknown>;
type CloseHandler = (error: Error) => void;

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

interface JsonRpcErrorPayload {
  message?: string;
  code?: number;
}

export class AppServerTransport {
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private notificationHandlers = new Set<NotificationHandler>();
  private closeHandlers = new Set<CloseHandler>();
  private serverRequestHandler: ServerRequestHandler | null = null;
  private reader: Interface | null = null;
  private disposed = false;
  private closed = false;

  constructor(private readonly child: ChildProcess) {}

  start(): void {
    if (!this.child.stdout) throw new Error("Codex app-server stdout is unavailable.");
    this.reader = createInterface({ input: this.child.stdout });
    this.reader.on("line", (line) => this.handleLine(line));
    this.reader.once("close", () => this.close(new Error("Codex app-server stdout closed.")));
    this.child.once("error", (error) => this.close(error));
    this.child.once("exit", (code, signal) => {
      const suffix = signal ? ` with signal ${signal}` : typeof code === "number" ? ` with code ${code}` : "";
      this.close(new Error(`Codex app-server exited${suffix}.`));
    });
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    if (this.disposed) return Promise.reject(new Error("Codex app-server transport is disposed."));
    if (!this.child.stdin) return Promise.reject(new Error("Codex app-server stdin is unavailable."));
    const id = this.nextId++;
    const message = { jsonrpc: "2.0", id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timer = timeoutMs > 0
        ? setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`Codex app-server request timed out: ${method}`));
        }, timeoutMs)
        : null;

      this.pending.set(id, {
        method,
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.child.stdin?.write(`${JSON.stringify(message)}\n`);
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.disposed || !this.child.stdin) return;
    const message: Record<string, unknown> = { jsonrpc: "2.0", method };
    if (params !== undefined) message.params = params;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  onNotification(handler: NotificationHandler): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  onServerRequest(handler: ServerRequestHandler): void {
    this.serverRequestHandler = handler;
  }

  onClose(handler: CloseHandler): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  dispose(): void {
    this.disposed = true;
    this.reader?.close();
    this.rejectPending(new Error("Codex app-server transport disposed."));
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let message: Record<string, unknown>;
    try {
      message = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return;
    }

    const id = message.id as JsonRpcId | undefined;
    const method = typeof message.method === "string" ? message.method : undefined;
    if (typeof id === "number" && !method) {
      this.handleResponse(id, message);
      return;
    }
    if (method && id === undefined) {
      this.notificationHandlers.forEach((handler) => handler(method, message.params));
      return;
    }
    if (method && id !== undefined) {
      void this.handleServerRequest(id, method, message.params);
    }
  }

  private handleResponse(id: number, message: Record<string, unknown>): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if (pending.timer) clearTimeout(pending.timer);

    if (message.error) {
      const error = message.error as JsonRpcErrorPayload;
      pending.reject(new Error(error.message || `Codex app-server request failed: ${pending.method}`));
      return;
    }
    pending.resolve(message.result);
  }

  private async handleServerRequest(id: JsonRpcId, method: string, params: unknown): Promise<void> {
    if (!this.child.stdin) return;
    if (!this.serverRequestHandler) {
      this.child.stdin.write(`${JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unhandled Codex app-server request: ${method}` },
      })}\n`);
      return;
    }

    try {
      const result = await this.serverRequestHandler(id, method, params);
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
    } catch (error) {
      this.child.stdin.write(`${JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      })}\n`);
    }
  }

  private close(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectPending(error);
    if (this.disposed) return;
    this.closeHandlers.forEach((handler) => handler(error));
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

