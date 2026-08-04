import type {
  ContextScope,
  ContextSnapshot,
  DartContextService,
} from "./dart-context";
import type {
  VaultIndexService,
  VaultSearchOptions,
  VaultSearchResult,
} from "./vault-index";

export type ContextPickerMode = "none" | "current" | "notes" | "folder" | "related" | "recent";

export interface ContextPickerOptions {
  scope?: ContextScope;
  mode?: ContextPickerMode;
  initialPaths?: string[];
}

/**
 * Read-only vault contract exposed by Korean DART Codex.
 * Methods may update the plugin's transient context selection, but never modify vault files.
 */
export interface KoreanDartContextApiV2 {
  readonly version: 2;
  search(query: string, options?: VaultSearchOptions): Promise<VaultSearchResult[]>;
  resolve(paths: string[], scope?: ContextScope): Promise<ContextSnapshot>;
  openPicker(options?: ContextPickerOptions): Promise<ContextSnapshot | null>;
  getSessionContext(): ContextSnapshot | null;
  clearSessionContext(): void;
}

export function createKoreanDartContextApiV2(options: {
  index: VaultIndexService;
  context: DartContextService;
  openPicker: (options?: ContextPickerOptions) => Promise<ContextSnapshot | null>;
  ensureIndex?: () => Promise<unknown> | unknown;
}): KoreanDartContextApiV2 {
  return Object.freeze({
    version: 2 as const,
    search: async (query: string, searchOptions?: VaultSearchOptions) => {
      await options.ensureIndex?.();
      return options.index.search(query, searchOptions).map((result) => ({
        ...result,
        matches: [...result.matches],
        record: {
          ...result.record,
          aliases: [...result.record.aliases],
          tags: [...result.record.tags],
          headings: [...result.record.headings],
          links: [...result.record.links],
          backlinks: [...result.record.backlinks],
        },
      }));
    },
    resolve: async (paths: string[], scope: ContextScope = "turn") => (
      options.context.resolve(paths, scope)
    ),
    openPicker: async (pickerOptions?: ContextPickerOptions) => (
      options.openPicker(pickerOptions)
    ),
    getSessionContext: () => options.context.getSessionContext(),
    clearSessionContext: () => options.context.clearSessionContext(),
  });
}
