type SpotifyResponse = { status: number; headers: Headers; json(): Promise<unknown>; text(): Promise<string> };

export class SpotifyHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly reason?: string,
    public readonly retryAfterMs?: number,
    message = `Spotify request failed (${status}).`
  ) {
    super(message);
    this.name = "SpotifyHttpError";
  }
}

type RequestOptions<T> = {
  cacheTtlMs?: number;
  parse?: (response: SpotifyResponse) => Promise<T>;
};

const inFlight = new Map<string, Promise<unknown>>();
const cache = new Map<string, { expiresAt: number; value: unknown }>();
let cooldownUntil = 0;
let cooldownTimer: ReturnType<typeof setTimeout> | undefined;
let requestQueue: Promise<void> = Promise.resolve();
const MAX_RETRIES = 2;
const MAX_BACKOFF_MS = 30_000;

function log(event: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ component: "spotify-api", event, ...fields }));
}

function retryAfterMs(response: SpotifyResponse): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

async function wait(ms: number): Promise<void> {
  if (ms > 0) await new Promise(resolve => setTimeout(resolve, ms));
}

function activateCooldown(ms: number, honorExactDelay = false): void {
  const until = Date.now() + (honorExactDelay ? Math.max(ms, 250) : Math.min(Math.max(ms, 250), MAX_BACKOFF_MS));
  cooldownUntil = Math.max(cooldownUntil, until);
  if (cooldownTimer) clearTimeout(cooldownTimer);
  cooldownTimer = setTimeout(() => { cooldownUntil = 0; cooldownTimer = undefined; }, Math.max(0, cooldownUntil - Date.now()));
}

async function acquireSlot(): Promise<void> {
  let release!: () => void;
  const previous = requestQueue;
  requestQueue = new Promise(resolve => { release = resolve; });
  await previous;
  try {
    const delay = cooldownUntil - Date.now();
    if (delay > 0) {
      log("queued", { cooldownMs: delay });
      await wait(delay);
    }
  } finally {
    release();
  }
}

async function parseError(response: SpotifyResponse): Promise<SpotifyHttpError> {
  let reason: string | undefined;
  try {
    const body = await response.json() as { error?: { reason?: unknown; message?: unknown } };
    reason = typeof body.error?.reason === "string" ? body.error.reason : undefined;
    const message = typeof body.error?.message === "string" ? body.error.message : undefined;
    return new SpotifyHttpError(response.status, reason, retryAfterMs(response), message ? `Spotify request failed (${response.status}): ${message}` : undefined);
  } catch {
    return new SpotifyHttpError(response.status, undefined, retryAfterMs(response));
  }
}

async function run<T>(key: string, execute: () => Promise<SpotifyResponse>, options: RequestOptions<T>): Promise<T> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    log("cache-hit", { key });
    return cached.value as T;
  }
  const started = Date.now();
  let retry = 0;
  while (true) {
    await acquireSlot();
    const response = await execute();
    if (response.status === 429) {
      const error = await parseError(response);
      const delay = error.retryAfterMs ?? Math.min(1_000 * (2 ** retry), MAX_BACKOFF_MS) + Math.floor(Math.random() * 250);
      const quotaExceeded = error.reason === "QUOTA_EXCEEDED";
      activateCooldown(delay, error.retryAfterMs !== undefined);
      log("rate-limit", { key, status: 429, retry, retryAfterMs: delay, quotaExceeded: error.reason === "QUOTA_EXCEEDED" });
      if (quotaExceeded) throw error;
      if (retry++ >= MAX_RETRIES) throw error;
      await wait(delay);
      continue;
    }
    if (!response.status.toString().startsWith("2")) throw await parseError(response);
    const value = await (options.parse ? options.parse(response) : response.json() as Promise<T>);
    if (options.cacheTtlMs) cache.set(key, { expiresAt: Date.now() + options.cacheTtlMs, value });
    log("response", { key, method: "GET", status: response.status, durationMs: Date.now() - started, retry });
    return value;
  }
}

export function requestSpotify<T>(key: string, execute: () => Promise<SpotifyResponse>, options: RequestOptions<T> = {}): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) {
    log("deduplicated", { key });
    return existing as Promise<T>;
  }
  const request = run(key, execute, options).finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

export function invalidateSpotifyCache(prefix?: string): void {
  for (const key of cache.keys()) if (!prefix || key.startsWith(prefix)) cache.delete(key);
}

export function clearSpotifyRequestState(): void {
  cache.clear();
  if (cooldownTimer) clearTimeout(cooldownTimer);
  cooldownTimer = undefined;
  cooldownUntil = 0;
}
