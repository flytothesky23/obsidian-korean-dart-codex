import { describe, expect, it } from "vitest";
import {
  applyKoreaStockMcpConfig,
  extractKrxApiKey,
  hasKrxApiKey,
  koreaStockMcpWorkingDirectory,
  KOREA_STOCK_MCP_PACKAGE,
  managedKoreaStockMcpConfig,
  mergeKrxApiKey,
  prepareKrxRuntimeForPersistence,
} from "../src/korea-stock-mcp-config";

describe("managed Korea Stock MCP configuration", () => {
  it("injects a pinned korea-stock server into app-server arguments", () => {
    const managed = managedKoreaStockMcpConfig();
    expect(applyKoreaStockMcpConfig(["app-server", "--listen", "stdio://"])).toEqual([
      "--config",
      `mcp_servers.korea-stock.command=${JSON.stringify(managed.command)}`,
      "--config",
      `mcp_servers.korea-stock.args=${JSON.stringify(managed.args)}`,
      "--config",
      'mcp_servers.korea-stock.env_vars=["KRX_API_KEY"]',
      "--config",
      'mcp_servers.korea-stock.enabled_tools=["get_stock_base_info","get_stock_trade_info"]',
      "--config",
      `mcp_servers.korea-stock.cwd=${JSON.stringify(koreaStockMcpWorkingDirectory())}`,
      "app-server",
      "--listen",
      "stdio://",
    ]);
  });

  it("keeps exec first for the shared codexian wrapper", () => {
    const managed = managedKoreaStockMcpConfig();
    const args = applyKoreaStockMcpConfig(["exec", "--color", "never"]);

    expect(args[0]).toBe("exec");
    expect(args.slice(1, 11)).toEqual([
      "--config",
      `mcp_servers.korea-stock.command=${JSON.stringify(managed.command)}`,
      "--config",
      `mcp_servers.korea-stock.args=${JSON.stringify(managed.args)}`,
      "--config",
      'mcp_servers.korea-stock.env_vars=["KRX_API_KEY"]',
      "--config",
      'mcp_servers.korea-stock.enabled_tools=["get_stock_base_info","get_stock_trade_info"]',
      "--config",
      `mcp_servers.korea-stock.cwd=${JSON.stringify(koreaStockMcpWorkingDirectory())}`,
    ]);
  });

  it("leaves Codex-config mode untouched", () => {
    const original = ["app-server", "--listen", "stdio://"];
    expect(applyKoreaStockMcpConfig(original, "codex-config")).toEqual(original);
  });

  it("uses the pinned npm package for direct health checks", () => {
    const managed = managedKoreaStockMcpConfig();
    expect(managed.command).toBe("node");
    expect(managed.args.slice(-3)).toEqual([KOREA_STOCK_MCP_PACKAGE, "korea-stock-mcp", "korea-stock-mcp"]);
    expect(managed.cwd).toBe(koreaStockMcpWorkingDirectory());
    expect(managed.env).toEqual({});
  });
});

describe("KRX secret handling", () => {
  it("injects the SecretStorage value without retaining legacy duplicates", () => {
    expect(mergeKrxApiKey([
      "PATH=/usr/bin",
      "KRX_API_KEY=legacy-value",
      "SAFE_OPTION=yes",
    ].join("\n"), "secret-storage-value")).toBe([
      "PATH=/usr/bin",
      "SAFE_OPTION=yes",
      "KRX_API_KEY=secret-storage-value",
    ].join("\n"));
  });

  it("extracts a legacy key for one-time SecretStorage migration", () => {
    expect(extractKrxApiKey([
      "HOME=/example",
      "export KRX_API_KEY='legacy-secret'",
      "PATH=/usr/bin",
    ].join("\n"))).toEqual({
      krxApiKey: "legacy-secret",
      environmentVariables: "HOME=/example\nPATH=/usr/bin",
    });
  });

  it("removes the launch-only SecretStorage value before runtime settings are persisted", () => {
    const launched = mergeKrxApiKey("SAFE_OPTION=yes", "secret-storage-value");

    expect(prepareKrxRuntimeForPersistence(launched, "secret-storage-value")).toEqual({
      environmentVariables: "SAFE_OPTION=yes",
      krxApiKeyToStore: "",
    });
  });

  it("migrates an env-only key into SecretStorage during custom runtime transition", () => {
    expect(prepareKrxRuntimeForPersistence([
      "SAFE_OPTION=yes",
      "KRX_API_KEY=env-only-value",
    ].join("\n"), "")).toEqual({
      environmentVariables: "SAFE_OPTION=yes",
      krxApiKeyToStore: "env-only-value",
    });
  });

  it("detects the key case-insensitively without inspecting its value", () => {
    expect(hasKrxApiKey({ krx_api_key: "configured" })).toBe(true);
    expect(hasKrxApiKey({ KRX_API_KEY: "" })).toBe(false);
  });
});
