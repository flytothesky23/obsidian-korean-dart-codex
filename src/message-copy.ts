export type AssistantCopyKind = "answer" | "mermaid" | "dataview";

export interface AssistantCopyDescriptor {
  kind: AssistantCopyKind;
  label: string;
  title: string;
  copiedStatus: string;
  markdown: string;
}

interface AssistantCopyButtonOptions {
  onCopy: (markdown: string) => Promise<void>;
  setIcon: (element: HTMLElement, icon: "copy" | "check") => void;
}

export function describeAssistantCopy(text: string): AssistantCopyDescriptor {
  const markdown = text.trim();
  if (/^```mermaid(?:\s|$)/m.test(markdown)) {
    return {
      kind: "mermaid",
      label: "관계도 복사",
      title: "관계도를 Mermaid Markdown으로 복사",
      copiedStatus: "관계도 Mermaid 블록 복사됨",
      markdown,
    };
  }
  if (/^```dataviewjs(?:\s|$)/m.test(markdown)) {
    return {
      kind: "dataview",
      label: "색인 복사",
      title: "색인을 DataviewJS Markdown으로 복사",
      copiedStatus: "색인 Dataview 블록 복사됨",
      markdown,
    };
  }
  return {
    kind: "answer",
    label: "답변 복사",
    title: "답변을 Markdown 원문으로 복사",
    copiedStatus: "답변 Markdown 복사됨",
    markdown,
  };
}

export function renderAssistantCopyButton(
  parent: HTMLElement,
  descriptor: AssistantCopyDescriptor,
  options: AssistantCopyButtonOptions,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = `korean-dart-codex-message-copy is-${descriptor.kind}`;
  button.setAttribute("aria-label", descriptor.title);
  button.setAttribute("title", descriptor.title);
  const icon = document.createElement("span");
  icon.className = "korean-dart-codex-message-copy-icon";
  options.setIcon(icon, "copy");
  const label = document.createElement("span");
  label.className = "korean-dart-codex-message-copy-label";
  label.textContent = descriptor.label;
  button.append(icon, label);
  parent.append(button);
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await options.onCopy(descriptor.markdown);
      button.classList.add("is-copied");
      button.setAttribute("aria-label", descriptor.copiedStatus);
      button.setAttribute("title", descriptor.copiedStatus);
      options.setIcon(icon, "check");
      label.textContent = "복사됨";
    } catch {
      button.disabled = false;
    }
  });
  return button;
}
