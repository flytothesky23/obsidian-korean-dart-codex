import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const LAUNCHER_VERSION = "1";
const LAUNCHER_SOURCE = `
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const [packageSpec, packageName, binName] = process.argv.slice(2);
if (!packageSpec || !packageName || !binName) {
  process.stderr.write("Managed MCP launcher requires package, name, and bin arguments.\\n");
  process.exit(2);
}

const cacheKey = packageSpec.replace(/[^a-zA-Z0-9._-]+/g, "_");
const cacheRoot = join(tmpdir(), "korean-dart-codex-mcp-cache", cacheKey);
const packageRoot = join(cacheRoot, "node_modules", packageName);
const lockPath = cacheRoot + ".install-lock";
const secretNames = new Set(["DART_API_KEY", "KRX_API_KEY"]);
const installEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !secretNames.has(name.toUpperCase())));

await ensurePackage();
const packageJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
const relativeBin = typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.[binName];
if (!relativeBin) throw new Error("Managed MCP package does not declare the expected binary: " + binName);

const server = spawn(process.execPath, [join(packageRoot, relativeBin)], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    try { server.kill(signal); } catch {}
  });
}
server.once("error", (error) => {
  process.stderr.write("Managed MCP server launch failed: " + error.message + "\\n");
  process.exit(1);
});
server.once("close", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});

async function ensurePackage() {
  if (await packageReady()) return;
  await mkdir(cacheRoot, { recursive: true });
  let ownsLock = false;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    try {
      await mkdir(lockPath);
      ownsLock = true;
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (await packageReady()) return;
      try {
        const lock = await stat(lockPath);
        if (Date.now() - lock.mtimeMs > 120_000) await rm(lockPath, { recursive: true, force: true });
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!ownsLock) throw new Error("Timed out waiting for the managed MCP package cache.");

  try {
    if (await packageReady()) return;
    await runInstall();
    if (!await packageReady()) throw new Error("Managed MCP package installation completed without the requested version.");
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

async function packageReady() {
  try {
    const value = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
    const expectedVersion = packageSpec.slice(packageName.length + 1);
    return !expectedVersion || value.version === expectedVersion;
  } catch {
    return false;
  }
}

function runInstall() {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  return new Promise((resolve, reject) => {
    const child = spawn(npm, ["install", "--no-save", "--omit=dev", "--no-audit", "--no-fund", "--prefix", cacheRoot, packageSpec], {
      env: installEnv,
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error("npm install failed (" + code + "): " + stderr.trim())));
  });
}
`.trimStart();

export interface ManagedMcpLauncherConfig {
  command: string;
  args: string[];
  cwd: string;
}

export function managedMcpLauncherConfig(
  packageSpec: string,
  packageName: string,
  binName = packageName,
): ManagedMcpLauncherConfig {
  return {
    command: "node",
    args: [managedMcpLauncherPath(), packageSpec, packageName, binName],
    cwd: managedMcpWorkingDirectory(packageName),
  };
}

export function managedMcpLauncherPath(): string {
  const root = join(tmpdir(), "korean-dart-codex-managed-launcher");
  const path = join(root, `launcher-v${LAUNCHER_VERSION}.mjs`);
  mkdirSync(root, { recursive: true });
  try {
    if (readFileSync(path, "utf8") === LAUNCHER_SOURCE) {
      chmodSync(path, 0o600);
      return path;
    }
  } catch {
    // Create or refresh the generated launcher below.
  }
  writeFileSync(path, LAUNCHER_SOURCE, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

export function managedMcpWorkingDirectory(packageName: string): string {
  const directory = join(tmpdir(), "korean-dart-codex-mcp-work", packageName.replace(/[^a-zA-Z0-9._-]+/g, "_"));
  mkdirSync(directory, { recursive: true });
  return directory;
}
