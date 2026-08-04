import { describe, expect, it, vi } from "vitest";
import { createKoreanDartContextApiV2 } from "../src/context-api";
import { DartContextService } from "../src/dart-context";
import { VaultIndexService, type VaultIndexRecord } from "../src/vault-index";

describe("KoreanDartContextApiV2", () => {
  it("exposes the versioned read-only search, resolve, picker, and session contract", async () => {
    const record: VaultIndexRecord = {
      path: "Companies/samsung.md",
      title: "삼성전자",
      basename: "tort",
      folder: "Cases",
      aliases: [],
      tags: ["반도체"],
      frontmatter: "",
      headings: [],
      links: [],
      backlinks: [],
      mtime: 1,
      size: 4,
      excerpt: "재무분석",
    };
    const index = new VaultIndexService([record]);
    const context = new DartContextService({
      read: async (path) => ({
        path,
        title: "삼성전자",
        content: "facts",
        modifiedAt: 1,
      }),
    });
    const openPicker = vi.fn(async () => null);
    const api = createKoreanDartContextApiV2({ index, context, openPicker });

    expect(api.version).toBe(2);
    const results = await api.search("삼성전자");
    expect(results[0].record.path).toBe("Companies/samsung.md");
    results[0].record.tags.push("mutated");
    expect(index.get("Companies/samsung.md")?.tags).toEqual(["반도체"]);

    const resolved = await api.resolve(["Companies/samsung.md"], "session");
    expect(resolved.notes[0].content).toBe("facts");
    expect(api.getSessionContext()).toBeNull();

    await api.openPicker({ mode: "related" });
    expect(openPicker).toHaveBeenCalledWith({ mode: "related" });
    api.clearSessionContext();
  });

  it("lazily prepares the index before the first public search", async () => {
    const index = new VaultIndexService();
    const context = new DartContextService({
      read: async (path) => ({
        path,
        title: "임대차",
        content: "facts",
        modifiedAt: 1,
      }),
    });
    const ensureIndex = vi.fn(async () => {
      index.upsert({
        path: "Companies/lease.md",
        title: "임대차",
        basename: "lease",
        folder: "Cases",
        aliases: [],
        tags: ["반도체"],
        frontmatter: "",
        headings: [],
        links: [],
        backlinks: [],
        mtime: 1,
        size: 5,
        excerpt: "임대차 사실관계",
      });
    });
    const api = createKoreanDartContextApiV2({
      index,
      context,
      openPicker: async () => null,
      ensureIndex,
    });

    expect(await api.search("임대차")).toHaveLength(1);
    expect(ensureIndex).toHaveBeenCalledOnce();
  });
});
