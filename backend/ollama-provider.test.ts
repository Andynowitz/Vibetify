import { afterEach, describe, expect, it, vi } from "vitest";
import { OllamaProvider } from "./ollama-provider";
import { BackendProviderError } from "./provider-error";

afterEach(() => vi.unstubAllGlobals());

const tools = [{ name: "get_spotify_profile", description: "Profile", inputSchema: { type: "object" } }];

describe("Ollama provider", () => {
  it("maps a normal response and sends the system instruction", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: "Hello locally." } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new OllamaProvider("http://127.0.0.1:11434", "qwen3-coder:30b", 1000).respond([
      { id: "1", role: "user", content: "Hello", createdAt: new Date().toISOString() }
    ], tools)).resolves.toEqual({ type: "message", content: "Hello locally." });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { model: string; messages: Array<{ role: string }>; tools: unknown[] };
    expect(body.model).toBe("qwen3-coder:30b");
    expect(body.messages[0].role).toBe("system");
    expect(body.tools).toHaveLength(1);
  });

  it("maps one and multiple tool calls", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: { tool_calls: [{ function: { name: "get_spotify_profile", arguments: {} } }] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: { tool_calls: [
        { function: { name: "get_spotify_profile", arguments: {} } },
        { function: { name: "get_spotify_profile", arguments: "{}" } }
      ] } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OllamaProvider("http://127.0.0.1:11434", "qwen3-coder:30b", 1000);
    await expect(provider.respond([], tools)).resolves.toMatchObject({ type: "tool_call", call: { name: "get_spotify_profile", input: {} } });
    await expect(provider.respond([], tools)).resolves.toMatchObject({ type: "tool_calls", calls: [{ name: "get_spotify_profile" }, { name: "get_spotify_profile" }] });
  });

  it("passes prior tool calls and results back to Ollama", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: "You are connected as Mock Listener." } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await new OllamaProvider("http://127.0.0.1:11434", "qwen3-coder:30b", 1000).respond([
      { id: "user", role: "user", content: "Who am I?", createdAt: new Date().toISOString() },
      { id: "tool", role: "tool", content: "", createdAt: new Date().toISOString(), toolCall: { id: "call-1", name: "get_spotify_profile", input: {} }, toolResult: { name: "get_spotify_profile", ok: true, data: { displayName: "Mock Listener" } } }
    ], tools);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { messages: Array<{ role: string; content: string }> };
    expect(body.messages.map(message => message.role)).toEqual(["system", "user", "assistant", "tool"]);
    expect(body.messages[3].content).toContain("Mock Listener");
  });

  it("groups multiple tool results under one assistant tool-call message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: "Recovered." } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await new OllamaProvider("http://127.0.0.1:11434", "qwen3-coder:30b", 1000).respond([
      { id: "tool-1", role: "tool", content: "", createdAt: new Date().toISOString(), toolCall: { id: "call-1", name: "get_spotify_profile", input: {} }, toolResult: { name: "get_spotify_profile", ok: false, error: "Profile unavailable." } },
      { id: "tool-2", role: "tool", content: "", createdAt: new Date().toISOString(), toolCall: { id: "call-2", name: "get_spotify_profile", input: {} }, toolResult: { name: "get_spotify_profile", ok: true, data: { displayName: "Mock Listener" } } }
    ], tools);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { messages: Array<{ role: string; tool_calls?: unknown[]; content: string }> };
    expect(body.messages.map(message => message.role)).toEqual(["system", "assistant", "tool", "tool"]);
    expect(body.messages[1].tool_calls).toHaveLength(2);
    expect(body.messages[2].content).toContain("Profile unavailable");
    expect(body.messages[3].content).toContain("Mock Listener");
  });

  it("rejects malformed tool arguments and invalid responses", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: { tool_calls: [{ function: { name: "get_spotify_profile", arguments: "not-json" } }] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: {} }), { status: 200 })));
    const provider = new OllamaProvider("http://127.0.0.1:11434", "qwen3-coder:30b", 1000);
    await expect(provider.respond([], tools)).rejects.toMatchObject({ kind: "invalid_response" });
    await expect(provider.respond([], tools)).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("rejects text-formatted tool calls instead of returning them as assistant text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: { content: "<tool_call><function=get_listening_history></function>" }
    }), { status: 200 })));
    await expect(new OllamaProvider("http://127.0.0.1:11434", "qwen3-coder:30b", 1000).respond([], tools))
      .rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("distinguishes a missing model from an unavailable server", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "model not found" }), { status: 404 })));
    await expect(new OllamaProvider("http://127.0.0.1:11434", "missing", 1000).respond([], [])).rejects.toMatchObject({ kind: "not_found", status: 404 });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(new OllamaProvider("http://127.0.0.1:11434", "missing", 1000).respond([], [])).rejects.toMatchObject({ kind: "network" });
  });

  it("checks API availability and model installation", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: "qwen3-coder:30b" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: "other" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response("offline", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OllamaProvider("http://127.0.0.1:11434", "qwen3-coder:30b", 1000);
    await expect(provider.check()).resolves.toEqual({ available: true, modelInstalled: true });
    await expect(provider.check()).resolves.toEqual({ available: true, modelInstalled: false });
    await expect(provider.check()).resolves.toEqual({ available: false, modelInstalled: false });
  });

  it("classifies timeouts", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    await expect(new OllamaProvider("http://127.0.0.1:11434", "qwen3-coder:30b", 5).respond([], [])).rejects.toBeInstanceOf(BackendProviderError);
    await expect(new OllamaProvider("http://127.0.0.1:11434", "qwen3-coder:30b", 5).respond([], [])).rejects.toMatchObject({ kind: "timeout" });
  });
});
