import { spawn, type ChildProcess } from "child_process";

export function shouldCreateProcessGroup(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== "win32";
}

export async function terminateProcessTree(
  child: ChildProcess,
  options: {
    platform?: NodeJS.Platform;
    gracefulTimeoutMs?: number;
    forceTimeoutMs?: number;
  } = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;

  if (platform !== "win32") {
    const trackedPids = [child.pid, ...(await collectDescendantPids(child.pid))];
    child.stdin?.end();
    signalPositivePids(trackedPids, "SIGTERM");
    if (await waitForProcessesToExit(child, trackedPids, options.gracefulTimeoutMs ?? 1_500)) return;

    signalPositivePids(trackedPids, "SIGKILL");
    await waitForProcessesToExit(child, trackedPids, options.forceTimeoutMs ?? 1_500);
    return;
  }

  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));

  child.stdin?.end();
  await signalProcessTree(child, "SIGTERM", platform);
  if (await waitForClose(closed, options.gracefulTimeoutMs ?? 1_500)) return;

  await signalProcessTree(child, "SIGKILL", platform);
  await waitForClose(closed, options.forceTimeoutMs ?? 1_500);
}

async function signalProcessTree(
  child: ChildProcess,
  signal: NodeJS.Signals,
  platform: NodeJS.Platform,
): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;

  await new Promise<void>((resolve) => {
    const args = ["/PID", String(child.pid), "/T"];
    if (signal === "SIGKILL") args.push("/F");
    const taskkill = spawn("taskkill.exe", args, {
      stdio: "ignore",
      windowsHide: true,
    });
    taskkill.once("error", () => {
      try {
        child.kill(signal);
      } catch {
        // The process may already be gone.
      }
      resolve();
    });
    taskkill.once("close", () => resolve());
  });
}

function signalPositivePids(pids: number[], signal: NodeJS.Signals): void {
  for (const pid of pids.slice().reverse()) {
    signalPositivePid(pid, signal);
  }
}

async function collectDescendantPids(rootPid: number): Promise<number[]> {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 0) return [];

  const seen = new Set<number>();
  const queue = [rootPid];
  const descendants: number[] = [];

  while (queue.length) {
    const parentPid = queue.shift();
    if (!parentPid) continue;
    const childPids = await listDirectChildPids(parentPid);
    for (const childPid of childPids) {
      if (childPid === rootPid || seen.has(childPid)) continue;
      seen.add(childPid);
      descendants.push(childPid);
      queue.push(childPid);
    }
  }

  return descendants;
}

async function listDirectChildPids(parentPid: number): Promise<number[]> {
  if (!Number.isSafeInteger(parentPid) || parentPid <= 0) return [];
  return await new Promise((resolve) => {
    const pgrep = spawn("pgrep", ["-P", String(parentPid)], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    let stdout = "";
    pgrep.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    pgrep.once("error", () => resolve([]));
    pgrep.once("close", () => {
      resolve(stdout.split(/\s+/).flatMap((entry) => {
        const pid = Number(entry);
        return Number.isSafeInteger(pid) && pid > 0 ? [pid] : [];
      }));
    });
  });
}

function signalPositivePid(pid: number, signal: NodeJS.Signals): void {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  try {
    process.kill(-pid, signal);
  } catch {
    // The process may not be a process-group leader, or it may have exited.
  }
  try {
    process.kill(pid, signal);
  } catch {
    // The process may already be gone.
  }
}

async function waitForClose(closed: Promise<void>, timeoutMs: number): Promise<boolean> {
  return Promise.race([
    closed.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

async function waitForProcessesToExit(
  child: ChildProcess,
  trackedPids: number[],
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (Date.now() <= deadline) {
    const rootExited = child.exitCode !== null || child.signalCode !== null;
    const hasLiveProcess = trackedPids.some((pid) => {
      if (pid === child.pid && rootExited) return false;
      return isProcessAlive(pid);
    });
    if (!hasLiveProcess) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
