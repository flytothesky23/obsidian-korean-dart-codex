# Changelog

All notable changes to Korean DART Codex are documented here.

## 0.2.0 - 2026-08-05

- Added a DART/KRX segmented control beside the MCP status badge. The selected
  tab changes the workspace subtitle, welcome state, composer example, research
  priority, status badge, and saved-note metadata.
- Added managed `korea-stock-mcp@1.4.1` integration for KRX daily stock base and
  trade data while keeping `korean-dart-mcp@0.10.1` authoritative for every
  disclosure and financial-data workflow.
- Restricted the `korea-stock` server at Codex configuration level to
  `get_stock_base_info` and `get_stock_trade_info`, so its overlapping DART tools
  are not exposed to the model.
- Added a masked KRX API key field directly below the OpenDART key. Both values
  stay in Obsidian SecretStorage and are injected only into their local MCP
  subprocesses; changing a key now restarts the runtime without requiring an
  Obsidian reload.
- Isolated the upstream KRX MCP working directory so a vault `.env` cannot
  override the SecretStorage value through the package's dotenv behavior.
- Added KRX source, trading-date, mode, tool, and tag metadata to saved notes,
  plus DART/KRX status, prompt, UI, and app-server contract tests.
- Described prior-session closing prices and volumes as finalized historical data,
  reserving incomplete/unavailable wording for the current session before KRX
  publishes its official daily record.
- Expanded MCP smoke coverage to verify 18 DART tools and exactly two exposed
  KRX tools through the real Codex app-server.
- Changed the green status contract so it requires a successful minimal official
  API probe; a running MCP whose upstream API returns 401 now shows an API
  approval state, while temporary official API failures show an API error,
  instead of either case appearing connected-ready.
- Replaced direct managed `npx` execution with a generated local Node launcher
  that installs pinned packages with API keys removed from npm's environment,
  then starts the MCP with credentials confined to its runtime environment.
- Documented that the audited KRX tools compare known stock codes but do not
  independently discover a market-cap top-ten universe.
- Clarified that KRX key issuance and per-market API product approval are
  separate setup steps. After the required KOSPI base/trade approvals were
  activated, direct official API calls, both allowed MCP tools, the green
  status probe, and an Obsidian dated-market-data question were verified live.

## 0.1.1 - 2026-08-04

- Replaced the inherited law-scale branding with a stock candlestick chart in
  the ribbon, view tab, panel header, and welcome state.
- Added a managed `korean-dart-mcp@0.10.1` mode that injects the MCP definition
  into Codex app-server and exec processes without modifying global Codex
  configuration.
- Added a masked OpenDART API key setting backed by Obsidian SecretStorage and
  automatic migration from legacy `DART_API_KEY` environment text.
- Kept the SecretStorage value launch-only when panel model or reasoning choices
  are copied into persistent custom runtime settings, while migrating a legacy
  Codexian environment-only key into SecretStorage during that transition.
- Forwarded only the `DART_API_KEY` variable name through Codex's managed MCP
  environment allowlist so app-server tool sessions receive the stored key
  without placing the value in CLI arguments.
- Added an app-server inventory smoke test that verifies the managed server is
  loaded with 18 exposed tools, separately from the direct MCP health check.
- Distinguished a missing API key from a missing or failed MCP server in the
  panel status badge.

## 0.1.0 - 2026-08-04

- Initial public release based on the proven Korean Law Codex app-server framework.
- Added Codex CLI ChatGPT OAuth integration through `codex app-server`, with
  streamed turns, persisted conversations, model discovery, cancellation, and
  `codex exec` fallback.
- Added MCP-first Korean corporate-disclosure research through
  `korean-dart-mcp`, including live configuration and tool-inventory health
  checks.
- Added source-grounded DART prompts, structured research-note frontmatter,
  vault context snapshots, Mermaid and DataviewJS helpers, and visual-asset
  handoff.
- Added BRAT-compatible release automation and regression coverage for the
  app-server transport, MCP approvals, note generation, context handling, and
  release metadata.
