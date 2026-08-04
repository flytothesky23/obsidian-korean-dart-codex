import { describe, expect, it, vi } from "vitest";
import {
  VaultIndexService,
  createVaultIndexRecord,
  type VaultIndexRecord,
} from "../src/vault-index";

describe("VaultIndexService", () => {
  it("can prepare one current note without claiming the full index is ready", () => {
    const index = new VaultIndexService();

    index.upsert(record("Current.md"), false);

    expect(index.resolve(["Current.md"])).toHaveLength(1);
    expect(index.getStatus()).toMatchObject({
      phase: "idle",
      indexedCount: 0,
      totalCount: 0,
    });
  });

  it("notifies indexing status lifecycle and incremental changes", () => {
    const index = new VaultIndexService();
    const statuses: string[] = [];
    const unsubscribe = index.subscribeStatus((status) => {
      statuses.push(`${status.phase}:${status.indexedCount}/${status.totalCount}:${status.failureCount}`);
    });

    index.beginIndexing(3);
    index.reportIndexing(1);
    index.upsert(record("Companies/one.md"));
    index.reportIndexing(2, 1);
    index.completeIndexing(1);

    expect(statuses).toEqual([
      "idle:0/0:0",
      "indexing:0/3:0",
      "indexing:1/3:0",
      "indexing:2/3:1",
      "ready:1/2:1",
    ]);

    const beforeIncremental = statuses.length;
    index.upsert(record("Companies/two.md", { title: "둘" }));
    index.delete("Companies/one.md");
    index.rename("Companies/two.md", record("Companies/renamed.md"));

    expect(statuses.slice(beforeIncremental)).toHaveLength(3);
    expect(index.getStatus()).toMatchObject({
      phase: "ready",
      indexedCount: 1,
      totalCount: 2,
      failureCount: 1,
    });

    unsubscribe();
  });

  it("does not notify on backlink-only derived updates", () => {
    const index = new VaultIndexService([record("Companies/source.md")]);
    const listener = vi.fn();
    const unsubscribe = index.subscribeStatus(listener);
    listener.mockClear();

    index.updateBacklinks("Companies/source.md", ["Companies/ref.md"]);

    expect(index.get("Companies/source.md")?.backlinks).toEqual(["Companies/ref.md"]);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("handles create, modify, delete, and rename incrementally", () => {
    const index = new VaultIndexService();
    index.upsert(record("Companies/samsung.md", { title: "삼성전자", excerpt: "반도체 제750조" }));

    expect(index.get("Companies/samsung.md")?.title).toBe("삼성전자");

    index.upsert(record("Companies/samsung.md", { title: "삼성전자 공시", mtime: 2 }));
    expect(index.get("Companies/samsung.md")?.title).toBe("삼성전자 공시");
    expect(index.size).toBe(1);

    index.rename(
      "Companies/samsung.md",
      record("Companies/damages.md", { title: "재무분석", mtime: 3 }),
    );
    expect(index.get("Companies/samsung.md")).toBeUndefined();
    expect(index.get("Companies/damages.md")?.title).toBe("재무분석");

    index.delete("Companies/damages.md");
    expect(index.size).toBe(0);
  });

  it("ranks title and alias matches above excerpt-only matches and filters folders", () => {
    const index = new VaultIndexService([
      record("Companies/samsung.md", {
        title: "삼성전자 재무분석",
        aliases: ["삼성전자 공시"],
        tags: ["반도체"],
        excerpt: "고의 또는 과실로 인한 위법행위",
      }),
      record("Memos/general.md", {
        title: "회의 메모",
        excerpt: "다음 회의에서 삼성전자 재무분석 자료를 검토",
      }),
      record("Companies/contracts.md", {
        title: "계약 해제",
        excerpt: "채무불이행과 원상회복",
      }),
    ]);

    const results = index.search("삼성전자 재무분석");
    expect(results.map((result) => result.record.path)).toEqual([
      "Companies/samsung.md",
      "Memos/general.md",
    ]);
    expect(results[0].score).toBeGreaterThan(results[1].score);
    expect(index.search("삼성전자", { folder: "Companies" })).toHaveLength(1);
    expect(index.search("삼성전자", { tags: ["반도체"] })[0].record.path).toBe("Companies/samsung.md");
  });

  it("finds related notes from internal links, backlinks, tags, and headings", () => {
    const index = new VaultIndexService([
      record("Companies/samsung.md", {
        title: "삼성전자",
        tags: ["반도체"],
        headings: ["성립요건"],
        links: ["Companies/damages.md"],
      }),
      record("Companies/damages.md", {
        title: "재무분석",
        tags: ["반도체"],
        backlinks: ["Companies/samsung.md"],
      }),
      record("Memos/other.md", { title: "일반 메모", tags: ["업무"] }),
    ]);

    expect(index.findRelated("Companies/samsung.md").map((result) => result.record.path))
      .toEqual(["Companies/damages.md"]);
  });
});

describe("createVaultIndexRecord", () => {
  it("indexes safe metadata and redacts secret-like values from the local index", () => {
    const indexed = createVaultIndexRecord({
      path: "Companies/samsung.md",
      basename: "tort",
      mtime: 123,
      size: 900,
      content: [
        "---",
        "title: 삼성전자",
        "aliases: [삼성전자 공시]",
        "tags: [반도체, 재무분석]",
        "api_key: should-never-appear",
        "---",
        "# 성립요건",
        "Bearer secret-token-value",
        "고의 또는 과실과 손해가 필요합니다.",
      ].join("\n"),
      metadata: {
        frontmatter: {
          title: "삼성전자",
          aliases: ["삼성전자 공시"],
          tags: ["반도체", "재무분석"],
          api_key: "should-never-appear",
        },
        headings: ["성립요건"],
        tags: ["#반도체"],
        links: ["Companies/damages.md"],
        backlinks: ["Companies/source.md"],
      },
    });

    expect(indexed.title).toBe("삼성전자");
    expect(indexed.aliases).toEqual(["삼성전자 공시"]);
    expect(indexed.tags).toEqual(["반도체", "재무분석"]);
    expect(indexed.frontmatter).toContain("title 삼성전자");
    expect(indexed.frontmatter).not.toContain("api_key");
    expect(indexed.excerpt).not.toContain("secret-token-value");
    expect(indexed.headings).toEqual(["성립요건"]);
    expect(indexed.links).toEqual(["Companies/damages.md"]);
    expect(indexed.backlinks).toEqual(["Companies/source.md"]);
  });
});

function record(
  path: string,
  overrides: Partial<VaultIndexRecord> = {},
): VaultIndexRecord {
  const basename = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
  return {
    path,
    title: basename,
    basename,
    folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
    aliases: [],
    tags: [],
    frontmatter: "",
    headings: [],
    links: [],
    backlinks: [],
    mtime: 1,
    size: 100,
    excerpt: "",
    ...overrides,
  };
}
