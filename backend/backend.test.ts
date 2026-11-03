import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIProvider, OpenAIProviderError } from "./openai-provider";
import { AccessTokenService, FixedWindowRateLimiter } from "./security";

afterEach(() => vi.unstubAllGlobals());

describe("backend security", () => {
  it("issues short-lived tokens and rejects tampering", () => {
    const service = new AccessTokenService("test-secret", 60);
    const token = service.issue("user-1");
    expect(service.verify(`Bearer ${token}`)).toBe("user-1");
    expect(service.verify(`Bearer ${token}x`)).toBeUndefined();
    expect(service.verify(undefined)).toBeUndefined();
  });

  it("limits requests within a fixed window", () => {
    const limiter = new FixedWindowRateLimiter(2, 60_000);
    expect(limiter.allow("user")).toBe(true);
    expect(limiter.allow("user")).toBe(true);
    expect(limiter.allow("user")).toBe(false);
    expect(limiter.allow("other")).toBe(true);
  });
});

describe("OpenAI provider adapter", () => {
  it("maps tool calls and includes registered tool schemas", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: [{ type: "function_call", call_id: "call-1", name: "get_spotify_playlists", arguments: "{\"limit\":5}" }]
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new OpenAIProvider("secret", "test-model", 1000).respond([
      { id: "user", role: "user", content: "Show my playlists", createdAt: new Date().toISOString() }
    ], [{ name: "get_spotify_playlists", description: "Playlists", inputSchema: { type: "object" } }]);
    expect(result).toMatchObject({ type: "tool_call", call: { id: "call-1", name: "get_spotify_playlists", input: { limit: 5 } } });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { tools: Array<{ name: string }> };
    expect(body.tools[0].name).toBe("get_spotify_playlists");
  });

  it("maps final text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text: "Hello from AI." }] }]
    }), { status: 200 })));
    await expect(new OpenAIProvider("secret", "test-model", 1000).respond([], [])).resolves.toEqual({ type: "message", content: "Hello from AI." });
  });

  it.each([
    [401, "authentication", "invalid_api_key"],
    [429, "rate_limit", "insufficient_quota"],
    [400, "invalid_request", "model_not_found"],
    [500, "server", "server_error"]
  ] as const)("preserves safe diagnostics for OpenAI status %s", async (status, kind, code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: "provider detail", type: "provider_error", code }
    }), { status, headers: { "x-request-id": "req-123" } })));
    const error = await new OpenAIProvider("secret", "test-model", 1000).respond([], []).catch(value => value);
    expect(error).toBeInstanceOf(OpenAIProviderError);
    expect(error).toMatchObject({ kind, status, providerMessage: "provider detail", providerType: "provider_error", providerCode: code, requestId: "req-123" });
    expect((error as Error).message).not.toContain("provider detail");
    expect((error as Error).message).not.toContain("secret");
  });

  it("handles malformed provider error bodies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 500 })));
    await expect(new OpenAIProvider("secret", "test-model", 1000).respond([], [])).rejects.toMatchObject({ kind: "server", status: 500 });
  });

  it("classifies network failures without exposing credentials", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network failed with secret")));
    const error = await new OpenAIProvider("secret", "test-model", 1000).respond([], []).catch(value => value);
    expect(error).toMatchObject({ kind: "network" });
    expect((error as Error).message).not.toContain("secret");
  });

  it("classifies abort errors as timeouts", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    await expect(new OpenAIProvider("secret", "test-model", 5).respond([], [])).rejects.toMatchObject({ kind: "timeout" });
  });
});
