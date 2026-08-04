# Agent Installation Prompts

## Korean

```text
Korean DART Codex를 현재 Obsidian vault에 설치하고 검증하라.

입력:
- PLUGIN_REPO=https://github.com/flytothesky23/obsidian-korean-dart-codex
- OBSIDIAN_VAULT=<vault absolute path>
- DART_API_KEY=<OpenDART API key; 로그나 Git에 출력하지 말 것>

목표 구조:
Obsidian Korean DART Codex -> Codex CLI app-server -> korean-dart MCP -> OpenDART.

1. Node.js 20.19+, Codex CLI, `codex login status`를 확인한다.
2. 플러그인의 기본 `Managed automatically` 모드가
   `korean-dart-mcp@0.10.1`과 `DART_API_KEY` 이름 allowlist를 app-server
   프로세스에 주입하는지 확인한다. 키 값은 CLI 인수에 넣지 않는다.
3. `DART_API_KEY`는 Obsidian SecretStorage 기반 마스킹 설정에 입력한다.
4. 직접 MCP initialize/tools/list와 Codex app-server의
   `mcpServerStatus/list` 도구 인벤토리를 각각 검증한다. 기존 Codex 설정
   모드를 선택한 경우에만 `codex mcp get korean-dart --json`도 확인한다.
5. 저장소를 빌드하고 `main.js`, `manifest.json`, `styles.css`를
   `<vault>/.obsidian/plugins/korean-dart-codex`에 배포한다.
6. Obsidian에서 플러그인을 활성화하고 app-server 스트리밍, MCP 상태 배지,
   저장 노트 frontmatter를 확인한다.
7. 비밀값을 출력하거나 소스/커밋에 남기지 않는다.
```

## English

```text
Install and verify Korean DART Codex in the current Obsidian vault.

Inputs:
- PLUGIN_REPO=https://github.com/flytothesky23/obsidian-korean-dart-codex
- OBSIDIAN_VAULT=<absolute vault path>
- DART_API_KEY=<OpenDART API key; never print or commit it>

Target flow:
Obsidian Korean DART Codex -> Codex CLI app-server -> korean-dart MCP -> OpenDART.

Verify Node.js 20.19+, Codex login, managed korean-dart-mcp@0.10.1 injection,
the DART_API_KEY name-only allowlist, SecretStorage-backed API-key
configuration, direct MCP initialize/tools/list, Codex app-server MCP inventory,
plugin build artifacts, streaming, the MCP health badge, and saved-note
metadata. Do not expose credentials or place the key value in CLI arguments.
```
