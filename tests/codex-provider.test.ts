import { describe, expect, it } from "vitest";
import { CodexAppServerUnavailableError } from "../src/codex-appserver";
import {
  KoreanDartCodexProvider,
  type DartAgentEvent,
  type DartAgentProvider,
  type DartAgentQuery,
} from "../src/codex-provider";

describe("KoreanDartCodexProvider", () => {
  it("falls back to exec when app-server is unavailable", async () => {
    const provider = new KoreanDartCodexProvider({
      appServer: failingProvider(new CodexAppServerUnavailableError("no app-server")),
      exec: yieldingProvider([
        { type: "progress", content: "exec running" },
        { type: "text", content: "exec answer" },
        { type: "done" },
      ]),
    });

    const events = await collect(provider.query(query({ runtimeMode: "app-server", appServerFallback: true })));

    expect(events.map((event) => event.type)).toEqual(["progress", "progress", "text", "done"]);
    expect(events[0]).toEqual({
      type: "progress",
      content: "Codex app-server 사용 불가: no app-server. codex exec fallback으로 전환합니다.",
    });
    expect(provider.getLastRuntimeMode()).toBe("exec-fallback");
  });

  it("does not fall back for non-unavailable app-server errors", async () => {
    const provider = new KoreanDartCodexProvider({
      appServer: failingProvider(new Error("turn failed")),
      exec: yieldingProvider([{ type: "text", content: "should not run" }]),
    });

    const events = await collect(provider.query(query({ runtimeMode: "app-server", appServerFallback: true })));

    expect(events).toEqual([
      { type: "error", content: "turn failed" },
      { type: "done" },
    ]);
  });

  it("passes the same fixed vault-context prompt to app-server and exec fallback", async () => {
    const prompt = '<vault_context snapshot_id="ctx-1">fixed facts</vault_context>';
    const appServerInputs: DartAgentQuery[] = [];
    const appServer = new KoreanDartCodexProvider({
      appServer: capturingProvider(appServerInputs),
      exec: yieldingProvider([]),
    });
    await collect(appServer.query(query({ prompt })));

    const execInputs: DartAgentQuery[] = [];
    const fallback = new KoreanDartCodexProvider({
      appServer: failingProvider(new CodexAppServerUnavailableError("offline")),
      exec: capturingProvider(execInputs),
    });
    await collect(fallback.query(query({ prompt })));

    expect(appServerInputs[0].prompt).toBe(prompt);
    expect(execInputs[0].prompt).toBe(prompt);
  });
});

function query(overrides: Partial<DartAgentQuery>): DartAgentQuery {
  return {
    command: "codex",
    cwd: "/vault",
    prompt: "question",
    timeoutMs: 1000,
    appServerTimeoutMs: 1000,
    runtimeMode: "app-server",
    appServerFallback: true,
    persistSession: true,
    ...overrides,
  };
}

function failingProvider(error: Error): DartAgentProvider {
  return {
    async *query() {
      throw error;
    },
    cancel: () => undefined,
    resetSession: () => undefined,
    getSessionId: () => null,
    setSessionId: () => undefined,
  };
}

function yieldingProvider(events: DartAgentEvent[]): DartAgentProvider {
  return {
    async *query() {
      for (const event of events) yield event;
    },
    cancel: () => undefined,
    resetSession: () => undefined,
    getSessionId: () => null,
    setSessionId: () => undefined,
  };
}

function capturingProvider(inputs: DartAgentQuery[]): DartAgentProvider {
  return {
    async *query(input) {
      inputs.push(input);
      yield { type: "done" };
    },
    cancel: () => undefined,
    resetSession: () => undefined,
    getSessionId: () => null,
    setSessionId: () => undefined,
  };
}

async function collect(generator: AsyncGenerator<DartAgentEvent>): Promise<DartAgentEvent[]> {
  const events: DartAgentEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}
