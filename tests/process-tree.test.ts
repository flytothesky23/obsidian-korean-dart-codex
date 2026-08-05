import { spawn } from "child_process";
import { describe, expect, it } from "vitest";
import { terminateProcessTree } from "../src/process-tree";

describe("terminateProcessTree", () => {
  it.skipIf(process.platform === "win32")("removes descendants that created their own process group", async () => {
    const child = spawn(process.execPath, ["-e", `
      const { spawn } = require("child_process");
      const grandchild = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], {
        detached: true,
        stdio: "ignore",
      });
      console.log(String(grandchild.pid));
      setInterval(() => {}, 1000);
    `], {
      detached: true,
      stdio: ["ignore", "pipe", "ignore"],
    });

    const grandchildPid = await readPidLine(child.stdout);
    expect(grandchildPid).toBeGreaterThan(0);
    expect(isProcessAlive(grandchildPid)).toBe(true);

    await terminateProcessTree(child, { gracefulTimeoutMs: 100, forceTimeoutMs: 1_000 });

    expect(await waitUntilGone(grandchildPid)).toBe(true);
    if (child.pid) expect(await waitUntilGone(child.pid)).toBe(true);
  }, 5_000);
});

async function readPidLine(stream: NodeJS.ReadableStream | null): Promise<number> {
  if (!stream) throw new Error("missing child stdout");
  return await new Promise((resolve, reject) => {
    let value = "";
    const timeout = setTimeout(() => reject(new Error("timed out waiting for pid")), 1_000);
    stream.on("data", (chunk: Buffer) => {
      value += chunk.toString("utf8");
      const line = value.split(/\r?\n/).find(Boolean);
      if (!line) return;
      clearTimeout(timeout);
      resolve(Number(line));
    });
    stream.on("error", reject);
  });
}

async function waitUntilGone(pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !isProcessAlive(pid);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
