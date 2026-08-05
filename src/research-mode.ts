export type ResearchMode = "dart" | "krx";

export interface ResearchModePresentation {
  label: "DART" | "KRX";
  subtitle: string;
  statusLabel: string;
  welcomeTitle: string;
  placeholder: string;
  searchingText: string;
}

const PRESENTATIONS: Record<ResearchMode, ResearchModePresentation> = {
  dart: {
    label: "DART",
    subtitle: "DART RESEARCH WORKSPACE",
    statusLabel: "korean-dart",
    welcomeTitle: "원문 공시에서 시작하는 기업 리서치",
    placeholder: "예: 삼성전자 최근 3년 재무지표와 주요 공시 리스크를 정리해줘",
    searchingText: "공시 근거와 재무 흐름을 확인하는 중...",
  },
  krx: {
    label: "KRX",
    subtitle: "KRX MARKET DATA WORKSPACE",
    statusLabel: "korea-stock",
    welcomeTitle: "거래소 일별 시세에서 시작하는 시장 리서치",
    placeholder: "예: 삼성전자 최근 5거래일 종가·거래량·시가총액 흐름을 비교해줘",
    searchingText: "KRX 기준일별 시세와 종목 정보를 확인하는 중...",
  },
};

export function normalizeResearchMode(value: unknown): ResearchMode {
  return value === "krx" ? "krx" : "dart";
}

export function researchModePresentation(mode: ResearchMode): ResearchModePresentation {
  return PRESENTATIONS[normalizeResearchMode(mode)];
}

export function researchModeSources(mode: ResearchMode): string[] {
  return mode === "krx" ? ["korea-stock-mcp"] : ["korean-dart-mcp"];
}
