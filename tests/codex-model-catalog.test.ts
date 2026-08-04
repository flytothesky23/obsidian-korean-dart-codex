import { describe, expect, it } from "vitest";
import {
  FALLBACK_CODEX_MODELS,
  modelCatalogToOptions,
  parseCodexModelCatalogPage,
} from "../src/codex-model-catalog";

describe("Codex model catalog", () => {
  it("parses app-server model/list capabilities", () => {
    const page = parseCodexModelCatalogPage({
      data: [{
        id: "gpt-5.6-sol",
        model: "gpt-5.6-sol",
        displayName: "GPT-5.6-Sol",
        description: "Frontier model",
        hidden: false,
        isDefault: true,
        defaultReasoningEffort: "low",
        supportedReasoningEfforts: [
          { reasoningEffort: "low", description: "Fast" },
          { reasoningEffort: "max", description: "Deep" },
          { reasoningEffort: "ultra", description: "Deepest" },
        ],
      }],
      nextCursor: "next-page",
    });

    expect(page.nextCursor).toBe("next-page");
    expect(page.models).toEqual([{
      model: "gpt-5.6-sol",
      displayName: "GPT-5.6-Sol",
      description: "Frontier model",
      isDefault: true,
      defaultReasoningEffort: "low",
      supportedReasoningEfforts: ["low", "max", "ultra"],
    }]);
  });

  it("filters hidden and malformed entries", () => {
    const page = parseCodexModelCatalogPage({
      data: [
        { model: "hidden-model", hidden: true },
        { displayName: "Missing identifier" },
        { model: "gpt-valid", supportedReasoningEfforts: [] },
      ],
      nextCursor: null,
    });

    expect(page.models).toHaveLength(1);
    expect(page.models[0].model).toBe("gpt-valid");
    expect(page.models[0].supportedReasoningEfforts).toEqual(["low", "medium", "high", "xhigh"]);
  });

  it("labels the server default and keeps current-generation fallbacks", () => {
    const options = modelCatalogToOptions(FALLBACK_CODEX_MODELS);

    expect(options["gpt-5.6-sol"]).toContain("Codex default");
    expect(options["gpt-5.6-terra"]).toContain("GPT-5.6-Terra");
    expect(options["gpt-5.6-luna"]).toContain("GPT-5.6-Luna");
  });
});
