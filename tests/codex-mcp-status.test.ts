import { describe, expect, it } from "vitest";
import {
  parseCodexMcpConfig,
  parseMcpHealth,
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

  it("redacts credentials from connection diagnostics", () => {
    const message = summarizeMcpStatusError(
      "Bearer secret-token DART_API_KEY=private-value token:another-value gho_examplecredential",
    );

    expect(message).toBe("Bearer [redacted] DART_API_KEY=[redacted] token:[redacted] [redacted]");
    expect(message).not.toContain("secret-token");
    expect(message).not.toContain("private-value");
  });
});
