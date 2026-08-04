import type { CodexPermissionMode, CodexReasoningEffort } from "./codexian-bridge";

export type DartRuntimeMode = "app-server" | "exec";

export interface DartAgentQuery {
  command: string;
  cwd: string;
  prompt: string;
  model?: string;
  reasoningEffort?: CodexReasoningEffort;
  permissionMode?: CodexPermissionMode;
  environmentVariables?: string;
  timeoutMs: number;
  appServerTimeoutMs: number;
  runtimeMode: DartRuntimeMode;
  appServerFallback: boolean;
  persistSession: boolean;
}

export type DartAgentEvent =
  | { type: "progress"; content: string }
  | { type: "text-delta"; content: string }
  | { type: "text"; content: string }
  | { type: "error"; content: string; detail?: string }
  | { type: "approval-request"; id: string; title: string; body: string }
  | { type: "done" };

export interface DartAgentProvider {
  query(input: DartAgentQuery): AsyncGenerator<DartAgentEvent>;
  cancel(): void;
  resetSession(): void;
  getSessionId(): string | null;
  setSessionId(id: string | null): void;
  shutdown?(): void;
}

export class KoreanDartCodexProvider implements DartAgentProvider {
  private readonly appServer: DartAgentProvider;
  private readonly exec: DartAgentProvider;
  private active: DartAgentProvider | null = null;
  private lastRuntimeMode: DartRuntimeMode | "exec-fallback" | null = null;

  constructor(providers: {
    appServer?: DartAgentProvider;
    exec?: DartAgentProvider;
  } = {}) {
    this.appServer = providers.appServer ?? new LazyDartProvider(async () => {
      const module = await import("./codex-appserver");
      return new module.CodexAppServerDartProvider();
    });
    this.exec = providers.exec ?? new LazyDartProvider(async () => {
      const module = await import("./codex-exec-provider");
      return new module.ExecDartProvider();
    });
  }

  async *query(input: DartAgentQuery): AsyncGenerator<DartAgentEvent> {
    this.lastRuntimeMode = null;
    if (input.runtimeMode === "app-server") {
      try {
        this.active = this.appServer;
        this.lastRuntimeMode = "app-server";
        yield* this.appServer.query(input);
        return;
      } catch (error) {
        if (!isAppServerUnavailableError(error) || !input.appServerFallback) {
          yield { type: "error", content: error instanceof Error ? error.message : String(error) };
          yield { type: "done" };
          return;
        }
        const message = error.message || "app-server unavailable";
        yield {
          type: "progress",
          content: `Codex app-server 사용 불가: ${message}. codex exec fallback으로 전환합니다.`,
        };
      }
    }

    this.active = this.exec;
    this.lastRuntimeMode = input.runtimeMode === "app-server" ? "exec-fallback" : "exec";
    yield* this.exec.query(input);
  }

  cancel(): void {
    this.active?.cancel();
  }

  resetSession(): void {
    this.appServer.resetSession();
    this.exec.resetSession();
  }

  getSessionId(): string | null {
    return this.active?.getSessionId() ?? this.appServer.getSessionId() ?? this.exec.getSessionId();
  }

  setSessionId(id: string | null): void {
    this.appServer.setSessionId(id);
    this.exec.setSessionId(id);
  }

  getLastRuntimeMode(): DartRuntimeMode | "exec-fallback" | null {
    return this.lastRuntimeMode;
  }

  shutdown(): void {
    this.active?.cancel();
    this.appServer.shutdown?.();
    this.exec.shutdown?.();
    this.active = null;
  }
}

class LazyDartProvider implements DartAgentProvider {
  private provider: DartAgentProvider | null = null;
  private providerPromise: Promise<DartAgentProvider> | null = null;

  constructor(private readonly factory: () => Promise<DartAgentProvider>) {}

  async *query(input: DartAgentQuery): AsyncGenerator<DartAgentEvent> {
    yield* (await this.get()).query(input);
  }

  cancel(): void {
    this.provider?.cancel();
  }

  resetSession(): void {
    this.provider?.resetSession();
  }

  getSessionId(): string | null {
    return this.provider?.getSessionId() ?? null;
  }

  setSessionId(id: string | null): void {
    this.provider?.setSessionId(id);
  }

  shutdown(): void {
    this.provider?.shutdown?.();
    this.provider = null;
    this.providerPromise = null;
  }

  private async get(): Promise<DartAgentProvider> {
    if (this.provider) return this.provider;
    this.providerPromise ??= this.factory();
    this.provider = await this.providerPromise;
    return this.provider;
  }
}

function isAppServerUnavailableError(error: unknown): boolean {
  return error instanceof Error && error.name === "CodexAppServerUnavailableError";
}
