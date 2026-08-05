// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderResearchModeTabs } from "../src/research-mode-ui";

describe("renderResearchModeTabs", () => {
  beforeEach(() => document.body.replaceChildren());

  it("renders an accessible DART/KRX segmented control and switches modes", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const onSelect = vi.fn();
    renderResearchModeTabs(parent, "dart", false, onSelect);

    const tabs = parent.querySelectorAll<HTMLButtonElement>("[role=tab]");
    expect(tabs).toHaveLength(2);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs[1].getAttribute("aria-selected")).toBe("false");
    tabs[1].click();
    expect(onSelect).toHaveBeenCalledWith("krx");
  });

  it("disables both tabs during a running request", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    renderResearchModeTabs(parent, "krx", true, vi.fn());
    expect(Array.from(parent.querySelectorAll<HTMLButtonElement>("button")).every((button) => button.disabled)).toBe(true);
  });
});
