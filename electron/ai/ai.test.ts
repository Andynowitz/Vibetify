import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ConversationManager } from "./conversation-manager";
import { MockAIProvider } from "./mock-provider";
import { createAIService } from "./orchestrator";
import { noInput, ToolRegistry } from "./tool-registry";
import { setSpotifyMockConfig } from "../spotify-mock";
import { getFavoriteGenre, getMostPlayedPlaylistsEstimate, getMostRecentArtist, getMostRecentPlaylist, getRecentlyPlayedTracks, getTopItems, playlistIdFromPlaybackContext, selectRecentTracks, type RecentTrack } from "../spotify-api";
import { clearSpotifyRequestState } from "../spotify-request-manager";
import type { AIMessage, AIProvider } from "./types";

describe("mock AI foundation", () => {
  it("requests the registered playlist tool", async () => {
    const response = await new MockAIProvider().respond({ messages: [{ id: "1", role: "user", content: "Show my playlists", createdAt: new Date().toISOString() }] });
    expect(response.type).toBe("tool_call");
    expect(response.type === "tool_call" && response.call.name).toBe("get_spotify_playlists");
  });

  it("uses the current user message instead of a previous tool result", async () => {
    const provider = new MockAIProvider();
    const messages: AIMessage[] = [];
    const requests = [
      "Who am I connected to on Spotify?",
      "Show me my Spotify playlists.",
      "Who am I connected to on Spotify?",
      "What have I been listening to lately?",
      "Show me my Spotify playlists."
    ];
    const expected = ["get_spotify_profile", "get_spotify_playlists", "get_spotify_profile", "get_listening_stats", "get_spotify_playlists"];
    for (let index = 0; index < requests.length; index += 1) {
      messages.push({ id: `user-${index}`, role: "user", content: requests[index], createdAt: new Date().toISOString() });
      const response = await provider.respond({ messages });
      expect(response.type === "tool_call" && response.call.name).toBe(expected[index]);
      if (response.type !== "tool_call") continue;
      messages.push({
        id: `tool-${index}`,
        role: "tool",
        content: "",
        createdAt: new Date().toISOString(),
        toolCall: response.call,
        toolResult: { name: response.call.name, ok: true, data: response.call.name === "get_spotify_playlists" ? { items: [{ name: "Morning Focus" }] } : response.call.name === "get_spotify_profile" ? { displayName: "Mock Listener" } : { artists: { items: [{ name: "Aurora Lane" }] }, tracks: { items: [{ name: "Midnight Echo" }] } } }
      });

      messages.push({ id: `assistant-${index}`, role: "assistant", content: "result", createdAt: new Date().toISOString() });
    }
  });

  it("keeps consecutive orchestrated turns aligned with their requests", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "vibetify-ai-orchestrator-"));
    try {
      setSpotifyMockConfig({ enabled: true, status: "200" });
      const manager = new ConversationManager(path.join(directory, "conversations.json"));
      const conversation = await manager.create();
      const service = createAIService(manager, "test-client");
      const prompts = ["Who am I connected to on Spotify?", "Show me my Spotify playlists.", "Who am I connected to on Spotify?", "What have I been listening to lately?", "Show me my Spotify playlists."];
      const responses: string[] = [];
      for (const prompt of prompts) {
        const result = await service.send(conversation.id, prompt);
        const assistantMessages = result.conversation.messages.filter(message => message.role === "assistant");
        responses.push(assistantMessages[assistantMessages.length - 1]?.content ?? "");
      }
      expect(responses[0]).toContain("Mock Listener");
      expect(responses[1]).toContain("Morning Focus");
      expect(responses[2]).toContain("Mock Listener");
      expect(responses[3]).toContain("Aurora Lane");
      expect(responses[4]).toContain("Morning Focus");
    } finally {
      setSpotifyMockConfig({ enabled: false });
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps separate conversations independent", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "vibetify-ai-conversations-"));
    try {
      setSpotifyMockConfig({ enabled: true, status: "200" });
      const manager = new ConversationManager(path.join(directory, "conversations.json"));
      const first = await manager.create();
      const second = await manager.create();
      const service = createAIService(manager, "test-client");
      const playlist = await service.send(first.id, "Show me my playlists.");
      const profile = await service.send(second.id, "Who am I connected to?");
      const firstProfile = await service.send(first.id, "Who am I connected to?");
      expect(playlist.conversation.messages[playlist.conversation.messages.length - 1].content).toContain("Morning Focus");
      expect(profile.conversation.messages[profile.conversation.messages.length - 1].content).toContain("Mock Listener");
      expect(firstProfile.conversation.messages[firstProfile.conversation.messages.length - 1].content).toContain("Mock Listener");
    } finally {
      setSpotifyMockConfig({ enabled: false });
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not contaminate separate conversations with tool results", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "vibetify-ai-isolation-"));
    try {
      setSpotifyMockConfig({ enabled: true, status: "200" });
      const manager = new ConversationManager(path.join(directory, "conversations.json"));
      const first = await manager.create();
      const second = await manager.create();
      const service = createAIService(manager, "test-client");
      await service.send(first.id, "Show me my five most recently played tracks.");
      const result = await service.send(second.id, "What is my favorite genre?");
      expect(result.conversation.messages.map(message => message.toolResult?.name)).not.toContain("get_recently_played_tracks");
      expect(result.conversation.messages.at(-1)?.content).toContain("long-term top-artist genre metadata");
    } finally {
      setSpotifyMockConfig({ enabled: false });
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("handles follow-ups from the relevant previous tool result", async () => {
    const provider = new MockAIProvider();
    const playlistResult: AIMessage = { id: "tool", role: "tool", content: "", createdAt: new Date().toISOString(), toolResult: { name: "get_spotify_playlists", ok: true, data: { items: [{ name: "Morning Focus", tracks: { total: 5 } }] } } };
    const response = await provider.respond({ messages: [
      { id: "user", role: "user", content: "Show me my playlists.", createdAt: new Date().toISOString() },
      playlistResult,
      { id: "assistant", role: "assistant", content: "You have one playlist.", createdAt: new Date().toISOString() },
      { id: "follow-up", role: "user", content: "Can you tell me more about my playlists?", createdAt: new Date().toISOString() }
    ] });
    expect(response).toMatchObject({ type: "message" });
    expect(response.type === "message" && response.content).toContain("Morning Focus");
  });

  it("uses the ranked top artist for favorite artist questions", async () => {
    const provider = new MockAIProvider();
    const request = { messages: [{ id: "user", role: "user" as const, content: "What's my favorite artist?", createdAt: new Date().toISOString() }] };
    const toolCall = await provider.respond(request);
    expect(toolCall).toMatchObject({ type: "tool_call", call: { name: "get_listening_stats" } });
    if (toolCall.type !== "tool_call") return;
    const response = await provider.respond({ messages: [
      ...request.messages,
      { id: "tool", role: "tool", content: "", createdAt: new Date().toISOString(), toolCall: toolCall.call, toolResult: { name: toolCall.call.name, ok: true, data: { artists: { items: [{ name: "Aurora Lane" }] }, tracks: { items: [] } } } }
    ] });
    expect(response.type === "message" && response.content).toContain("Aurora Lane");
  });

  it("does not turn unsupported questions into Spotify tool calls", async () => {
    const response = await new MockAIProvider().respond({ messages: [{ id: "1", role: "user", content: "What's the weather today?", createdAt: new Date().toISOString() }] });
    expect(response).toEqual({ type: "message", content: "I can't answer that yet. I can currently help you explore your Spotify profile, playlists and listening statistics." });
  });

  it("rejects unknown tools and invalid inputs", async () => {
    const registry = new ToolRegistry();
    registry.register({ name: "profile", description: "Profile", permission: "read-only", validate: noInput, execute: async () => ({}) });
    await expect(registry.execute("missing", {})).resolves.toMatchObject({ ok: false });
    await expect(registry.execute("profile", { unexpected: true })).resolves.toMatchObject({ ok: false });
  });

  it("defaults a missing playlist limit to 8 and recovers from invalid limits", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "vibetify-ai-recovery-"));
    try {
      setSpotifyMockConfig({ enabled: true, status: "200" });
      const manager = new ConversationManager(path.join(directory, "conversations.json"));
      const conversation = await manager.create();
      let step = 0;
      const provider: AIProvider = {
        id: "test",
        async respond(request) {
          step += 1;
          if (step === 1) return { type: "tool_call", call: { id: "bad", name: "get_spotify_playlists", input: { limit: 5.5 } } };
          if (step === 2) {
            expect(request.messages.at(-1)?.toolResult).toMatchObject({ ok: false, error: "Limit must be an integer from 1 to 20." });
            return { type: "tool_call", call: { id: "good", name: "get_spotify_playlists", input: {} } };
          }
          expect(request.messages.at(-1)?.toolResult).toMatchObject({ ok: true });
          return { type: "message", content: "Recovered with the default playlist limit." };
        }
      };
      const result = await createAIService(manager, "test-client", provider).send(conversation.id, "Please retrieve the collection.");
      expect(result.conversation.messages.filter(message => message.role === "tool")).toHaveLength(2);
      expect(result.conversation.messages.at(-1)?.content).toContain("Recovered");
    } finally {
      setSpotifyMockConfig({ enabled: false });
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("passes Spotify tool failures back to the provider without taking down the service", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "vibetify-ai-tool-error-"));
    try {
      setSpotifyMockConfig({ enabled: true, status: "500" });
      clearSpotifyRequestState();
      const manager = new ConversationManager(path.join(directory, "conversations.json"));
      const conversation = await manager.create();
      let step = 0;
      const provider: AIProvider = {
        id: "test",
        async respond(request) {
          step += 1;
          if (step === 1) return { type: "tool_call", call: { id: "playlists", name: "get_spotify_playlists", input: {} } };
          expect(request.messages.at(-1)?.toolResult?.ok).toBe(false);
          return { type: "message", content: "Spotify is temporarily unavailable." };
        }
      };
      const result = await createAIService(manager, "test-client", provider).send(conversation.id, "Who am I connected to?");
      expect(result.conversation.messages.at(-1)?.content).toContain("temporarily unavailable");
    } finally {
      setSpotifyMockConfig({ enabled: false });
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("executes at most three individual tool calls", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "vibetify-ai-limit-"));
    try {
      setSpotifyMockConfig({ enabled: true, status: "200" });
      const manager = new ConversationManager(path.join(directory, "conversations.json"));
      const conversation = await manager.create();
      const provider: AIProvider = {
        id: "test",
        async respond() {
          return { type: "tool_calls", calls: [
            { id: crypto.randomUUID(), name: "get_spotify_profile", input: {} },
            { id: crypto.randomUUID(), name: "get_spotify_profile", input: {} },
            { id: crypto.randomUUID(), name: "get_spotify_profile", input: {} },
            { id: crypto.randomUUID(), name: "get_spotify_profile", input: {} }
          ] };
        }
      };
      await expect(createAIService(manager, "test-client", provider).send(conversation.id, "Do many lookups.")).rejects.toThrow("limit of 3");
      const saved = await manager.get(conversation.id);
      expect(saved?.messages.filter(message => message.role === "tool")).toHaveLength(3);
    } finally {
      setSpotifyMockConfig({ enabled: false });
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("returns recently played tracks in listening statistics", async () => {
    setSpotifyMockConfig({ enabled: true, status: "200" });
    try {
      const stats = await getTopItems("test-client", "short_term");
      expect(stats.recentTracks.items).toHaveLength(10);
      expect(stats.recentTracks.items[0].track.artists[0].name).toBeTruthy();
      expect(stats.recentTracks.items[0].played_at).toBeTruthy();
    } finally {
      setSpotifyMockConfig({ enabled: false });
    }
  });

  it("selects exactly five recent tracks in descending playback order", () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      played_at: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
      track: { id: String(index), name: `Track ${index}`, duration_ms: 1, artists: [{ id: "artist", name: "Artist" }], album: { name: "Album" } }
    })) as RecentTrack[];
    const selected = selectRecentTracks(items, 5);
    expect(selected).toHaveLength(5);
    expect(selected.map(item => item.track.name)).toEqual(["Track 9", "Track 8", "Track 7", "Track 6", "Track 5"]);
  });

  it("selects exactly ten tracks and keeps multiple artists", async () => {
    setSpotifyMockConfig({ enabled: true, status: "200" });
    try {
      const result = await getRecentlyPlayedTracks("test-client", 10);
      expect(result.items).toHaveLength(10);
      expect(result.items.every(item => item.track.artists.length >= 1)).toBe(true);
      expect(result.items.map(item => Date.parse(item.played_at)).every((time, index, values) => index === 0 || time <= values[index - 1])).toBe(true);
    } finally {
      setSpotifyMockConfig({ enabled: false });
    }
  });

  it("identifies the artist from the newest playback timestamp", async () => {
    setSpotifyMockConfig({ enabled: true, status: "200" });
    try {
      const result = await getMostRecentArtist("test-client");
      expect(result.artistNames).toEqual(["Aurora Lane"]);
      expect(result.trackName).toBe("Midnight Echo");
      expect(result.playedAt).toBeTruthy();
    } finally {
      setSpotifyMockConfig({ enabled: false });
    }
  });

  it("estimates favorite genre from available long-term artist genres", async () => {
    setSpotifyMockConfig({ enabled: true, status: "200" });
    try {
      const result = await getFavoriteGenre("test-client");
      expect(result.artistsWithGenres).toBeGreaterThan(0);
      expect(result.genres[0]?.name).toBeTruthy();
    } finally {
      setSpotifyMockConfig({ enabled: false });
    }
  });

  it("distinguishes playlist playback context from album or missing context", () => {
    expect(playlistIdFromPlaybackContext({ type: "playlist", uri: "spotify:playlist:playlist-1" })).toBe("playlist-1");
    expect(playlistIdFromPlaybackContext({ type: "album", uri: "spotify:album:album-1" })).toBeUndefined();
    expect(playlistIdFromPlaybackContext(null)).toBeUndefined();
  });

  it("does not infer recent playlist from collection order", async () => {
    setSpotifyMockConfig({ enabled: true, status: "200" });
    try {
      const result = await getMostRecentPlaylist("test-client");
      expect(result.available).toBe(true);
      expect(result.playlistName).toBe("Morning Focus");
    } finally {
      setSpotifyMockConfig({ enabled: false });
    }
  });

  it("keeps invalid timestamps after valid timestamps and handles empty history", () => {
    const base = { id: "1", name: "Track", duration_ms: 1, artists: [{ id: "a", name: "Artist" }], album: { name: "Album" } };
    const items = [
      { played_at: "invalid", track: base },
      { played_at: "2026-01-01T00:00:00Z", track: base }
    ] as RecentTrack[];
    expect(selectRecentTracks(items, 2)[0].played_at).toBe("2026-01-01T00:00:00Z");
    expect(selectRecentTracks([], 5)).toEqual([]);
  });

  it("routes requested recent-track counts and recent artist deterministically", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "vibetify-ai-recent-routing-"));
    try {
      setSpotifyMockConfig({ enabled: true, status: "200" });
      const manager = new ConversationManager(path.join(directory, "conversations.json"));
      const conversation = await manager.create();
      const service = createAIService(manager, "test-client");
      const five = await service.send(conversation.id, "Show me my five most recently played tracks.");
      expect(five.conversation.messages.at(-1)?.content.match(/^\d+\./gm)).toHaveLength(5);
      const ten = await service.send(conversation.id, "Show me my ten most recently played tracks.");
      expect(ten.conversation.messages.at(-1)?.content.match(/^\d+\./gm)).toHaveLength(10);
      const artist = await service.send(conversation.id, "Which artist have I listened to most recently?");
      expect(artist.conversation.messages.at(-1)?.content).toContain("most recently played artist");
    } finally {
      setSpotifyMockConfig({ enabled: false });
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("routes combined profile and playlist-count questions to both exact tools", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "vibetify-ai-routing-"));
    try {
      setSpotifyMockConfig({ enabled: true, status: "200" });
      const manager = new ConversationManager(path.join(directory, "conversations.json"));
      const conversation = await manager.create();
      const calls: string[] = [];
      const provider: AIProvider = {
        id: "routing-test",
        async respond(request) {
          const toolMessages = request.messages.filter(message => message.role === "tool");
          if (!toolMessages.length) return { type: "message", content: "Unexpectedly skipped tools." };
          calls.push(...toolMessages.map(message => message.toolResult?.name ?? ""));
          return { type: "message", content: `Profile and ${toolMessages[1]?.toolResult?.data && (toolMessages[1].toolResult.data as { total?: number }).total} playlists.` };
        }
      };
      const result = await createAIService(manager, "test-client", provider).send(conversation.id, "Show me my Spotify profile and the total number of playlists in my account.");
      expect(calls).toEqual(["get_spotify_profile", "get_spotify_playlists"]);
      expect(result.conversation.messages.at(-1)?.content).toContain("8 playlists");
    } finally {
      setSpotifyMockConfig({ enabled: false });
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("estimates playlist activity without treating track totals as plays", async () => {
    setSpotifyMockConfig({ enabled: true, status: "200" });
    try {
      const estimate = await getMostPlayedPlaylistsEstimate("test-client");
      expect(estimate.basis).toBe("recently-played-sample");
      expect(estimate.historyRecordsConsidered).toBe(10);
      expect(estimate.rankings.every(item => item.matchedPlays >= 1)).toBe(true);
      expect(JSON.stringify(estimate)).not.toContain("tracks");
    } finally {
      setSpotifyMockConfig({ enabled: false });
    }
  });

  it("executes multiple model-selected tools and preserves their results", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "vibetify-ai-multi-tool-"));
    try {
      setSpotifyMockConfig({ enabled: true, status: "200" });
      const manager = new ConversationManager(path.join(directory, "conversations.json"));
      const conversation = await manager.create();
      let call = 0;
      const provider: AIProvider = {
        id: "test",
        async respond(request) {
          call += 1;
          if (call === 1) return { type: "tool_calls", calls: [
            { id: "profile", name: "get_spotify_profile", input: {} },
            { id: "playlists", name: "get_spotify_playlists", input: { limit: 2 } }
          ] };
          expect(request.messages.filter(message => message.role === "tool")).toHaveLength(2);
          return { type: "message", content: "I found your profile and playlists." };
        }
      };
      const result = await createAIService(manager, "test-client", provider).send(conversation.id, "Compare two Spotify data sources.");
      expect(result.conversation.messages.filter(message => message.role === "tool")).toHaveLength(2);
      expect(result.conversation.messages.at(-1)?.content).toContain("profile and playlists");
    } finally {
      setSpotifyMockConfig({ enabled: false });
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("persists and restores conversations", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "vibetify-ai-"));
    const file = path.join(directory, "conversations.json");
    try {
      const manager = new ConversationManager(file);
      const conversation = await manager.create();
      await manager.append(conversation.id, { id: "message", role: "user", content: "Hello", createdAt: new Date().toISOString() });
      const restored = new ConversationManager(file);
      await expect(restored.get(conversation.id)).resolves.toMatchObject({ messages: [{ content: "Hello" }] });
      await expect(readFile(file, "utf8")).resolves.toContain("Hello");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
