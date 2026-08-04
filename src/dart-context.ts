export type ContextScope = "turn" | "session";
export type ContextSnapshotScope = ContextScope | "mixed";

export interface ContextBudget {
  maxNotes: number;
  maxChars: number;
  perNoteChars: number;
}

export interface ContextSourceNote {
  path: string;
  title: string;
  content: string;
  modifiedAt: number;
}

export interface ContextNoteSource {
  read(path: string): Promise<ContextSourceNote>;
}

export interface ContextSnapshotNote {
  path: string;
  title: string;
  content: string;
  contentHash: string;
  modifiedAt: number;
  currentModifiedAt?: number;
  stale: boolean;
  originalChars: number;
  includedChars: number;
  truncated: boolean;
}

export interface ContextSnapshot {
  id: string;
  createdAt: string;
  scope: ContextSnapshotScope;
  selectedCount: number;
  notes: ContextSnapshotNote[];
  totalChars: number;
  truncated: boolean;
  omittedPaths: string[];
  omissions?: ContextOmission[];
}

export interface ContextOmission {
  path: string;
  reason: "unreadable" | "over-budget";
}

export interface SelectedContextNote {
  scope: ContextScope;
  note: ContextSnapshotNote;
  snapshotCreatedAt: string;
}

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  maxNotes: 8,
  maxChars: 32_000,
  perNoteChars: 8_000,
};

export class DartContextService {
  private turnContext: ContextSnapshot | null = null;
  private sessionContext: ContextSnapshot | null = null;
  private recentPaths: string[] = [];

  constructor(
    private readonly source: ContextNoteSource,
    readonly budget: ContextBudget = DEFAULT_CONTEXT_BUDGET,
  ) {}

  async resolve(paths: string[], scope: ContextScope = "turn"): Promise<ContextSnapshot> {
    return captureSnapshot(this.source, paths, scope, this.budget);
  }

  async setContext(paths: string[], scope: ContextScope): Promise<ContextSnapshot> {
    const snapshot = await this.resolve(paths, scope);
    const capturedPaths = snapshot.notes.map((note) => note.path);
    if (scope === "turn") {
      for (const path of capturedPaths) {
        this.sessionContext = removeFromSnapshot(this.sessionContext, normalizePath(path), this.budget);
      }
      this.turnContext = snapshot.notes.length ? snapshot : null;
    } else {
      for (const path of capturedPaths) {
        this.turnContext = removeFromSnapshot(this.turnContext, normalizePath(path), this.budget);
      }
      this.sessionContext = snapshot.notes.length ? snapshot : null;
    }
    this.recordRecent(snapshot.notes.map((note) => note.path));
    return snapshot;
  }

  getOneTurnContext(): ContextSnapshot | null {
    return cloneSnapshot(this.turnContext);
  }

  getSessionContext(): ContextSnapshot | null {
    return cloneSnapshot(this.sessionContext);
  }

  getRecentPaths(): string[] {
    return [...this.recentPaths];
  }

  listSelected(): SelectedContextNote[] {
    return [
      ...(this.turnContext?.notes ?? []).map((note) => ({
        scope: "turn" as const,
        note: { ...note },
        snapshotCreatedAt: this.turnContext!.createdAt,
      })),
      ...(this.sessionContext?.notes ?? []).map((note) => ({
        scope: "session" as const,
        note: { ...note },
        snapshotCreatedAt: this.sessionContext!.createdAt,
      })),
    ];
  }

  previewTurnContext(): ContextSnapshot | null {
    return mergeSnapshots(this.turnContext, this.sessionContext, this.budget);
  }

  prepareTurnContext(): ContextSnapshot | null {
    const snapshot = this.previewTurnContext();
    this.turnContext = null;
    return snapshot;
  }

  markStale(path: string, currentModifiedAt?: number): void {
    const normalized = normalizePath(path);
    this.turnContext = markSnapshotStale(this.turnContext, normalized, currentModifiedAt);
    this.sessionContext = markSnapshotStale(this.sessionContext, normalized, currentModifiedAt);
  }

