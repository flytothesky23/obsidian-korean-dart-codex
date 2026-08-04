# Korean DART Codex

Korean DART Codex는 OpenAI Codex CLI와
[`korean-dart-mcp`](https://github.com/chrisryugj/korean-dart-mcp)를 연결해
한국 기업 공시·재무 리서치를 Obsidian 안에서 수행하고 결과를 구조화된
Markdown 노트로 저장하는 데스크톱 플러그인입니다.

검증된
[`obsidian-korean-law-codex`](https://github.com/flytothesky23/obsidian-korean-law-codex)
프레임워크를 기반으로 하며, 리서치 도메인과 MCP 계약을 OpenDART에 맞게
포팅했습니다.

## 주요 기능

- `codex app-server --listen stdio://` 기반 스트리밍 대화
- Codex CLI의 ChatGPT OAuth 로그인 재사용 (`codex login`)
- 전역 Codex 설정을 바꾸지 않는 `korean-dart-mcp@0.10.1` 자동 관리 모드
- Obsidian SecretStorage 기반 OpenDART API 키 설정
- `korean-dart` MCP 우선 공시·재무·XBRL·지분·첨부문서 조사
- MCP 서버 버전과 실제 `tools/list` 결과를 확인하는 상태 배지
- 대화 세션 유지, 취소, 모델·추론 강도 선택, `codex exec` 폴백
- 선택한 Obsidian 노트의 고정 스냅샷을 보조 컨텍스트로 사용
- 기업명·고유번호·접수번호·사용 도구를 기록하는 리서치 노트
- Mermaid, DataviewJS, 시각자료 생성/전달 워크플로
- BRAT용 GitHub Release 자동화

이 플러그인은 투자 자문이나 매매 추천 도구가 아닙니다. 중요한 수치와
판단은 원문 공시, 정정공시, 기준 기간, 단위, 연결/별도 재무제표를 다시
확인해야 합니다.

## 요구사항

- Obsidian Desktop 1.11.4 이상
- Node.js 20.19 이상
- OpenAI Codex CLI
- Codex의 ChatGPT OAuth 로그인 또는 지원되는 API 인증
- OpenDART API 인증키 (`DART_API_KEY`)
- 관리형 MCP를 내려받을 수 있는 npm 네트워크 또는 기존 Codex MCP 등록

`korean-dart-mcp`는 STDIO MCP 서버이며 OpenDART 인증에
`DART_API_KEY`를 사용합니다. Codex 로그인 토큰과 OpenDART 키는 서로 다른
자격 증명입니다. 플러그인은 OAuth 토큰을 직접 저장하지 않고 로컬 Codex
CLI 세션을 사용합니다.

## 설치

### 1. Codex CLI와 OAuth 로그인

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
codex login
codex login status
```

대체 설치 방법:

```bash
npm install -g @openai/codex
# 또는 macOS
brew install --cask codex
```

### 2. OpenDART API 키와 Korean DART MCP

OpenDART에서 무료 인증키를 발급한 뒤 Obsidian의
`설정 → Korean DART Codex → OpenDART API key`에 입력합니다. 입력란은
마스킹되며 값은 일반 플러그인 `data.json`이 아니라 Obsidian
SecretStorage에 저장됩니다. 패널 로그와 진단 메시지에서는 키를
가림 처리합니다.

패널의 `MCP x.y.z` 배지는 서버 초기화와 도구 목록을 확인한 결과입니다.
OpenDART가 키를 실제로 승인하는지는 첫 데이터 조회에서 검증되며, 오류
`100`이 나오면 발급 페이지의 승인 상태와 입력값을 다시 확인합니다.

기본 `Korean DART MCP` 설정은 `Managed automatically`입니다. 플러그인은
Codex app-server와 exec를 시작할 때 아래 고정 서버 정의를 해당 프로세스에만
주입합니다. 키 값 자체는 명령행에 넣지 않고 Codex의 MCP 환경변수 allowlist로
`DART_API_KEY` 이름만 전달합니다.

```text
npx -y korean-dart-mcp@0.10.1
```

따라서 전역 `~/.codex/config.toml`을 수정하거나 `codex mcp add`를 먼저
실행할 필요가 없습니다. 첫 실행은 npm 패키지를 확인하므로 네트워크 상태에
따라 조금 더 걸릴 수 있습니다.

기존에 직접 관리하는 MCP를 사용하려면 `Korean DART MCP`를
`Use existing Codex MCP config`로 바꾸고 아래처럼 이름을 정확히
`korean-dart`로 등록합니다.

`~/.codex/config.toml` 또는 Windows의
`%USERPROFILE%\.codex\config.toml`에 다음을 추가합니다.

```toml
[mcp_servers.korean-dart]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/node_modules/korean-dart-mcp/build/index.js"]
env_vars = ["DART_API_KEY"]
startup_timeout_sec = 30
tool_timeout_sec = 180
```

간단한 등록 명령도 사용할 수 있습니다.

```bash
codex mcp add korean-dart -- npx -y korean-dart-mcp@0.10.1
```

기존 Codex config 모드에서 플러그인의 마스킹 키 설정을 사용하려면 위처럼
`env_vars = ["DART_API_KEY"]` allowlist가 필요합니다. 키 값을 셸 명령 인수,
Codex config 또는 Git 저장소에 직접 남기지 마세요.

확인:

```bash
codex mcp list
codex mcp get korean-dart --json
```

### 3. BRAT으로 플러그인 설치

1. Obsidian에서 BRAT 커뮤니티 플러그인을 설치합니다.
2. `Add Beta plugin`을 선택합니다.
3. 아래 저장소 URL을 입력합니다.

   ```text
   https://github.com/flytothesky23/obsidian-korean-dart-codex
   ```

4. `Korean DART Codex`를 활성화합니다.
5. 명령 팔레트에서 `Open Korean DART Codex panel`을 실행합니다.

BRAT 배포에는 GitHub Release의 `main.js`, `manifest.json`, `styles.css`,
`versions.json`이 사용됩니다.

## 사용 흐름

패널에서 한국어로 질문하면 플러그인은 Codex app-server 스레드를 시작하고,
Codex가 `korean-dart` MCP의 현재 도구 목록에서 필요한 도구를 호출하도록
지시합니다. 예시:

```text
삼성전자 최근 3년 매출·영업이익·ROE 흐름과 주요 공시 리스크를 정리해줘.
카카오 최근 3년 정정공시 비율과 자본 이벤트를 타임라인으로 보여줘.
삼성전자와 SK하이닉스의 최근 5년 재무 품질을 공시 근거와 함께 비교해줘.
```

완료된 응답은 별도 리서치 노트로 저장할 수 있습니다. 기본 저장 위치는
`00_수집함/DART Research`이며 원본 노트는 자동 수정하지 않습니다.

## App-server와 OAuth

플러그인은 아래 로컬 프로세스를 시작합니다.

```text
Obsidian plugin -> codex app-server (stdio) -> signed-in Codex -> korean-dart MCP -> OpenDART
```

Codex CLI에 ChatGPT OAuth로 로그인되어 있으면 동일한 로컬 인증 세션이
app-server에서도 사용됩니다. 플러그인은 OAuth 웹 흐름이나 토큰 저장소를
별도로 구현하지 않습니다.

app-server 초기화 또는 스레드 시작이 실패하면 설정에 따라 `codex exec`로
폴백합니다. 두 경로는 동일한 MCP 우선 프롬프트와 vault-context 계약을
사용합니다.

## Vault 컨텍스트와 개인정보

- 컨텍스트 선택기는 전체 vault를 즉시 읽지 않습니다.
- 현재 노트 또는 사용자가 고른 노트만 고정 스냅샷으로 전달합니다.
- 전체 인덱스는 검색·폴더·관련 노트 기능을 사용할 때 지연 생성됩니다.
- 인덱스는 메모리에만 유지되며 임베딩 API를 사용하지 않습니다.
- 노트 안의 지시문은 데이터로 취급하며 공시 사실은 MCP로 재확인합니다.
- 저장 노트에는 경로·해시·stale/truncated 상태만 기록하고 원문 컨텍스트를
  frontmatter에 복사하지 않습니다.

## 개발

```bash
npm ci
npm test
npm run typecheck
npm run build
npm run release:check
```

통합 검증:

```bash
npm run smoke:mcp:appserver
npm run smoke:mcp:health
npm run smoke:mcp:contract
npm run smoke:dart:appserver
npm run smoke:models:appserver
```

`smoke:mcp:appserver`는 관리형 설정이 실제 Codex app-server 안에서
`korean-dart` 도구를 노출하는지 확인합니다. `smoke:mcp:health`는 패널 상태
배지와 같은 직접 MCP 건강검사입니다. `smoke:mcp:contract`는 API 키 없이
upstream 서버의 초기화와 도구 계약만 검증합니다. 실제 OpenDART 호출은
유효한 키를 설정한 뒤 `npm run smoke:mcp:live`로 삼성전자 기업개황 응답까지
확인합니다.

## Upstream 주의사항

- 현재 upstream 소스는 README의 15개보다 많은 도구를 등록할 수 있으므로
  플러그인은 도구 수를 하드코딩하지 않고 `tools/list`를 사용합니다.
- `better-sqlite3` 네이티브 의존성이 있어 Node/플랫폼 호환성이 필요합니다.
- 최초 기업코드 캐시는 기본적으로 `~/.korean-dart-mcp`에 생성될 수 있습니다.
- 첨부문서 추출은 사용자가 지정한 개별 공시에 한정하고 대량 수집에
  사용하지 마세요.

## 릴리스

태그 `v*`가 푸시되면 GitHub Actions가 테스트, 타입 검사, 빌드, 릴리스
메타데이터 검사를 실행하고 BRAT 자산을 GitHub Release에 첨부합니다.
자세한 내용은 [Release Guide](docs/releasing.md)를 참고하세요.

## License

MIT. `korean-dart-mcp` 역시 MIT 라이선스이며 별도 프로젝트입니다.
