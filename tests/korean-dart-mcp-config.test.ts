import { describe, expect, it } from "vitest";
import {
  applyKoreanDartMcpConfig,
  extractDartApiKey,
  hasDartApiKey,
  KOREAN_DART_MCP_PACKAGE,
  managedKoreanDartMcpConfig,
  mergeDartApiKey,
  prepareDartRuntimeForPersistence,
} from "../src/korean-dart-mcp-config";

describe("managed Korean DART MCP configuration", () => {
  it("injects a pinned korean-dart server into app-server arguments", () => {
    expect(applyKoreanDartMcpConfig(["app-server", "--listen", "stdio://"])).toEqual([
      "--config",
      'mcp_servers.korean-dart.command="npx"',
      "--config",
      `mcp_servers.korean-dart.args=["-y","${KOREAN_DART_MCP_PACKAGE}"]`,
      "--config",
      'mcp_servers.korean-dart.env_vars=["DART_API_KEY"]',
      "app-server",
      "--listen",
      "stdio://",
    ]);
  });

  it("keeps exec first for the shared codexian wrapper", () => {
    const args = applyKoreanDartMcpConfig(["exec", "--color", "never"]);

    expect(args[0]).toBe("exec");
    expect(args.slice(1, 7)).toEqual([
      "--config",
      'mcp_servers.korean-dart.command="npx"',
      "--config",
      `mcp_servers.korean-dart.args=["-y","${KOREAN_DART_MCP_PACKAGE}"]`,
      "--config",
      'mcp_servers.korean-dart.env_vars=["DART_API_KEY"]',
    ]);
  });

  it("leaves Codex-config mode untouched", () => {
    const original = ["app-server", "--listen", "stdio://"];
    expect(applyKoreanDartMcpConfig(original, "codex-config")).toEqual(original);
  });

  it("uses the pinned npm package for direct health checks", () => {
    expect(managedKoreanDartMcpConfig()).toEqual({
      command: "npx",
      args: ["-y", "korean-dart-mcp@0.10.1"],
      cwd: null,
      env: {},
    });
  });
});

describe("OpenDART secret handling", () => {
  it("injects the SecretStorage value without retaining legacy duplicates", () => {
    expect(mergeDartApiKey([
      "PATH=/usr/bin",
      "DART_API_KEY=legacy-value",
      "SAFE_OPTION=yes",
    ].join("\n"), "secret-storage-value")).toBe([
      "PATH=/usr/bin",
      "SAFE_OPTION=yes",
      "DART_API_KEY=secret-storage-value",
    ].join("\n"));
  });

  it("extracts a legacy key for one-time SecretStorage migration", () => {
    expect(extractDartApiKey([
      "HOME=/example",
      'export DART_API_KEY="legacy-secret"',
      "PATH=/usr/bin",
    ].join("\n"))).toEqual({
      dartApiKey: "legacy-secret",
      environmentVariables: "HOME=/example\nPATH=/usr/bin",
    });
  });

  it("removes the launch-only SecretStorage value before runtime settings are persisted", () => {
    const launched = mergeDartApiKey("SAFE_OPTION=yes", "secret-storage-value");

    expect(prepareDartRuntimeForPersistence(launched, "secret-storage-value")).toEqual({
      environmentVariables: "SAFE_OPTION=yes",
      dartApiKeyToStore: "",
    });
  });

  it("migrates a Codexian env-only key into SecretStorage during custom runtime transition", () => {
    expect(prepareDartRuntimeForPersistence([
      "SAFE_OPTION=yes",
      "DART_API_KEY=codexian-env-only-value",
    ].join("\n"), "")).toEqual({
      environmentVariables: "SAFE_OPTION=yes",
      dartApiKeyToStore: "codexian-env-only-value",
    });
  });

  it("detects the key case-insensitively without inspecting its value", () => {
    expect(hasDartApiKey({ dart_api_key: "configured" })).toBe(true);
    expect(hasDartApiKey({ DART_API_KEY: "" })).toBe(false);
  });
});
