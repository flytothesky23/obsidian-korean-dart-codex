import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCodexEnvironment,
  codexExecArgs,
  createCodexSpawnPlan,
  decodeProcessChunk,
  parseEnvironmentVariables,
  resolveCodexCommand,
} from "../src/codex-cli";

describe("codexExecArgs", () => {
  it("builds current Codex exec args with output-last-message and MCP-capable auto mode", () => {
    const args = codexExecArgs({
      model: "gpt-5.5",
      reasoningEffort: "medium",
      permissionMode: "auto",
      cwd: "/vault",
      outputLastMessagePath: "/tmp/last.md",
    });

    expect(args).toEqual([
      "exec",
      "--color",
      "never",
      "--output-last-message",
      "/tmp/last.md",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "--cd",
      "/vault",
      "--model",
      "gpt-5.5",
      "--config",
      'model_reasoning_effort="medium"',
      "-",
    ]);
    expect(args).not.toContain("--full-auto");
    expect(args).not.toContain("workspace-write");
  });

  it("uses the bypass flag for yolo mode", () => {
    const args = codexExecArgs({ permissionMode: "yolo" });

    expect(args).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args).not.toContain("workspace-write");
  });

  it("maps review mode to workspace-write sandbox", () => {
    const args = codexExecArgs({ permissionMode: "review" });

    expect(args).toContain("--sandbox");
    expect(args).toContain("workspace-write");
  });
});

describe("resolveCodexCommand", () => {
  it("keeps an explicit absolute command path", () => {
    const exists = vi.fn(() => false);

    expect(resolveCodexCommand("/custom/codex", undefined, exists)).toBe("/custom/codex");
    expect(exists).not.toHaveBeenCalled();
  });

  it("chooses the first existing fallback candidate", () => {
    const exists = (path: string) => path === "/opt/homebrew/bin/codex";

    expect(resolveCodexCommand("codex", [
      "/missing/codex",
      "/opt/homebrew/bin/codex",
      "codex",
    ], exists)).toBe("/opt/homebrew/bin/codex");
  });

  it("returns codex when no candidate exists", () => {
    expect(resolveCodexCommand(undefined, ["/missing/codex", "codex"], () => false)).toBe("codex");
  });
});

describe("environment handling", () => {
  const originalPath = process.env.PATH;
  const originalLawOc = process.env.DART_API_KEY;

  afterEach(() => {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    if (originalLawOc === undefined) {
      delete process.env.DART_API_KEY;
    } else {
      process.env.DART_API_KEY = originalLawOc;
    }
  });

  it("parses newline separated KEY=VALUE entries", () => {
    expect(parseEnvironmentVariables([
      "CODEX_HOME=/tmp/codex",
      "DART_API_KEY=test-oc-key",
      "# ignored",
      "PATH=/bin",
      "INVALID",
    ].join("\n"))).toEqual({
      CODEX_HOME: "/tmp/codex",
      DART_API_KEY: "test-oc-key",
      PATH: "/bin",
    });
  });

  it("builds an environment with CODEX_HOME default, parsed overrides, and command directory on PATH", () => {
    process.env.PATH = "/usr/bin";
    process.env.DART_API_KEY = "process-value";

    const env = buildCodexEnvironment("DART_API_KEY=test-oc-key", "/opt/homebrew/bin/codex");

    expect(env.CODEX_HOME).toMatch(/\.codex$/);
    expect(env.DART_API_KEY).toBe("test-oc-key");
    expect(env.PATH?.split(":")[0]).toBe("/opt/homebrew/bin");
    expect(env.PATH).toContain("/usr/bin");
  });

  it("adds Windows Node, npm, and command directories for desktop-launched Obsidian", () => {
    const env = buildCodexEnvironment("", "C:\\Users\\kim\\AppData\\Roaming\\npm\\codex.cmd", {
      platform: "win32",
      baseEnv: {
        Path: "C:\\Windows\\System32",
        ProgramFiles: "C:\\Program Files",
        "ProgramFiles(x86)": "C:\\Program Files (x86)",
        APPDATA: "C:\\Users\\kim\\AppData\\Roaming",
      },
    });

    const pathEntries = env.PATH?.split(";") ?? [];
    expect(pathEntries[0]).toBe("C:\\Users\\kim\\AppData\\Roaming\\npm");
    expect(pathEntries).toContain("C:\\Program Files\\nodejs");
    expect(pathEntries).toContain("C:\\Program Files (x86)\\nodejs");
    expect(pathEntries).toContain("C:\\Users\\kim\\AppData\\Roaming\\npm");
    expect(pathEntries).toContain("C:\\Windows\\System32");
  });

  it("loads vault .env before explicit plugin environment overrides", () => {
    const env = buildCodexEnvironment("DART_API_KEY=from-settings", "/usr/local/bin/codex", {
      cwd: "/vault",
      baseEnv: { PATH: "/usr/bin" },
      readFile: (path) => {
        expect(path).toBe("/vault/.env");
        return [
          "DART_API_KEY=from-dotenv",
          "DART_CACHE_DIR=/tmp/korean-dart-cache",
          'CODEX_HOME="/custom/codex-home"',
        ].join("\n");
      },
    });

    expect(env.DART_API_KEY).toBe("from-settings");
    expect(env.DART_CACHE_DIR).toBe("/tmp/korean-dart-cache");
    expect(env.CODEX_HOME).toBe("/custom/codex-home");
  });
});

describe("spawn planning", () => {
  it("uses a Windows shell for npm command shims and extensionless commands", () => {
    expect(createCodexSpawnPlan("C:\\Users\\kim\\AppData\\Roaming\\npm\\codex.cmd", ["exec"], "win32")).toEqual({
      command: "C:\\Users\\kim\\AppData\\Roaming\\npm\\codex.cmd",
      args: ["exec"],
      shell: true,
    });
    expect(createCodexSpawnPlan("codex", ["exec"], "win32").shell).toBe(true);
  });

  it("uses PowerShell for ps1 commands and preserves direct Unix execution", () => {
    expect(createCodexSpawnPlan("C:\\Tools\\codex.ps1", ["exec"], "win32")).toEqual({
      command: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\Tools\\codex.ps1", "exec"],
      shell: false,
    });
    expect(createCodexSpawnPlan("/opt/homebrew/bin/codex", ["exec"], "darwin")).toEqual({
      command: "/opt/homebrew/bin/codex",
      args: ["exec"],
      shell: false,
    });
  });
});

describe("subprocess decoding", () => {
  it("falls back to Windows-949 when Windows Korean stderr is not valid UTF-8", () => {
    const cp949 = Buffer.from([0xbe, 0xc8, 0xb3, 0xe7]);

    expect(decodeProcessChunk(cp949, "win32")).toBe("안녕");
  });
});