  remove(path: string, scope?: ContextScope): void {
    const normalized = normalizePath(path);
    if (!scope || scope === "turn") {
      this.turnContext = removeFromSnapshot(this.turnContext, normalized, this.budget);
    }
    if (!scope || scope === "session") {
      this.sessionContext = removeFromSnapshot(this.sessionContext, normalized, this.budget);
    }
  }

  clearOneTurnContext(): void {
    this.turnContext = null;
  }

  clearSessionContext(): void {
    this.sessionContext = null;
  }

  clearAll(): void {
    this.turnContext = null;
    this.sessionContext = null;
  }

  private recordRecent(paths: string[]): void {
    const next = [...paths.reverse(), ...this.recentPaths]
      .map(normalizePath)
      .filter(Boolean);
    this.recentPaths = [...new Set(next)].slice(0, 24);
  }
}

export async function captureSnapshot(
  source: ContextNoteSource,
  paths: string[],
  scope: ContextScope,
  budget: ContextBudget = DEFAULT_CONTEXT_BUDGET,
): Promise<ContextSnapshot> {
  const uniquePaths = [...new Set(paths.map(normalizePath).filter(Boolean))];
  const notes: ContextSnapshotNote[] = [];
  const omittedPaths: string[] = [];
  const omissions: ContextOmission[] = [];
  let totalChars = 0;
  let truncated = false;

  for (const path of uniquePaths) {
    if (notes.length >= budget.maxNotes || totalChars >= budget.maxChars) {
      omittedPaths.push(path);
      omissions.push({ path, reason: "over-budget" });
      truncated = true;
      continue;
    }
    let sourceNote: ContextSourceNote;
    try {
      sourceNote = await source.read(path);
    } catch {
      omittedPaths.push(path);
      omissions.push({ path, reason: "unreadable" });
      continue;
    }
    const available = Math.max(0, budget.maxChars - totalChars);
    const includedChars = Math.min(sourceNote.content.length, budget.perNoteChars, available);
    if (includedChars <= 0) {
      omittedPaths.push(path);
      omissions.push({ path, reason: "over-budget" });
      truncated = true;
      continue;
    }
    const noteTruncated = includedChars < sourceNote.content.length;
    notes.push({
      path: normalizePath(sourceNote.path || path),
      title: sourceNote.title.trim() || basename(path),
      content: sourceNote.content.slice(0, includedChars),
      contentHash: hashContent(sourceNote.content),
      modifiedAt: sourceNote.modifiedAt,
      stale: false,
      originalChars: sourceNote.content.length,
      includedChars,
      truncated: noteTruncated,
    });
    totalChars += includedChars;
    truncated ||= noteTruncated;
  }

  return identifySnapshot({
    id: "",
    createdAt: new Date().toISOString(),
    scope,
    selectedCount: uniquePaths.length,
    notes,
    totalChars,
    truncated,
    omittedPaths,
    omissions,
  });
}

export function mergeSnapshots(
  turnContext: ContextSnapshot | null,
  sessionContext: ContextSnapshot | null,
  budget: ContextBudget = DEFAULT_CONTEXT_BUDGET,
): ContextSnapshot | null {
  if (!turnContext && !sessionContext) return null;
  if (turnContext && !sessionContext) return cloneSnapshot(turnContext);
  if (!turnContext && sessionContext) return cloneSnapshot(sessionContext);

  const allNotes = [
    ...(turnContext?.notes ?? []),
    ...(sessionContext?.notes ?? []),
  ];
  const selectedPaths = new Set([
    ...allNotes.map((note) => normalizePath(note.path)),
    ...(turnContext?.omittedPaths ?? []).map(normalizePath),
    ...(sessionContext?.omittedPaths ?? []).map(normalizePath),
  ]);
  const seen = new Set<string>();
  const notes: ContextSnapshotNote[] = [];
  const omittedPaths: string[] = [
    ...(turnContext?.omittedPaths ?? []),
    ...(sessionContext?.omittedPaths ?? []),
  ];
  const omissions: ContextOmission[] = [
    ...(turnContext?.omissions ?? []),
    ...(sessionContext?.omissions ?? []),
  ];
  let totalChars = 0;
  let truncated = !!turnContext?.truncated || !!sessionContext?.truncated;

  for (const sourceNote of allNotes) {
    const path = normalizePath(sourceNote.path);
    if (seen.has(path)) continue;
    seen.add(path);
    if (notes.length >= budget.maxNotes || totalChars >= budget.maxChars) {
      omittedPaths.push(path);
      omissions.push({ path, reason: "over-budget" });
      truncated = true;
      continue;
    }
    const includedChars = Math.min(sourceNote.content.length, budget.perNoteChars, budget.maxChars - totalChars);
    if (includedChars <= 0) {
      omittedPaths.push(path);
      omissions.push({ path, reason: "over-budget" });
      truncated = true;
      continue;
    }
    notes.push({
      ...sourceNote,
      content: sourceNote.content.slice(0, includedChars),
      includedChars,
      truncated: sourceNote.truncated || includedChars < sourceNote.content.length,
    });
    totalChars += includedChars;
    truncated ||= sourceNote.truncated || includedChars < sourceNote.content.length;
  }

  return identifySnapshot({
    id: "",
    createdAt: new Date().toISOString(),
    scope: "mixed",
    selectedCount: selectedPaths.size,
    notes,
    totalChars,
    truncated,
    omittedPaths: [...new Set(omittedPaths)],
    omissions: uniqueOmissions(omissions),
  });
}

