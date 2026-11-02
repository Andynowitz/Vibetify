import { describe, expect, it } from "vitest";
import { clearSpotifyRequestState, getSpotifyRequestDiagnostics, invalidateSpotifyCache, requestSpotify, SpotifyHttpError } from "./spotify-request-manager";

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

  it("limits concurrent requests to two and prioritizes essential queued work", async () => {
    clearSpotifyRequestState();
    let active = 0;
    let maximum = 0;
    const started: string[] = [];
    const execute = (name: string) => new Promise<Response>(resolve => {
      active += 1;
      maximum = Math.max(maximum, active);
      started.push(name);
      setTimeout(() => { active -= 1; resolve(response(200, { name })); }, 15);
    });
    const first = requestSpotify("GET:first", () => execute("first"));
    const second = requestSpotify("GET:second", () => execute("second"));
    const optional = requestSpotify("GET:optional", () => execute("optional"));
    const essential = requestSpotify("GET:essential", () => execute("essential"), { priority: "essential" });
    await Promise.all([first, second, optional, essential]);
    expect(maximum).toBe(2);
    expect(started.slice(2)).toEqual(["essential", "optional"]);
  });

  it("reports aggregate request diagnostics without sensitive data", async () => {
    clearSpotifyRequestState();
    const execute = () => Promise.resolve(response(200, { ok: true }));
    await Promise.all([
      requestSpotify("GET:/v1/me", execute, { cacheTtlMs: 1_000, feature: "profile" }),
      requestSpotify("GET:/v1/me", execute, { cacheTtlMs: 1_000, feature: "profile" })
    ]);
    const summary = getSpotifyRequestDiagnostics();
    expect(summary.sessionRequests).toBe(1);
    expect(summary.duplicateRequestsPrevented).toBe(1);
    expect(summary.requestsByFeature.profile).toBe(1);
    expect(JSON.stringify(summary)).not.toContain("token");
  });

  it("expires and invalidates cached responses", async () => {
    clearSpotifyRequestState();
    let calls = 0;
    const execute = () => { calls += 1; return Promise.resolve(response(200, { calls })); };
    await requestSpotify("GET:cache", execute, { cacheTtlMs: 5 });
    await new Promise(resolve => setTimeout(resolve, 10));
    await requestSpotify("GET:cache", execute, { cacheTtlMs: 5 });
    invalidateSpotifyCache("GET:cache");
    await requestSpotify("GET:cache", execute, { cacheTtlMs: 5 });
    expect(calls).toBe(3);
  });
});
