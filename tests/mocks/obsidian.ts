export class App {}

export class Modal {
  modalEl = document.createElement("div");
  contentEl = document.createElement("div");

  constructor(_app: unknown) {
    this.modalEl.append(this.contentEl);
  }

  open(): void {
    document.body.append(this.modalEl);
    (this as { onOpen?: () => void }).onOpen?.();
  }

  close(): void {
    (this as { onClose?: () => void }).onClose?.();
    this.modalEl.remove();
  }

  setTitle(title: string): void {
    this.modalEl.setAttribute("data-title", title);
  }
}

export class Notice {
  constructor(
    readonly message: string,
    readonly timeout?: number,
  ) {}
}

export function setIcon(element: HTMLElement, icon: string): void {
  element.setAttribute("data-icon", icon);
}
