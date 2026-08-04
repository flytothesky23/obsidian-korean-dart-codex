import { describe, expect, it } from "vitest";
import {
  DartContextService,
  type ContextNoteSource,
  type ContextSourceNote,
} from "../src/dart-context";

describe("DartContextService", () => {
  it("deduplicates multiple notes and applies note and character budgets", async () => {
    const source = memorySource({
      "A.md": note("A.md", "A".repeat(12), 1),
      "B.md": note("B.md", "B".repeat(12), 1),
      "C.md": note("C.md", "C".repeat(12), 1),
    });
    const service = new DartContextService(source, {
      maxNotes: 2,
      maxChars: 15,
      perNoteChars: 10,
    });

    const snapshot = await service.setContext(["A.md", "A.md", "B.md", "C.md"], "turn");

    expect(snapshot.selectedCount).toBe(3);
    expect(snapshot.notes.map((item) => item.path)).toEqual(["A.md", "B.md"]);
    expect(snapshot.notes[0].content).toHaveLength(10);
    expect(snapshot.notes[1].content).toHaveLength(5);
    expect(snapshot.totalChars).toBe(15);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.omittedPaths).toEqual(["C.md"]);
  });

  it("consumes one-turn context while preserving session context until a new conversation", async () => {
    const service = new DartContextService(memorySource({
      "session.md": note("session.md", "session", 1),
      "turn.md": note("turn.md", "turn", 1),
    }));

    await service.setContext(["session.md"], "session");
    await service.setContext(["turn.md"], "turn");

    const first = service.prepareTurnContext();
    expect(first?.scope).toBe("mixed");
    expect(first?.notes.map((item) => item.path)).toEqual(["turn.md", "session.md"]);
    expect(service.getOneTurnContext()).toBeNull();
    expect(service.getSessionContext()?.notes[0].path).toBe("session.md");

    const second = service.prepareTurnContext();
    expect(second?.scope).toBe("session");
    expect(second?.notes.map((item) => item.path)).toEqual(["session.md"]);

    service.clearAll();
    expect(service.getSessionContext()).toBeNull();
    expect(service.prepareTurnContext()).toBeNull();
  });

  it("keeps a turn snapshot fixed and marks it stale after the source note changes", async () => {
    const notes = {
      "Facts.md": note("Facts.md", "original facts", 10),
    };
    const service = new DartContextService(memorySource(notes));
    await service.setContext(["Facts.md"], "session");

    notes["Facts.md"] = note("Facts.md", "changed facts", 20);
    service.markStale("Facts.md", 20);

    const session = service.getSessionContext();
    expect(session?.notes[0].content).toBe("original facts");
    expect(session?.notes[0].stale).toBe(true);
    expect(session?.notes[0].currentModifiedAt).toBe(20);
  });

  it("removes a single context chip without affecting the other scope", async () => {
    const service = new DartContextService(memorySource({
      "A.md": note("A.md", "a", 1),
      "B.md": note("B.md", "b", 1),
    }));
    await service.setContext(["A.md"], "session");
    await service.setContext(["B.md"], "turn");

    service.remove("B.md", "turn");

    expect(service.getOneTurnContext()).toBeNull();
    expect(service.getSessionContext()?.notes[0].path).toBe("A.md");
  });

  it("prioritizes one-turn notes when the combined scopes exceed the turn budget", async () => {
    const source = memorySource({
      "session-a.md": note("session-a.md", "session-a", 1),
      "session-b.md": note("session-b.md", "session-b", 1),
      "turn.md": note("turn.md", "turn", 1),
    });
    const service = new DartContextService(source, {
      maxNotes: 2,
      maxChars: 100,
      perNoteChars: 100,
    });
    await service.setContext(["session-a.md", "session-b.md"], "session");
    await service.setContext(["turn.md"], "turn");

    const merged = service.prepareTurnContext();

    expect(merged?.notes.map((item) => item.path)).toEqual(["turn.md", "session-a.md"]);
    expect(merged?.selectedCount).toBe(3);
    expect(merged?.omittedPaths).toEqual(["session-b.md"]);
    expect(merged?.truncated).toBe(true);
  });

  it("distinguishes unreadable notes from budget truncation", async () => {
    const service = new DartContextService({
      read: async () => {
        throw new Error("deleted");
      },
    });

    const snapshot = await service.resolve(["missing.md"], "turn");

    expect(snapshot.notes).toEqual([]);
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.omittedPaths).toEqual(["missing.md"]);
    expect(snapshot.omissions).toEqual([{ path: "missing.md", reason: "unreadable" }]);
  });

  it("moves a note between scopes instead of showing duplicate chips", async () => {
    const service = new DartContextService(memorySource({
      "A.md": note("A.md", "a", 1),
    }));
    await service.setContext(["A.md"], "session");
    await service.setContext(["A.md"], "turn");

    expect(service.getSessionContext()).toBeNull();
    expect(service.getOneTurnContext()?.notes[0].path).toBe("A.md");
    const selected = service.listSelected();
    expect(selected).toHaveLength(1);
    expect(selected[0].snapshotCreatedAt).toBe(service.getOneTurnContext()?.createdAt);
  });
});

function memorySource(notes: Record<string, ContextSourceNote>): ContextNoteSource {
  return {
    read: async (path) => {
      const value = notes[path];
      if (!value) throw new Error(`missing: ${path}`);
      return { ...value };
    },
  };
}

function note(path: string, content: string, modifiedAt: number): ContextSourceNote {
  return {
    path,
    title: path.replace(/\.md$/, ""),
    content,
    modifiedAt,
  };
}
