import { describe, expect, it } from "vitest";
import {
  KOREA_STOCK_SERVER_DEFINITION,
  isApiAuthenticationFailure,
  parseCodexMcpConfig,
  parseCodexMcpConfigForServer,
  parseMcpHealth,
  parseMcpHealthForServer,
  summarizeMcpStatusError,
} from "../src/codex-mcp-status";

describe("Korean DART MCP health", () => {
  it("parses the stdio server configuration used by Codex", () => {
    const config = parseCodexMcpConfig(JSON.stringify({
      name: "korean-dart",
      enabled: true,
      transport: {
        type: "stdio",
        command: "sh",
        args: ["-lc", "exec node build/index.js"],
        env: { SAFE_OPTION: "value" },
        cwd: "/example/mcp",
      },
    }));

    expect(config).toEqual({
      enabled: true,
      command: "sh",
      args: ["-lc", "exec node build/index.js"],
      cwd: "/example/mcp",
      env: { SAFE_OPTION: "value" },
    });
  });

  it("ignores non-stdio and unrelated MCP entries", () => {
    expect(parseCodexMcpConfig(JSON.stringify({
      name: "other-server",
      transport: { type: "stdio", command: "node" },
    }))).toBeNull();
    expect(parseCodexMcpConfig(JSON.stringify({
      name: "korean-dart",
      transport: { type: "streamable-http", url: "https://example.test" },
    }))).toBeNull();
  });

  it("parses the stdio server configuration for korea-stock", () => {
    const config = parseCodexMcpConfigForServer(JSON.stringify({
      name: "korea-stock",
      enabled: true,
      transport: {
        type: "stdio",
        command: "npx",
        args: ["-y", "korea-stock-mcp@1.4.1"],
        env: { KRX_API_KEY: "from-config" },
      },
    }), "korea-stock");

    expect(config).toEqual({
      enabled: true,
      command: "npx",
      args: ["-y", "korea-stock-mcp@1.4.1"],
      cwd: null,
      env: { KRX_API_KEY: "from-config" },
    });
  });

  it("reports the initialized server version and exposed tool count", () => {
    const status = parseMcpHealth({
      serverInfo: { name: "korean-dart-mcp", version: "0.9.2" },
    }, {
      tools: [{ name: "search_disclosures" }, { name: "get_financials" }],
    }, "managed");

    expect(status).toMatchObject({
      state: "ready",
      name: "korean-dart-mcp",
      version: "0.9.2",
      toolCount: 2,
      authStatus: "configured",
      source: "managed",
      error: "",
    });
  });

  it("reports an initialization response that has no server version", () => {
    const status = parseMcpHealth({ serverInfo: { name: "korean-dart-mcp" } }, { tools: [] });

    expect(status).toMatchObject({
      state: "failed",
      version: "",
      error: "korean-dart MCP가 초기화 응답에 버전 정보를 제공하지 않았습니다.",
    });
  });

  it("requires the expected korea-stock stock tools", () => {
    const status = parseMcpHealthForServer({
      serverInfo: { name: "korea-stock-mcp", version: "1.4.1" },
    }, {
      tools: [{ name: "get_stock_base_info" }, { name: "get_stock_trade_info" }],
    }, KOREA_STOCK_SERVER_DEFINITION, "managed");

    expect(status).toMatchObject({
      state: "ready",
      name: "korea-stock-mcp",
      version: "1.4.1",
      toolCount: 2,
      authStatus: "configured",
      source: "managed",
      serverId: "korea-stock",
    });
  });

  it("fails korea-stock health when a required tool is absent", () => {
    const status = parseMcpHealthForServer({
      serverInfo: { name: "korea-stock-mcp", version: "1.4.1" },
    }, {
      tools: [{ name: "get_stock_base_info" }],
    }, KOREA_STOCK_SERVER_DEFINITION);

    expect(status).toMatchObject({
      state: "failed",
      serverId: "korea-stock",
      error: "korea-stock MCP 필수 도구를 찾지 못했습니다: get_stock_trade_info",
    });
  });

  it("redacts credentials from connection diagnostics", () => {
    const message = summarizeMcpStatusError(
      "Bearer secret-token DART_API_KEY=private-value KRX_API_KEY=krx-private token:another-value gho_examplecredential",
    );

    expect(message).toBe("Bearer [redacted] DART_API_KEY=[redacted] KRX_API_KEY=[redacted] token:[redacted] [redacted]");
    expect(message).not.toContain("secret-token");
    expect(message).not.toContain("private-value");
    expect(message).not.toContain("krx-private");
  });

  it("distinguishes authentication rejection from temporary API failures", () => {
    expect(isApiAuthenticationFailure("401 Unauthorized")).toBe(true);
    expect(isApiAuthenticationFailure("사용자 정보 검증 실패")).toBe(true);
    expect(isApiAuthenticationFailure("KRX API 오류: 기준일 자료를 조회할 수 없습니다")).toBe(false);
    expect(isApiAuthenticationFailure("fetch failed: socket timeout")).toBe(false);
  });
});
