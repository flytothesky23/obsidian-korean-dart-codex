import type { ContextScope } from "./dart-context";
import type { VaultIndexStatus } from "./vault-index";

export function formatIndexStatusText(status: VaultIndexStatus): string {
  if (status.phase === "indexing") {
    return `인덱싱 중 ${status.indexedCount}/${status.totalCount}`;
  }
  if (status.phase === "idle") {
    return status.indexedCount > 0
      ? `Markdown ${status.indexedCount}개 준비됨 · 전체 색인 대기`
      : "Markdown 색인 대기 · 노트 선택 시 시작";
  }
  const suffix = status.phase === "ready" ? "최신" : "준비 전";
  const base = `Markdown ${status.indexedCount}개 인덱싱됨 · ${suffix}`;
  return status.failureCount ? `${base} · ${status.failureCount}개 실패` : base;
}

export function formatContextFooterSummary(
  selectedCount: number,
  estimatedChars: number,
  maxChars: number,
  scope: ContextScope,
): string {
  return [
    `${selectedCount}개 선택`,
    `약 ${formatChars(estimatedChars)} / 전체 예산 ${formatChars(maxChars)}`,
    scope === "turn" ? "이번 질문만" : "현재 대화",
  ].join(" · ");
}

export function formatApplyLabel(selectedCount: number): string {
  return selectedCount > 0 ? `${selectedCount}개 노트 적용` : "컨텍스트 없이 진행";
}

export function formatChars(value: number): string {
  if (value < 1_000) return `${value}자`;
  return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k자`;
}
