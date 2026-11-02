import { describe, expect, it } from "vitest";
import { clearSpotifyRequestState, requestSpotify, SpotifyHttpError } from "./spotify-request-manager";

function response(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("Spotify request manager", () => {
  it("deduplicates concurrent requests and caches successful responses", async () => {
    clearSpotifyRequestState();
    let calls = 0;
    const execute = () => {
      calls += 1;
      return Promise.resolve(response(200, { value: "ok" }));
    };
    const [first, second] = await Promise.all([
      requestSpotify("GET:test", execute, { cacheTtlMs: 1_000 }),
      requestSpotify("GET:test", execute, { cacheTtlMs: 1_000 })
    ]);
    expect(first).toEqual({ value: "ok" });
    expect(second).toEqual({ value: "ok" });
    await requestSpotify("GET:test", execute, { cacheTtlMs: 1_000 });
    expect(calls).toBe(1);
  });

  it("retries a rate-limited request and exposes the error classification", async () => {
    clearSpotifyRequestState();
    let calls = 0;
    const result = await requestSpotify("GET:retry", () => {
      calls += 1;
      return Promise.resolve(calls === 1
        ? response(429, { error: { reason: "RATE_LIMITED" } }, { "retry-after": "0" })
        : response(200, { ok: true }));
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(2);
    calls = 0;
    await expect(requestSpotify("GET:quota", () => {
      calls += 1;
      return Promise.resolve(response(429, { error: { reason: "QUOTA_EXCEEDED" } }, { "retry-after": "0" }));
    })).rejects.toMatchObject({ status: 429, reason: "QUOTA_EXCEEDED" });
    expect(calls).toBe(1);
    await expect(requestSpotify("GET:failure", () => Promise.resolve(response(403, { error: { reason: "PREMIUM_ACCOUNT_REQUIRED" } })))).rejects.toMatchObject({
      status: 403,
      reason: "PREMIUM_ACCOUNT_REQUIRED"
    } satisfies Partial<SpotifyHttpError>);
  });
});
