import { afterEach, describe, expect, it, vi } from "vitest";
import { SpotifyDataStore } from "./spotify-store";

function defer<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

describe("SpotifyDataStore", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("loads once and reuses sufficiently fresh data", async () => {
    const store = new SpotifyDataStore();
    let calls = 0;
    const fetcher = async () => { calls += 1; return { value: calls }; };
    await store.load("resource", fetcher, { staleAfterMs: 60_000 });
    const second = await store.load("resource", fetcher, { staleAfterMs: 60_000 });
    expect(calls).toBe(1);
    expect(second).toEqual({ value: 1 });
  });

  it("manual refresh bypasses the cache and notifies subscribers", async () => {
    const store = new SpotifyDataStore();
    let calls = 0;
    const fetcher = async () => { calls += 1; return { value: calls }; };
    const observed: Array<{ data?: { value?: number } }> = [];
    store.subscribe("resource", () => observed.push(store.get("resource") as { data?: { value?: number } }));
    await store.load("resource", fetcher, { staleAfterMs: 60_000 });
    const fresh = await store.refresh("resource", fetcher);
    expect(calls).toBe(2);
    expect(fresh).toEqual({ value: 2 });
    expect(observed.some(state => state.data?.value === 2)).toBe(true);
  });

  it("deduplicates concurrent refreshes of the same resource", async () => {
    const store = new SpotifyDataStore();
    let calls = 0;
    const gate = defer<void>();
    const fetcher = async () => { calls += 1; await gate.promise; return { value: calls }; };
    const first = store.refresh("resource", fetcher);
    const second = store.refresh("resource", fetcher);
    gate.resolve();
    const [a, b] = await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(a).toEqual({ value: 1 });
    expect(b).toEqual({ value: 1 });
  });

  it("preserves data and last-updated timestamp after a failed refresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-03T15:00:00Z"));
    const store = new SpotifyDataStore();
    const fetcher = async (refresh: boolean) => { if (refresh) throw new Error("rate limited"); return { value: 1 }; };
    await store.load("resource", fetcher);
    const before = store.get<{ value: number }>("resource");
    await expect(store.refresh("resource", fetcher)).rejects.toThrow("rate limited");
    const after = store.get<{ value: number }>("resource");
    expect(after.data).toEqual({ value: 1 });
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.phase).toBe("error");
    expect(after.error).toBe("rate limited");
  });

  it("updates last-updated only after a successful request", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-03T15:00:00Z"));
    const store = new SpotifyDataStore();
    const fetcher = async (refresh: boolean) => { if (refresh) throw new Error("nope"); return { value: 1 }; };
    await store.load("resource", fetcher);
    const first = store.get<{ value: number }>("resource").updatedAt;
    await store.refresh("resource", fetcher).catch(() => undefined);
    expect(store.get<{ value: number }>("resource").updatedAt).toBe(first);
    vi.setSystemTime(new Date("2026-11-03T15:01:00Z"));
    await store.refresh("resource", async () => ({ value: 2 }));
    expect(store.get<{ value: number }>("resource").updatedAt).toBe(Date.parse("2026-11-03T15:01:00Z"));
  });

  it("auto-refreshes stale data on load but not fresh data", async () => {
    const store = new SpotifyDataStore();
    let calls = 0;
    const fetcher = async () => { calls += 1; return { value: calls }; };
    await store.load("resource", fetcher, { staleAfterMs: 0 });
    expect(calls).toBe(1);
    await store.load("resource", fetcher, { staleAfterMs: 0 });
    expect(calls).toBe(2);
    await store.load("resource", fetcher, { staleAfterMs: 60_000 });
    expect(calls).toBe(2);
  });

  it("keeps different time ranges as independent resources", async () => {
    const store = new SpotifyDataStore();
    const calls = new Map<string, number>();
    const fetcher = (key: string) => async () => { calls.set(key, (calls.get(key) ?? 0) + 1); return { key, n: calls.get(key) }; };
    await store.load("top-artists:short_term", fetcher("short"), { staleAfterMs: 60_000 });
    await store.load("top-artists:long_term", fetcher("long"), { staleAfterMs: 60_000 });
    await store.refresh("top-artists:short_term", fetcher("short"));
    expect(calls.get("short")).toBe(2);
    expect(calls.get("long")).toBe(1);
  });

  it("does not duplicate payloads when the same resource is reloaded", async () => {
    const store = new SpotifyDataStore();
    const items = [{ id: "a" }, { id: "b" }];
    const fetcher = async () => ({ items });
    await store.load("recent", fetcher);
    const again = await store.load("recent", fetcher, { staleAfterMs: 60_000 });
    expect(again.items).toBe(items);
    expect(again.items).toHaveLength(2);
  });
});
