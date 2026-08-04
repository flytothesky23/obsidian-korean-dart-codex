// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import {
  describeAssistantCopy,
  renderAssistantCopyButton,
} from "../src/message-copy";

describe("assistant result copy", () => {
  it("keeps the original Markdown source for normal answers", () => {
    const source = [
      "## 결론",
      "",
      "1. 첫 번째 판단",
      "2. 두 번째 판단",
      "",
      "| 구분 | 내용 |",
      "| --- | --- |",
      "| 결론 | 확인 필요 |",
    ].join("\n");

    expect(describeAssistantCopy(source)).toEqual({
      kind: "answer",
      label: "답변 복사",
      title: "답변을 Markdown 원문으로 복사",
      copiedStatus: "답변 Markdown 복사됨",
      markdown: source,
    });
  });

  it("labels Mermaid and Dataview results with paste-ready formats", () => {
    const mermaid = "```mermaid\ngraph LR\n  A --> B\n```\n\n관계도 설명";
    const dataview = "```dataviewjs\ndv.table(['노트'], [])\n```";

    expect(describeAssistantCopy(mermaid)).toMatchObject({
      kind: "mermaid",
      label: "관계도 복사",
      title: "관계도를 Mermaid Markdown으로 복사",
      copiedStatus: "관계도 Mermaid 블록 복사됨",
      markdown: mermaid,
    });
    expect(describeAssistantCopy(dataview)).toMatchObject({
      kind: "dataview",
      label: "색인 복사",
      title: "색인을 DataviewJS Markdown으로 복사",
      copiedStatus: "색인 Dataview 블록 복사됨",
      markdown: dataview,
    });
  });

  it("renders a compact per-result button and acknowledges a successful copy", async () => {
    const parent = document.createElement("div");
    const onCopy = vi.fn(async () => undefined);
    const setIcon = vi.fn((element: HTMLElement, icon: "copy" | "check") => {
      element.dataset.icon = icon;
    });

    const button = renderAssistantCopyButton(
      parent,
      describeAssistantCopy("```mermaid\ngraph LR\nA --> B\n```"),
      { onCopy, setIcon },
    );

    expect(button.getAttribute("aria-label")).toBe("관계도를 Mermaid Markdown으로 복사");
    expect(button.textContent).toContain("관계도 복사");
    expect(button.querySelector<HTMLElement>("[data-icon]")?.dataset.icon).toBe("copy");

    button.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(onCopy).toHaveBeenCalledWith("```mermaid\ngraph LR\nA --> B\n```");
    expect(button.textContent).toContain("복사됨");
    expect(button.classList.contains("is-copied")).toBe(true);
    expect(button.querySelector<HTMLElement>("[data-icon]")?.dataset.icon).toBe("check");
  });
});
