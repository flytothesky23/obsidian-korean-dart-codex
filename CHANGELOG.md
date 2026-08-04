# Changelog

All notable changes to Korean DART Codex are documented here.

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
