export interface VaultIndexRecord {
  path: string;
  title: string;
  basename: string;
  folder: string;
  aliases: string[];
  tags: string[];
  frontmatter: string;
  headings: string[];
  links: string[];
  backlinks: string[];
  mtime: number;
  size: number;
  excerpt: string;
}

export interface VaultIndexMetadata {
  frontmatter?: Record<string, unknown>;
  headings?: string[];
  tags?: string[];
  links?: string[];
  backlinks?: string[];
}

export interface CreateVaultIndexRecordInput {
  path: string;
  basename: string;
  mtime: number;
  size: number;
  content: string;
  metadata?: VaultIndexMetadata;
}

export interface VaultSearchOptions {
  folder?: string;
  tags?: string[];
  limit?: number;
}

export interface VaultSearchResult {
  record: VaultIndexRecord;
  score: number;
  matches: string[];
}

export interface ContextEstimate {
  selectedCount: number;
  includedCount: number;
  estimatedChars: number;
  truncated: boolean;
}

export interface ContextEstimateBudget {
  maxNotes: number;
  maxChars: number;
  perNoteChars: number;
}

export type VaultIndexPhase = "idle" | "indexing" | "ready";

export interface VaultIndexStatus {
  phase: VaultIndexPhase;
  indexedCount: number;
  totalCount: number;
  updatedAt: number;
  failureCount: number;
}

const SAFE_FRONTMATTER_KEYS = new Set([
  "title",
  "aliases",
  "alias",
  "tags",
  "tag",
  "type",
  "status",
  "category",
  "categories",
  "company_names",
  "corp_codes",
  "receipt_numbers",
  "ticker",
  "market",
  "date",
  "created",
  "modified",
]);

const SECRET_KEY_PATTERN = /(?:api[-_]?key|secret|token|password|passwd|cookie|authorization|oauth|private[-_]?key|pat)/i;

export class VaultIndexService {
  private readonly records = new Map<string, VaultIndexRecord>();
  private readonly statusListeners = new Set<(status: VaultIndexStatus) => void>();
  private suppressStatusUpdates = false;
  private status: VaultIndexStatus = {
    phase: "idle",
    indexedCount: 0,
    totalCount: 0,
    updatedAt: 0,
    failureCount: 0,
  };

  constructor(initial: VaultIndexRecord[] = []) {
    this.replaceAll(initial);
    if (initial.length) {
      this.status = {
        phase: "ready",
        indexedCount: this.records.size,
        totalCount: this.records.size,
        updatedAt: Date.now(),
        failureCount: 0,
      };
    }
  }

  get size(): number {
    return this.records.size;
  }

  getStatus(): VaultIndexStatus {
    return { ...this.status };
  }

