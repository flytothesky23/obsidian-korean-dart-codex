# Korean DART Codex

Korean DART Codex는 OpenAI Codex CLI에
[`korean-dart-mcp`](https://github.com/chrisryugj/korean-dart-mcp)와
[`korea-stock-mcp`](https://github.com/jjlabsio/korea-stock-mcp)를 연결해
한국 기업 공시·재무자료와 한국거래소(KRX) 일별 시세를 한 패널에서 조사하고,
결과를 출처가 구분된 Markdown 노트로 저장하는 데스크톱 플러그인입니다.

검증된
[`obsidian-korean-law-codex`](https://github.com/flytothesky23/obsidian-korean-law-codex)
프레임워크를 기반으로 하며, 리서치 도메인과 MCP 계약을 OpenDART에 맞게
포팅했습니다. DART는 공시 원문과 재무 근거, KRX는 기준일별 종목 기본정보와
거래정보를 담당하도록 역할을 분리했습니다.

## 주요 기능

- `codex app-server --listen stdio://` 기반 스트리밍 대화
- Codex CLI의 ChatGPT OAuth 로그인 재사용 (`codex login`)
- 전역 Codex 설정을 바꾸지 않는 `korean-dart-mcp@0.10.1` 자동 관리 모드
- `korea-stock-mcp@1.4.1`의 KRX 기능을 함께 실행하는 자동 관리 모드
- 상태 배지 왼쪽의 DART/KRX 탭으로 리서치 우선 영역 전환
- Obsidian SecretStorage 기반 OpenDART·KRX API 키 설정
- `korean-dart` MCP 우선 공시·재무·XBRL·지분·첨부문서 조사
- `korea-stock` MCP의 일별 종목 기본정보·종가·등락·거래량·거래대금·시가총액 조사
- KRX 서버는 두 시장 도구만 모델에 노출하고 중복 DART 도구는 설정 단계에서 차단
- MCP 서버 버전과 실제 `tools/list` 결과를 확인하는 상태 배지
- 대화 세션 유지, 취소, 모델·추론 강도 선택, `codex exec` 폴백
- 선택한 Obsidian 노트의 고정 스냅샷을 보조 컨텍스트로 사용
- 기업명·고유번호·접수번호·사용 도구를 기록하는 리서치 노트
- Mermaid, DataviewJS, 시각자료 생성/전달 워크플로
- BRAT용 GitHub Release 자동화

이 플러그인은 투자 자문이나 매매 추천 도구가 아닙니다. 중요한 수치와
판단은 원문 공시·정정공시와 KRX 기준일·시장·종목코드를 다시 확인해야
합니다. KRX 결과는 일별 통계정보이며 실시간 호가나 주문장 데이터가 아닙니다.

## 요구사항

- Obsidian Desktop 1.11.4 이상
- Node.js 20.19 이상
- OpenAI Codex CLI
- Codex의 ChatGPT OAuth 로그인 또는 지원되는 API 인증
- OpenDART API 인증키 (`DART_API_KEY`)
- KRX Open API 인증키 (`KRX_API_KEY`, KRX 탭 사용 시)
- 관리형 MCP를 내려받을 수 있는 npm 네트워크 또는 기존 Codex MCP 등록

두 MCP는 로컬 STDIO 서버입니다. Codex 로그인 토큰, OpenDART 키, KRX 키는
서로 다른 자격 증명이며 플러그인은 OAuth 토큰을 직접 저장하지 않습니다.
OpenDART·KRX 키의 주된 역할은 호출 주체 식별과 호출량 관리이며, 결제수단이나
Codex 계정 권한을 부여하는 토큰이 아닙니다. 다만 공개 저장소에 키를 올리면 다른
사용자가 해당 호출 한도를 소모할 수 있으므로 로컬 SecretStorage에 보관합니다.
API 키는 각각의 MCP 프로세스에만 전달됩니다.

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

### 2. OpenDART·KRX API 키와 관리형 MCP

OpenDART에서 무료 인증키를 발급한 뒤 Obsidian의
`설정 → Korean DART Codex → OpenDART API key`에 입력합니다. 입력란은
마스킹되며 값은 일반 플러그인 `data.json`이 아니라 Obsidian
SecretStorage에 저장됩니다. 패널 로그와 진단 메시지에서는 키를
가림 처리합니다.

패널의 초록색 `MCP x.y.z` 배지는 서버 초기화와 도구 목록뿐 아니라 최소 공식
API 조회까지 성공한 결과입니다. MCP 프로세스만 준비되고 OpenDART·KRX가 키나
서비스 이용을 거부하면 초록색 대신 `API 승인 확인` 상태를 표시합니다. 인증은
통과했지만 공식 API가 일시적으로 응답하지 않으면 `API 오류`로 따로 구분합니다.

기본 `Korean DART MCP` 설정은 `Managed automatically`입니다. 플러그인은
Codex app-server와 exec를 시작할 때 아래 고정 패키지를 로컬 캐시에 설치한 뒤
Node로 직접 실행합니다. 키 값 자체는 명령행이나 npm 프로세스 제목에 넣지 않고
Codex의 MCP 환경변수 allowlist로 `DART_API_KEY` 이름만 전달합니다.

고정 패키지 사양: `korean-dart-mcp@0.10.1`

KRX 탭을 사용하려면 KRX Open API 포털에서 인증키와 필요한 통계 서비스를
승인받은 뒤 `OpenDART API key` 바로 아래의 `KRX API key`에 입력합니다.
같은 방식으로 마스킹·SecretStorage 저장되며, 값 변경 시 MCP 런타임이 즉시
재시작되어 Obsidian을 다시 로드할 필요가 없습니다.

고정 패키지 사양: `korea-stock-mcp@1.4.1`

관리형 KRX 서버는 Codex의 `enabled_tools` 계약으로 아래 두 도구만 노출합니다.

- `get_stock_base_info`: 기준일·시장·종목코드별 종목 기본정보
- `get_stock_trade_info`: 기준일·시장·종목코드별 일별 거래정보

두 도구 모두 조회할 종목코드 목록이 필요합니다. 따라서 지정 종목이나 사용자가
제시한 종목군의 가격·거래량·시가총액 비교는 가능하지만, 코스피 전체에서 그날의
시가총액 상위 10개를 먼저 발굴하는 시장순위 기능은 현재 공개 도구 계약에
포함되지 않습니다. 이 경우 플러그인은 임의 종목을 상위 10개로 추정하지 않습니다.

`korea-stock-mcp`가 함께 제공하는 DART 도구는 노출하지 않습니다. 기업 식별,
공시, 재무자료는 기존 `korean-dart` 서버가 계속 담당합니다. 또한 KRX MCP는
vault와 분리된 임시 작업 폴더에서 실행되어 vault `.env`가 마스킹 설정값을
덮어쓰지 않습니다.

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

KRX 서버를 직접 관리하려면 이름을 `korea-stock`으로 두고 다음 계약을
사용합니다.

```toml
[mcp_servers.korea-stock]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/node_modules/korea-stock-mcp/dist/index.js"]
env_vars = ["KRX_API_KEY"]
enabled_tools = ["get_stock_base_info", "get_stock_trade_info"]
startup_timeout_sec = 30
tool_timeout_sec = 180
```

확인:

```bash
codex mcp list
codex mcp get korean-dart --json
codex mcp get korea-stock --json
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

패널 상단의 DART/KRX 탭은 현재 질문의 우선 데이터 영역입니다. 탭을 바꿔도
대화 내용은 유지되며, 실행 중에는 기준이 섞이지 않도록 전환 버튼이 잠깁니다.

**DART 탭**은 공시 원문·재무·XBRL·지분·첨부문서 중심입니다.

```text
삼성전자 최근 3년 매출·영업이익·ROE 흐름과 주요 공시 리스크를 정리해줘.
카카오 최근 3년 정정공시 비율과 자본 이벤트를 타임라인으로 보여줘.
삼성전자와 SK하이닉스의 최근 5년 재무 품질을 공시 근거와 함께 비교해줘.
```

**KRX 탭**은 기준일별 일별 시장 데이터 중심입니다.

```text
삼성전자 최근 5거래일 종가·등락률·거래량·시가총액 흐름을 표로 비교해줘.
삼성전자와 SK하이닉스의 2026-08-03 거래대금과 시가총액을 비교해줘.
최근 유상증자 공시 전후 5거래일의 일별 가격·거래량 변화를 함께 설명해줘.
```

마지막 예처럼 공시와 시세가 함께 필요한 질문은 두 MCP를 함께 쓰되, 응답과
저장 노트에서 OpenDART 공시 사실과 KRX 거래 데이터·기준일을 구분합니다. 지난
거래일의 종가와 거래량은 예측값이 아니라 장 마감 후 확정된 과거 데이터이며,
당일 값만 KRX 일별 자료 게시 전까지 미완료이거나 제공되지 않을 수 있습니다.

완료된 응답은 별도 리서치 노트로 저장할 수 있습니다. 기본 저장 위치는
`00_수집함/DART Research`이며 원본 노트는 자동 수정하지 않습니다.

## App-server와 OAuth

플러그인은 아래 로컬 프로세스를 시작합니다.

```text
Obsidian plugin -> codex app-server (stdio) -> signed-in Codex
  -> korean-dart MCP -> OpenDART
  -> korea-stock MCP (2 allowed tools) -> KRX Open API
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
`korean-dart` 18개 도구와 허용된 `korea-stock` 2개 도구만 노출하는지
확인합니다. `smoke:mcp:health`는 패널 상태
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
- `korea-stock-mcp@1.4.1`은 MCP 런타임에서 버전을 `1.0.0`으로 보고하므로
  패널 배지에는 `1.0.0`이 표시될 수 있습니다. 설치 기준은 고정 npm 버전
  `1.4.1`입니다.
- KRX 도구 입력은 `basDdList`, `market`(`KOSPI`/`KOSDAQ`/`KONEX`),
  `codeList`가 필요합니다. 데이터는 일별 통계이며 실시간 호가가 아닙니다.

## 릴리스

태그 `v*`가 푸시되면 GitHub Actions가 테스트, 타입 검사, 빌드, 릴리스
메타데이터 검사를 실행하고 BRAT 자산을 GitHub Release에 첨부합니다.
자세한 내용은 [Release Guide](docs/releasing.md)를 참고하세요.

## License

MIT. `korean-dart-mcp`는 MIT, `korea-stock-mcp`는 ISC 라이선스의 별도
프로젝트이며 이 플러그인은 고정 npm 패키지를 로컬 subprocess로 실행합니다.
