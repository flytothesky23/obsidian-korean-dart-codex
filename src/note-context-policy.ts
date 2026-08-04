import type { ContextScope } from "./dart-context";

export interface NoteContextDecision {
  excludeNoteContext: boolean;
  scope: ContextScope | null;
}

/**
 * Tracks an explicit user choice to run DART research without any vault notes.
 * Turn choices are consumed once; session choices survive until a new conversation.
 */
export class NoteContextPolicy {
  private disabledScope: ContextScope | null = null;

  disable(scope: ContextScope): void {
    this.disabledScope = scope;
  }

  enable(): void {
    this.disabledScope = null;
  }

  getDisabledScope(): ContextScope | null {
    return this.disabledScope;
  }

  prepareTurn(): NoteContextDecision {
    const scope = this.disabledScope;
    if (scope === "turn") this.disabledScope = null;
    return {
      excludeNoteContext: scope !== null,
      scope,
    };
  }

  clearConversation(): void {
    this.disabledScope = null;
  }
}
