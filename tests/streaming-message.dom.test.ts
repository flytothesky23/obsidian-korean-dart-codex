// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import {
  StableStreamingMessage,
  type FrameScheduler,
} from "../src/streaming-message";

describe("StableStreamingMessage", () => {
  it("coalesces deltas while preserving the existing panel DOM and whitespace", () => {
    const panel = document.createElement("section");
    const body = document.createElement("div");
    panel.append(body);
    const scheduler = fakeScheduler();
    const painted = vi.fn();
    const stream = new StableStreamingMessage(scheduler);

    stream.attach(body, painted);
    stream.queue("첫 문장");
    stream.queue("첫 문장\n\n## 두 번째 제목");
    stream.queue("첫 문장\n\n## 두 번째 제목\n\n1. 항목");

    expect(scheduler.pending()).toBe(1);
    expect(panel.firstElementChild).toBe(body);
    scheduler.flush();

    expect(panel.firstElementChild).toBe(body);
    expect(body.textContent).toBe("첫 문장\n\n## 두 번째 제목\n\n1. 항목");
    expect(body.classList.contains("is-streaming")).toBe(true);
    expect(body.getAttribute("aria-busy")).toBe("true");
    expect(painted).toHaveBeenCalledOnce();
  });

  it("hides the metadata trailer from the live preview and finalizes cleanly", () => {
    const body = document.createElement("div");
    const scheduler = fakeScheduler();
    const stream = new StableStreamingMessage(scheduler);
    stream.attach(body);

    stream.queue("## 결론\n\n본문\n<!-- korean-dart-codex-meta\n{");
    scheduler.flush();
    expect(body.textContent).toBe("## 결론\n\n본문");

    stream.complete("## 결론\n\n본문");
    expect(body.classList.contains("is-streaming")).toBe(false);
    expect(body.hasAttribute("aria-busy")).toBe(false);
  });
});

function fakeScheduler(): FrameScheduler & {
  flush(): void;
  pending(): number;
} {
  let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  return {
    request(callback) {
      const id = ++nextId;
      callbacks.set(id, callback);
      return id;
    },
    cancel(id) {
      callbacks.delete(id);
    },
    flush() {
      const entries = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of entries) callback(performance.now());
    },
    pending() {
      return callbacks.size;
    },
  };
}
