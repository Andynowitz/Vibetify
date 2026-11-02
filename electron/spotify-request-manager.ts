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
  feature?: string;
  priority?: "essential" | "optional";
  method?: string;
};

type CacheEntry = { expiresAt: number; value: unknown };
type QueueEntry = { run: () => void; priority: number };

export type SpotifyRequestDiagnostics = {
  sessionRequests: number;
  cacheMisses: number;
  duplicateRequestsPrevented: number;
  cacheHits: number;
  currentConcurrentRequests: number;
  maximumObservedConcurrency: number;
  failedRequests: number;
  cooldownRejected: number;
  queuedRequests: number;
  retries: number;
  requestsByEndpoint: Record<string, number>;
  requestsByFeature: Record<string, number>;
};

const inFlight = new Map<string, Promise<unknown>>();
const cache = new Map<string, CacheEntry>();
const queue: QueueEntry[] = [];
const MAX_CONCURRENT_REQUESTS = 2;
let activeRequests = 0;
let cooldownUntil = 0;
let cooldownTimer: ReturnType<typeof setTimeout> | undefined;
let diagnostics: SpotifyRequestDiagnostics = emptyDiagnostics();
const MAX_RETRIES = 2;
const MAX_BACKOFF_MS = 30_000;

function emptyDiagnostics(): SpotifyRequestDiagnostics {
  return {
    sessionRequests: 0,
    cacheMisses: 0,
    duplicateRequestsPrevented: 0,
    cacheHits: 0,
    currentConcurrentRequests: 0,
    maximumObservedConcurrency: 0,
    failedRequests: 0,
    cooldownRejected: 0,
    queuedRequests: 0,
    retries: 0,
    requestsByEndpoint: {},
    requestsByFeature: {}
  };
}

function log(event: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ component: "spotify-api", event, ...fields }));
}

function endpointFromKey(key: string): string {
  const separator = key.indexOf(":");
  if (separator < 0) return key;
  const value = key.slice(separator + 1);
  const bodySeparator = value.indexOf(":{");
  const endpoint = bodySeparator >= 0 ? value.slice(0, bodySeparator) : value.replace(/:$/, "");
  return endpoint.replace(/^https:\/\/api\.spotify\.com\/v1/, "");
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
  cooldownTimer = setTimeout(() => {
    cooldownUntil = 0;
    cooldownTimer = undefined;
    pump();
  }, Math.max(0, cooldownUntil - Date.now()));
}

async function parseError(response: SpotifyResponse): Promise<SpotifyHttpError> {
  try {
    const body = await response.json() as { error?: { reason?: unknown; message?: unknown } };
    const reason = typeof body.error?.reason === "string" ? body.error.reason : undefined;
    const message = typeof body.error?.message === "string" ? body.error.message : undefined;
    return new SpotifyHttpError(response.status, reason, retryAfterMs(response), message ? `Spotify request failed (${response.status}): ${message}` : undefined);
  } catch {
    return new SpotifyHttpError(response.status, undefined, retryAfterMs(response));
  }
}

async function run<T>(key: string, execute: () => Promise<SpotifyResponse>, options: RequestOptions<T>): Promise<T> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    diagnostics.cacheHits += 1;
    log("cache-hit", { endpoint: endpointFromKey(key), feature: options.feature ?? "unknown" });
    return cached.value as T;
  }
  diagnostics.cacheMisses += 1;

  const started = Date.now();
  let retry = 0;
  while (true) {
    if (cooldownUntil > Date.now()) diagnostics.cooldownRejected += 1;
    await wait(Math.max(0, cooldownUntil - Date.now()));
    const response = await execute();
    diagnostics.sessionRequests += 1;
    const endpoint = endpointFromKey(key);
    diagnostics.requestsByEndpoint[endpoint] = (diagnostics.requestsByEndpoint[endpoint] ?? 0) + 1;
    const feature = options.feature ?? "unknown";
    diagnostics.requestsByFeature[feature] = (diagnostics.requestsByFeature[feature] ?? 0) + 1;
    if (response.status === 429) {
      const error = await parseError(response);
      const delay = error.retryAfterMs ?? Math.min(1_000 * (2 ** retry), MAX_BACKOFF_MS) + Math.floor(Math.random() * 250);
      const quotaExceeded = error.reason === "QUOTA_EXCEEDED";
      activateCooldown(delay, error.retryAfterMs !== undefined);
      log("rate-limit", { endpoint, status: 429, retry, retryAfterMs: delay, quotaExceeded });
      if (quotaExceeded || retry++ >= MAX_RETRIES) {
        diagnostics.failedRequests += 1;
        throw error;
      }
      diagnostics.retries += 1;
      await wait(delay);
      continue;
    }
    if (!response.status.toString().startsWith("2")) {
      diagnostics.failedRequests += 1;
      throw await parseError(response);
    }
    const value = await (options.parse ? options.parse(response) : response.json() as Promise<T>);
    if (options.cacheTtlMs) cache.set(key, { expiresAt: Date.now() + options.cacheTtlMs, value });
    log("response", { endpoint, method: options.method ?? "GET", status: response.status, durationMs: Date.now() - started, feature, retry });
    return value;
  }
}

function pump(): void {
  if (cooldownUntil > Date.now()) return;
  while (activeRequests < MAX_CONCURRENT_REQUESTS && queue.length) {
    const entry = queue.shift();
    if (!entry) return;
    activeRequests += 1;
    diagnostics.currentConcurrentRequests = activeRequests;
    diagnostics.maximumObservedConcurrency = Math.max(diagnostics.maximumObservedConcurrency, activeRequests);
    entry.run();
  }
}

export function requestSpotify<T>(key: string, execute: () => Promise<SpotifyResponse>, options: RequestOptions<T> = {}): Promise<T> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    diagnostics.cacheHits += 1;
    return Promise.resolve(cached.value as T);
  }
  const existing = inFlight.get(key);
  if (existing) {
    diagnostics.duplicateRequestsPrevented += 1;
    log("deduplicated", { endpoint: endpointFromKey(key), feature: options.feature ?? "unknown" });
    return existing as Promise<T>;
  }
  const promise = new Promise<T>((resolve, reject) => {
    queue.push({
      priority: options.priority === "essential" ? 0 : 1,
      run: () => {
        void run(key, execute, options).then(value => {
          activeRequests -= 1;
          diagnostics.currentConcurrentRequests = activeRequests;
          inFlight.delete(key);
          pump();
          resolve(value);
        }, error => {
          activeRequests -= 1;
          diagnostics.currentConcurrentRequests = activeRequests;
          inFlight.delete(key);
          pump();
          reject(error);
        });
      }
    });
    queue.sort((a, b) => a.priority - b.priority);
    if (queue.length > 1) diagnostics.queuedRequests += 1;
    pump();
  });
  inFlight.set(key, promise);
  return promise;
}

export function getSpotifyRequestDiagnostics(): SpotifyRequestDiagnostics {
  return {
    ...diagnostics,
    requestsByEndpoint: { ...diagnostics.requestsByEndpoint },
    requestsByFeature: { ...diagnostics.requestsByFeature }
  };
}

export function invalidateSpotifyCache(prefix?: string): void {
  for (const key of cache.keys()) if (!prefix || key.startsWith(prefix)) cache.delete(key);
}

export function clearSpotifyRequestState(): void {
  cache.clear();
  queue.length = 0;
  inFlight.clear();
  if (cooldownTimer) clearTimeout(cooldownTimer);
  cooldownTimer = undefined;
  cooldownUntil = 0;
  activeRequests = 0;
  diagnostics = emptyDiagnostics();
}
