/**
 * RuntimeMemory — the Brain's short-term memory for ONE execution.
 *
 * A simple typed key→value store where the Brain keeps the goal, the plan, the
 * policy result, and (later) per-step progress. Keeping this behind an interface
 * means a future version could swap in a persistent store without changing the
 * Brain.
 */
export interface RuntimeMemory {
  set<T>(key: string, value: T): void;
  get<T>(key: string): T | undefined;
  has(key: string): boolean;
  delete(key: string): void;
  keys(): readonly string[];
  /** A read-only copy of everything stored (handy for debugging/inspection). */
  snapshot(): Readonly<Record<string, unknown>>;
}

/** A plain in-memory implementation backed by a Map. */
export class InMemoryRuntimeMemory implements RuntimeMemory {
  private readonly store = new Map<string, unknown>();

  set<T>(key: string, value: T): void {
    this.store.set(key, value);
  }

  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  keys(): readonly string[] {
    return [...this.store.keys()];
  }

  snapshot(): Readonly<Record<string, unknown>> {
    return Object.fromEntries(this.store);
  }
}
