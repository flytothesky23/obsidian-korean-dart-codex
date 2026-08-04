import { describe, expect, it } from "vitest";
import {
  extractNativeImageGeneration,
  supportsNativeImageGeneration,
} from "../src/codex-appserver-visual";

describe("native app-server visual protocol", () => {
  it("detects the current native image generation capability", () => {
    expect(supportsNativeImageGeneration({ imageGeneration: true, webSearch: true })).toBe(true);
    expect(supportsNativeImageGeneration({ capabilities: { imageGeneration: true } })).toBe(true);
    expect(supportsNativeImageGeneration({ imageGeneration: false })).toBe(false);
  });

  it("extracts only safe image result fields from item/completed", () => {
    const result = extractNativeImageGeneration({
      item: {
        type: "imageGeneration",
        status: "completed",
        savedPath: "/Users/test/.codex/generated_images/slide.png",
        revisedPrompt: "A restrained disclosure brief",
        result: "large-base64-payload-must-not-be-retained",
      },
    });

    expect(result).toEqual({
      status: "completed",
      savedPath: "/Users/test/.codex/generated_images/slide.png",
      revisedPrompt: "A restrained disclosure brief",
    });
    expect(result).not.toHaveProperty("result");
  });

  it("ignores generic app-server items", () => {
    expect(extractNativeImageGeneration({ item: { type: "agentMessage", text: "plan" } })).toEqual({ status: "" });
  });
});