  subscribeStatus(listener: (status: VaultIndexStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  beginIndexing(totalCount: number): void {
    this.setStatus({
      phase: "indexing",
      indexedCount: 0,
      totalCount: Math.max(0, totalCount),
      updatedAt: this.status.updatedAt,
      failureCount: 0,
    });
  }

  reportIndexing(indexedCount: number, failureCount = 0): void {
    this.setStatus({
      ...this.status,
      phase: "indexing",
      indexedCount: Math.min(
        Math.max(0, indexedCount),
        Math.max(this.status.totalCount, indexedCount),
      ),
      totalCount: Math.max(this.status.totalCount, indexedCount),
      failureCount: Math.max(0, failureCount),
    });
  }

  completeIndexing(failureCount = 0): void {
    this.setStatus({
      phase: "ready",
      indexedCount: this.records.size,
      totalCount: this.records.size + Math.max(0, failureCount),
      updatedAt: Date.now(),
      failureCount: Math.max(0, failureCount),
    });
  }

  markUpdated(failureCount = this.status.failureCount): void {
    if (this.status.phase === "indexing") return;
    this.setStatus({
      phase: "ready",
      indexedCount: this.records.size,
      totalCount: this.records.size + Math.max(0, failureCount),
      updatedAt: Date.now(),
      failureCount: Math.max(0, failureCount),
    });
  }

  replaceAll(records: VaultIndexRecord[]): void {
    this.records.clear();
    this.suppressStatusUpdates = true;
    try {
      for (const record of records) this.upsert(record);
    } finally {
      this.suppressStatusUpdates = false;
    }
  }

  upsert(record: VaultIndexRecord, updateStatus = true): void {
    if (!record.path.toLowerCase().endsWith(".md")) return;
    this.records.set(normalizePath(record.path), normalizeRecord(record));
    if (updateStatus && !this.suppressStatusUpdates) this.markUpdated();
  }

  delete(path: string): void {
    this.records.delete(normalizePath(path));
    if (!this.suppressStatusUpdates) this.markUpdated();
  }

  rename(oldPath: string, record: VaultIndexRecord, updateStatus = true): void {
    this.suppressStatusUpdates = true;
    try {
      this.delete(oldPath);
      this.upsert(record);
    } finally {
      this.suppressStatusUpdates = false;
    }
    if (updateStatus) this.markUpdated();
  }

  get(path: string): VaultIndexRecord | undefined {
    return this.records.get(normalizePath(path));
  }

  list(): VaultIndexRecord[] {
    return [...this.records.values()].sort(compareByTitle);
  }

  listFolders(): string[] {
    return [...new Set(this.list().map((record) => record.folder).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "ko"));
  }

  resolve(paths: string[]): VaultIndexRecord[] {
    const seen = new Set<string>();
    const output: VaultIndexRecord[] = [];
    for (const path of paths) {
      const normalized = normalizePath(path);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      const record = this.records.get(normalized);
      if (record) output.push(record);
    }
    return output;
  }

  search(query: string, options: VaultSearchOptions = {}): VaultSearchResult[] {
    const normalizedQuery = normalizeSearchText(query);
    const terms = searchTerms(query);
    const folder = normalizePath(options.folder ?? "").replace(/\/$/, "");
    const requiredTags = (options.tags ?? []).map(normalizeTag).filter(Boolean);
    const results: VaultSearchResult[] = [];

    for (const record of this.records.values()) {
      if (folder && record.folder !== folder && !record.folder.startsWith(`${folder}/`)) continue;
      const normalizedTags = record.tags.map(normalizeTag);
      if (requiredTags.some((tag) => !normalizedTags.includes(tag))) continue;

      const scored = scoreRecord(record, normalizedQuery, terms);
      if (query.trim() && scored.score <= 0) continue;
      results.push({ record, ...scored });
    }

    return results
      .sort((a, b) => b.score - a.score || b.record.mtime - a.record.mtime || compareByTitle(a.record, b.record))
      .slice(0, Math.max(1, options.limit ?? 50));
  }

  findRelated(path: string, limit = 30): VaultSearchResult[] {
    const source = this.get(path);
    if (!source) return [];
    const sourceTags = new Set(source.tags.map(normalizeTag));
    const sourceHeadings = new Set(source.headings.map(normalizeSearchText));
    const sourceTerms = new Set(searchTerms(`${source.title} ${source.aliases.join(" ")}`));
    const direct = new Set([...source.links, ...source.backlinks].map(normalizePath));
    const results: VaultSearchResult[] = [];

    for (const record of this.records.values()) {
      if (record.path === source.path) continue;
      let score = 0;
      const matches: string[] = [];
      if (direct.has(record.path) || record.links.includes(source.path) || record.backlinks.includes(source.path)) {
        score += 100;
        matches.push("link");
      }
      const sharedTags = record.tags.map(normalizeTag).filter((tag) => sourceTags.has(tag));
      if (sharedTags.length) {
        score += sharedTags.length * 22;
        matches.push("tag");
      }
      const sharedHeadings = record.headings.map(normalizeSearchText).filter((heading) => sourceHeadings.has(heading));
      if (sharedHeadings.length) {
        score += sharedHeadings.length * 9;
        matches.push("heading");
      }
      const recordTerms = new Set(searchTerms(`${record.title} ${record.aliases.join(" ")}`));
      const sharedTerms = [...recordTerms].filter((term) => sourceTerms.has(term) && term.length >= 2);
      if (sharedTerms.length) {
        score += sharedTerms.length * 6;
        matches.push("title");
      }
      if (score > 0) results.push({ record, score, matches });
    }

    return results
      .sort((a, b) => b.score - a.score || b.record.mtime - a.record.mtime || compareByTitle(a.record, b.record))
      .slice(0, Math.max(1, limit));
  }

  updateBacklinks(path: string, backlinks: string[]): void {
    const record = this.get(path);
    if (!record) return;
    this.suppressStatusUpdates = true;
    try {
      this.upsert({ ...record, backlinks: uniqueStrings(backlinks.map(normalizePath)) });
    } finally {
      this.suppressStatusUpdates = false;
    }
  }

  estimate(paths: string[], budget: ContextEstimateBudget): ContextEstimate {
    const records = this.resolve(paths);
    let estimatedChars = 0;
    let includedCount = 0;
    let truncated = records.length < new Set(paths.map(normalizePath)).size;
    for (const record of records) {
      if (includedCount >= budget.maxNotes || estimatedChars >= budget.maxChars) {
        truncated = true;
        continue;
      }
      const available = budget.maxChars - estimatedChars;
      const included = Math.min(record.size, budget.perNoteChars, available);
      if (included <= 0) {
        truncated = true;
        continue;
      }
      includedCount += 1;
      estimatedChars += included;
      if (included < record.size) truncated = true;
    }
    return {
      selectedCount: new Set(paths.map(normalizePath)).size,
      includedCount,
      estimatedChars,
      truncated,
    };
  }

  private setStatus(status: VaultIndexStatus): void {
    this.status = { ...status };
    const snapshot = this.getStatus();
    for (const listener of this.statusListeners) listener(snapshot);
  }
}

export function createVaultIndexRecord(input: CreateVaultIndexRecordInput): VaultIndexRecord {
  const metadata = input.metadata ?? {};
  const frontmatter = metadata.frontmatter ?? {};
  const aliases = uniqueStrings([
    ...stringValues(frontmatter.aliases),
    ...stringValues(frontmatter.alias),
  ]);
  const tags = uniqueStrings([
    ...stringValues(frontmatter.tags),
    ...stringValues(frontmatter.tag),
    ...(metadata.tags ?? []),
  ].map(normalizeTag).filter(Boolean));
  const safeFrontmatter = Object.entries(frontmatter)
    .filter(([key]) => SAFE_FRONTMATTER_KEYS.has(key.toLowerCase()) && !SECRET_KEY_PATTERN.test(key))
    .flatMap(([key, value]) => stringValues(value).map((item) => `${key} ${redactSensitiveText(item)}`))
    .join(" ");
  const frontmatterTitle = stringValues(frontmatter.title)[0];
  const path = normalizePath(input.path);

  return normalizeRecord({
    path,
    title: frontmatterTitle || input.basename,
    basename: input.basename,
    folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
    aliases,
    tags,
    frontmatter: safeFrontmatter,
    headings: uniqueStrings(metadata.headings ?? []),
    links: uniqueStrings((metadata.links ?? []).map(normalizePath)),
    backlinks: uniqueStrings((metadata.backlinks ?? []).map(normalizePath)),
    mtime: input.mtime,
    size: input.size,
    excerpt: buildExcerpt(input.content),
  });
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/gi, "[redacted]")
    .replace(
      /(\b(?:api[-_]?key|secret|token|password|passwd|cookie|authorization|oauth|private[-_]?key|pat)\b\s*[:=]\s*)([^\s,;]+)/gi,
      "$1[redacted]",
    );
}

function buildExcerpt(content: string): string {
  const withoutFrontmatter = content.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, "");
  const cleaned = redactSensitiveText(withoutFrontmatter)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?]]/g, "$1")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/[*_`>|~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 420);
}

function scoreRecord(
  record: VaultIndexRecord,
  normalizedQuery: string,
  terms: string[],
): { score: number; matches: string[] } {
  if (!normalizedQuery) return { score: 1, matches: [] };
  const fields: Array<[string, number, string]> = [
    [record.title, 120, "title"],
    [record.basename, 100, "basename"],
    [record.aliases.join(" "), 92, "alias"],
    [record.tags.join(" "), 70, "tag"],
    [record.path, 52, "path"],
    [record.headings.join(" "), 42, "heading"],
    [record.frontmatter, 34, "frontmatter"],
    [[...record.links, ...record.backlinks].join(" "), 26, "link"],
    [record.excerpt, 14, "excerpt"],
  ];
  let score = 0;
  const matches: string[] = [];
  for (const [rawValue, weight, label] of fields) {
    const value = normalizeSearchText(rawValue);
    if (!value) continue;
    if (value === normalizedQuery) {
      score += weight * 2;
      matches.push(label);
      continue;
    }
    if (value.includes(normalizedQuery)) {
      score += weight;
      matches.push(label);
      continue;
    }
    const termMatches = terms.filter((term) => term.length >= 2 && value.includes(term)).length;
    if (termMatches > 0) {
      score += termMatches * Math.max(2, Math.round(weight / Math.max(terms.length, 2)));
      matches.push(label);
    }
  }
  return { score, matches: uniqueStrings(matches) };
}

function normalizeRecord(record: VaultIndexRecord): VaultIndexRecord {
  return {
    ...record,
    path: normalizePath(record.path),
    title: redactSensitiveText(record.title.trim() || record.basename),
    basename: redactSensitiveText(record.basename.trim()),
    folder: normalizePath(record.folder),
    aliases: uniqueStrings(record.aliases.map(redactSensitiveText)),
    tags: uniqueStrings(record.tags.map(normalizeTag).filter(Boolean)),
    frontmatter: redactSensitiveText(record.frontmatter),
    headings: uniqueStrings(record.headings.map(redactSensitiveText)),
    links: uniqueStrings(record.links.map(normalizePath)),
    backlinks: uniqueStrings(record.backlinks.map(normalizePath)),
    mtime: Number.isFinite(record.mtime) ? record.mtime : 0,
    size: Number.isFinite(record.size) ? Math.max(0, record.size) : 0,
    excerpt: redactSensitiveText(record.excerpt).slice(0, 420),
  };
}

function stringValues(value: unknown): string[] {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [String(value).trim()].filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.flatMap(stringValues);
  }
  return [];
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ko").replace(/\s+/g, " ").trim();
}

function searchTerms(value: string): string[] {
  const normalized = normalizeSearchText(value);
  return uniqueStrings([
    normalized,
    ...normalized.split(/[^\p{L}\p{N}]+/u),
  ].filter(Boolean));
}

function normalizeTag(value: string): string {
  return normalizeSearchText(value).replace(/^#+/, "");
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\//, "").trim();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function compareByTitle(a: VaultIndexRecord, b: VaultIndexRecord): number {
  return a.title.localeCompare(b.title, "ko") || a.path.localeCompare(b.path, "ko");
}
