import { describe, expect, it } from "vitest";
import { NoteContextPolicy } from "../src/note-context-policy";

describe("NoteContextPolicy", () => {
  it("consumes a one-turn no-note choice after one question", () => {
    const policy = new NoteContextPolicy();
    policy.disable("turn");

    expect(policy.getDisabledScope()).toBe("turn");
    expect(policy.prepareTurn()).toEqual({ excludeNoteContext: true, scope: "turn" });
    expect(policy.getDisabledScope()).toBeNull();
    expect(policy.prepareTurn()).toEqual({ excludeNoteContext: false, scope: null });
  });

  it("keeps a conversation no-note choice until the conversation is cleared", () => {
    const policy = new NoteContextPolicy();
    policy.disable("session");

    expect(policy.prepareTurn()).toEqual({ excludeNoteContext: true, scope: "session" });
    expect(policy.prepareTurn()).toEqual({ excludeNoteContext: true, scope: "session" });

    policy.clearConversation();
    expect(policy.prepareTurn()).toEqual({ excludeNoteContext: false, scope: null });
  });

  it("returns to normal note behavior when explicit note context is enabled", () => {
    const policy = new NoteContextPolicy();
    policy.disable("session");
    policy.enable();

    expect(policy.getDisabledScope()).toBeNull();
  });
});
