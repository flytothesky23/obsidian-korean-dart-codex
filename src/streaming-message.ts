export interface FrameScheduler {
  request(callback: FrameRequestCallback): number;
  cancel(handle: number): void;
}

const browserFrameScheduler: FrameScheduler = {
  request(callback) {
    return window.requestAnimationFrame(callback);
  },
  cancel(handle) {
    window.cancelAnimationFrame(handle);
  },
};

export class StableStreamingMessage {
  private target: HTMLElement | null = null;
  private pendingText = "";
  private frame: number | null = null;
  private onPaint: (() => void) | null = null;

  constructor(private readonly scheduler: FrameScheduler = browserFrameScheduler) {}

  attach(target: HTMLElement, onPaint?: () => void): void {
    if (this.target !== target) this.cancelFrame();
    this.target = target;
    this.onPaint = onPaint ?? null;
    target.classList.add("is-streaming");
    target.setAttribute("aria-busy", "true");
  }

  queue(text: string): void {
    this.pendingText = visibleStreamingText(text);
    if (!this.target || this.frame !== null) return;
    this.frame = this.scheduler.request(() => {
      this.frame = null;
      this.paint(true);
    });
  }

  complete(text: string): void {
    this.pendingText = visibleStreamingText(text);
    this.cancelFrame();
    this.paint(false);
  }

  detach(): void {
    this.cancelFrame();
    this.target = null;
    this.onPaint = null;
  }

  private paint(streaming: boolean): void {
    const target = this.target;
    if (!target) return;
    target.textContent = this.pendingText || (streaming ? "응답 수신 중…" : "");
    target.classList.toggle("is-streaming", streaming);
    if (streaming) {
      target.setAttribute("aria-busy", "true");
    } else {
      target.removeAttribute("aria-busy");
    }
    this.onPaint?.();
  }

  private cancelFrame(): void {
    if (this.frame === null) return;
    this.scheduler.cancel(this.frame);
    this.frame = null;
  }
}

export function visibleStreamingText(text: string): string {
  const metadataIndex = text.search(/\n?<!--\s*korean-dart-codex-meta\b/iu);
  return metadataIndex >= 0 ? text.slice(0, metadataIndex).trimEnd() : text;
}