export function hashContent(content: string): string {
  return `fnv1a64:${hashString64(content)}`;
}

function markSnapshotStale(
  snapshot: ContextSnapshot | null,
  path: string,
  currentModifiedAt?: number,
): ContextSnapshot | null {
  if (!snapshot) return null;
  let changed = false;
  const notes = snapshot.notes.map((note) => {
    if (normalizePath(note.path) !== path) return note;
    const stale = currentModifiedAt === undefined || currentModifiedAt !== note.modifiedAt;
    if (note.stale === stale && note.currentModifiedAt === currentModifiedAt) return note;
    changed = true;
    return { ...note, stale, currentModifiedAt };
  });
  return changed ? { ...snapshot, notes } : snapshot;
}

function removeFromSnapshot(
  snapshot: ContextSnapshot | null,
  path: string,
  budget: ContextBudget,
): ContextSnapshot | null {
  if (!snapshot) return null;
  const notes = snapshot.notes.filter((note) => normalizePath(note.path) !== path);
  if (notes.length === snapshot.notes.length) return snapshot;
  if (notes.length === 0) return null;
  const omittedPaths = snapshot.omittedPaths.filter((omitted) => normalizePath(omitted) !== path);
  const omissions = (snapshot.omissions ?? []).filter((omission) => normalizePath(omission.path) !== path);
  return identifySnapshot({
    ...snapshot,
    id: "",
    createdAt: new Date().toISOString(),
    selectedCount: notes.length + omittedPaths.length,
    notes,
    totalChars: notes.reduce((sum, note) => sum + note.includedChars, 0),
    truncated: notes.some((note) => note.truncated) || omissions.some((omission) => omission.reason === "over-budget"),
    omittedPaths,
    omissions,
  }, budget);
}

function identifySnapshot(snapshot: ContextSnapshot, _budget?: ContextBudget): ContextSnapshot {
  const identity = JSON.stringify({
    createdAt: snapshot.createdAt,
    scope: snapshot.scope,
    notes: snapshot.notes.map((note) => [note.path, note.contentHash, note.includedChars]),
    omittedPaths: snapshot.omittedPaths,
    omissions: snapshot.omissions,
  });
  return {
    ...snapshot,
    id: `ctx-${hashString64(identity).slice(0, 20)}`,
  };
}

function hashString64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}

function cloneSnapshot(snapshot: ContextSnapshot | null): ContextSnapshot | null {
  if (!snapshot) return null;
  return {
    ...snapshot,
    notes: snapshot.notes.map((note) => ({ ...note })),
    omittedPaths: [...snapshot.omittedPaths],
    omissions: snapshot.omissions?.map((omission) => ({ ...omission })),
  };
}

function uniqueOmissions(omissions: ContextOmission[]): ContextOmission[] {
  const seen = new Set<string>();
  return omissions.filter((omission) => {
    const key = `${normalizePath(omission.path)}:${omission.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\//, "").trim();
}

function basename(path: string): string {
  return path.split("/").pop()?.replace(/\.md$/i, "") ?? path;
}
