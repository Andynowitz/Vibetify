export type ResourcePhase = "idle" | "loading" | "refreshing" | "ready" | "error";

export type ResourceState<T> = {
  phase: ResourcePhase;
  data?: T;
  error?: string;
  updatedAt?: number;
};

export type ResourceFetcher<T> = (refresh: boolean) => Promise<T>;

export type LoadOptions = {
  staleAfterMs?: number;
};

const DEFAULT_STALE_AFTER_MS = 5 * 60_000;

export class SpotifyDataStore {
  private readonly states = new Map<string, ResourceState<unknown>>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  get<T>(key: string): ResourceState<T> {
    return (this.states.get(key) as ResourceState<T> | undefined) ?? { phase: "idle" };
  }

  subscribe(key: string, listener: () => void): () => void {
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(key);
    };
  }

  async load<T>(key: string, fetcher: ResourceFetcher<T>, options: LoadOptions = {}): Promise<T> {
    const current = this.get<T>(key);
    const fresh = current.data !== undefined
      && current.updatedAt !== undefined
      && Date.now() - current.updatedAt < (options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS);
    if (fresh) return current.data as T;
    return this.run(key, fetcher, false);
  }

  refresh<T>(key: string, fetcher: ResourceFetcher<T>): Promise<T> {
    return this.run(key, fetcher, true);
  }

  private run<T>(key: string, fetcher: ResourceFetcher<T>, refresh: boolean): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;
    const task = this.execute(key, fetcher, refresh).finally(() => {
      if (this.inFlight.get(key) === task) this.inFlight.delete(key);
    });
    this.inFlight.set(key, task);
    return task;
  }

  private async execute<T>(key: string, fetcher: ResourceFetcher<T>, refresh: boolean): Promise<T> {
    const current = this.get<T>(key);
    this.setState(key, {
      phase: current.data !== undefined ? "refreshing" : "loading",
      data: current.data,
      updatedAt: current.updatedAt,
      error: undefined
    });
    try {
      const data = await fetcher(refresh);
      this.setState(key, { phase: "ready", data, updatedAt: Date.now(), error: undefined });
      return data;
    } catch (error) {
      this.setState(key, {
        phase: "error",
        data: current.data,
        updatedAt: current.updatedAt,
        error: error instanceof Error ? error.message : "Refresh failed."
      });
      throw error;
    }
  }

  private setState(key: string, state: ResourceState<unknown>): void {
    this.states.set(key, state);
    const set = this.listeners.get(key);
    if (set) for (const listener of [...set]) listener();
  }
}

export const sharedSpotifyStore = new SpotifyDataStore();
