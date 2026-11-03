import { afterEach, describe, expect, it, vi } from "vitest";
import { BackendAIProvider } from "./backend-provider";

afterEach(() => vi.unstubAllGlobals());

describe("BackendAIProvider diagnostics", () => {
  it("preserves sanitized backend errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "The AI provider rejected the request. Check the backend model configuration."
    }), { status: 400 })));
    await expect(new BackendAIProvider("http://127.0.0.1:8787", async () => "token").respond({ messages: [], tools: [] }))
      .rejects.toThrow("Check the backend model configuration");
  });

  it("distinguishes backend authorization and rate limits", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "private detail" }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "The AI provider quota is exhausted." }), { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new BackendAIProvider("http://127.0.0.1:8787", async () => "token");
    await expect(provider.respond({ messages: [], tools: [] })).rejects.toThrow("authorization expired");
    await expect(provider.respond({ messages: [], tools: [] })).rejects.toThrow("quota is exhausted");
  });

  it("reports an unavailable backend without exposing connection details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed: secret-token")));
    await expect(new BackendAIProvider("http://127.0.0.1:8787", async () => "token").respond({ messages: [], tools: [] }))
      .rejects.toThrow("backend is unavailable");
    await expect(new BackendAIProvider("http://127.0.0.1:8787", async () => "token").respond({ messages: [], tools: [] }))
      .rejects.not.toThrow("secret-token");
  });

  it("reads the configured backend provider and model status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      provider: "ollama", model: "qwen3-coder:30b", available: true, modelInstalled: true
    }), { status: 200 })));
    await expect(new BackendAIProvider("http://127.0.0.1:8787", async () => "token").status())
      .resolves.toEqual({ provider: "ollama", model: "qwen3-coder:30b", available: true, modelInstalled: true });
  });
});
