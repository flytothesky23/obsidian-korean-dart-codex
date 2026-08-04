import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { describe, expect, it, vi } from "vitest";
import { AppServerTransport } from "../src/appserver-transport";

type FakeChild = EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  killed: boolean;
  kill: () => boolean;
};

describe("AppServerTransport", () => {
  it("sends JSON-RPC requests and resolves responses", async () => {
    const child = fakeChild();
    const transport = new AppServerTransport(child as never);
    transport.start();

    const writes: string[] = [];
    child.stdin.on("data", (chunk: Buffer) => writes.push(chunk.toString()));
    const promise = transport.request<{ ok: boolean }>("initialize", { client: "test" }, 1000);
    const request = JSON.parse(writes[0]) as { id: number; method: string };

    expect(request.method).toBe("initialize");
    child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { ok: true } })}\n`);

    await expect(promise).resolves.toEqual({ ok: true });
  });

  it("dispatches notifications", async () => {
    const child = fakeChild();
    const transport = new AppServerTransport(child as never);
    const handler = vi.fn();
    transport.onNotification(handler);
    transport.start();

    child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "turn/started", params: { turn: { id: "t1" } } })}\n`);
    await Promise.resolve();

    expect(handler).toHaveBeenCalledWith("turn/started", { turn: { id: "t1" } });
  });

  it("responds to server requests", async () => {
    const child = fakeChild();
    const transport = new AppServerTransport(child as never);
    transport.onServerRequest(async (_id, method) => ({ received: method }));
    transport.start();

    const writes: string[] = [];
    child.stdin.on("data", (chunk: Buffer) => writes.push(chunk.toString()));
    child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: "srv-1", method: "item/tool/requestUserInput", params: {} })}\n`);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(JSON.parse(writes[0])).toEqual({
      jsonrpc: "2.0",
      id: "srv-1",
      result: { received: "item/tool/requestUserInput" },
    });
  });

  it("rejects timed out requests", async () => {
    const child = fakeChild();
    const transport = new AppServerTransport(child as never);
    transport.start();

    await expect(transport.request("initialize", {}, 1)).rejects.toThrow("timed out");
  });
});

function fakeChild(): FakeChild {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    killed: boolean;
    kill: () => boolean;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };
  return child;
}
