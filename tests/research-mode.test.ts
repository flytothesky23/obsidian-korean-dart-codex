import { describe, expect, it } from "vitest";
import {
  normalizeResearchMode,
  researchModePresentation,
  researchModeSources,
} from "../src/research-mode";

describe("research mode", () => {
  it("defaults persisted or unknown values to DART", () => {
    expect(normalizeResearchMode(undefined)).toBe("dart");
    expect(normalizeResearchMode("legacy")).toBe("dart");
  });

  it("describes KRX as daily market data with both source families available", () => {
    expect(researchModePresentation("krx").subtitle).toContain("KRX");
    expect(researchModePresentation("krx").placeholder).toContain("거래량");
    expect(researchModeSources("krx")).toEqual(["korea-stock-mcp"]);
  });
});
