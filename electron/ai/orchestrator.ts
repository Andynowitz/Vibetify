import { getAuthState } from "../spotify-auth";
import { getFavoriteGenre, getMostPlayedPlaylistsEstimate, getMostRecentArtist, getMostRecentPlaylist, getRecentlyPlayedTracks, getSpotifyPlaylists, getTopItems } from "../spotify-api";
import { ConversationManager } from "./conversation-manager";
import { MockAIProvider } from "./mock-provider";
import { noInput, optionalLimit, ToolRegistry } from "./tool-registry";
import type { AIMessage, AIProvider, AIToolCall, Conversation } from "./types";

const MAX_TOOL_CALLS = 3;

export function createAIService(conversationManager: ConversationManager, clientId: string, provider: AIProvider = new MockAIProvider()) {
  const registry = new ToolRegistry();
  registry.register({
    name: "get_spotify_profile",
    description: "Read useful connected Spotify profile information such as display name and profile link. Do not expose internal account identifiers unless explicitly requested. This tool requires no parameters.",
    permission: "read-only",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    validate: noInput,
    execute: async () => {
      const state = await getAuthState(clientId);
      if (!state.connected || !state.profile) throw new Error(state.error ?? "Spotify is not connected.");
      return { displayName: state.profile.displayName, imageUrl: state.profile.imageUrl, spotifyUrl: state.profile.spotifyUrl };
    }
  });
  registry.register({
    name: "get_spotify_playlists",
    description: "Read the user's Spotify playlists and playlist totals. Optional limit must be an integer from 1 to 20 and defaults to 8.",
    permission: "read-only",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 20 } }, additionalProperties: false },
    validate: optionalLimit,
    execute: async input => {
      const page = await getSpotifyPlaylists(clientId, 0);
      return { ...page, items: page.items.slice(0, input.limit as number) };
    }
  });
  registry.register({
    name: "get_listening_stats",
    description: "Read short-term top artists, top tracks, and up to 50 recently played tracks when Spotify provides recent-play history. This tool requires no parameters.",
    permission: "read-only",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    validate: noInput,
    execute: async () => compactListeningStats(await getTopItems(clientId, "short_term"))
  });
  registry.register({
    name: "get_recently_played_tracks",
    description: "Return exactly the requested number of the user's most recently played Spotify tracks, sorted newest first by played_at. Include track, artist, album and playback time. This is playback history, not popularity. The limit is required and must be an integer from 1 to 50.",
    permission: "read-only",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50 } }, required: ["limit"], additionalProperties: false },
    validate: recentTrackLimit,
    execute: input => getRecentlyPlayedTracks(clientId, input.limit as number)
  });
  registry.register({
    name: "get_most_recent_artist",
    description: "Return the artist or artists from the newest Spotify recently-played track, determined by played_at. Do not use top artists or popularity rankings. This tool requires no parameters.",
    permission: "read-only",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    validate: noInput,
    execute: () => getMostRecentArtist(clientId)
  });
  registry.register({
    name: "get_favorite_genre",
    description: "Estimate favorite genres from long-term top-artist genre metadata using deterministic rank-weighted aggregation. This is an estimate, not an explicit Spotify favorite-genre field, and honestly reports when genre metadata is unavailable.",
    permission: "read-only",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    validate: noInput,
    execute: () => getFavoriteGenre(clientId)
  });
  registry.register({
    name: "get_most_recent_playlist",
    description: "Identify the playlist associated with the newest recently-played track only when Spotify playback context is a playlist URI. Never infer it from playlist order, creation date, track count, or collection metadata.",
    permission: "read-only",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    validate: noInput,
    execute: () => getMostRecentPlaylist(clientId)
  });
  registry.register({
    name: "get_most_played_playlists_estimate",
    description: "Estimate which playlists appear most often in the available recently-played sample by matching played track IDs to playlist contents. Example: 'Which playlists do I listen to most?'. This is not an official Spotify playlist play count, not lifetime data, and considers at most 50 history records and 10 playlists. It requires no parameters.",
    permission: "read-only",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    validate: noInput,
    execute: () => getMostPlayedPlaylistsEstimate(clientId)
  });

  return {
    async send(conversationId: string, content: string): Promise<{ conversation: Conversation; toolActivity: string[] }> {
      return conversationManager.runExclusive(conversationId, async () => {
        const message = createMessage("user", content);
        let conversation = await conversationManager.append(conversationId, message);
        const toolActivity: string[] = [];
        let executedToolCalls = 0;
        const routedCalls = routeRequest(content);
        for (;;) {
          let response: Awaited<ReturnType<AIProvider["respond"]>>;
          if (executedToolCalls === 0 && routedCalls) {
            const firstCall = routedCalls[0];
            if (routedCalls.length === 1 && firstCall) response = { type: "tool_call", call: firstCall };
            else response = { type: "tool_calls", calls: routedCalls };
          } else {
            response = await provider.respond({ messages: conversation.messages.slice(-40), tools: registry.definitions() });
          }

          if (response.type === "message") {
            conversation = await conversationManager.append(conversationId, createMessage("assistant", response.content));
            return { conversation, toolActivity };
          }
          const calls = response.type === "tool_calls" ? response.calls : [response.call];
          if (!calls.length) throw new Error("The assistant returned no tool calls.");
          for (const call of calls) {
            if (executedToolCalls >= MAX_TOOL_CALLS) throw new Error(`The assistant reached its limit of ${MAX_TOOL_CALLS} tool executions for this request.`);
            executedToolCalls += 1;
            toolActivity.push(activityFor(call.name));
            const result = await registry.execute(call.name, call.input);
            conversation = await conversationManager.append(conversationId, createMessage("tool", "", call, result));
            if (result.ok && ["get_recently_played_tracks", "get_most_recent_artist", "get_favorite_genre", "get_most_recent_playlist"].includes(call.name)) {
              conversation = await conversationManager.append(conversationId, createMessage("assistant", formatGroundedSpotifyResult(call.name, result.data)));
              return { conversation, toolActivity };
            }
          }
        }
      });
    },
    listTools: () => ["get_spotify_profile", "get_spotify_playlists", "get_listening_stats", "get_recently_played_tracks", "get_most_recent_artist", "get_favorite_genre", "get_most_recent_playlist", "get_most_played_playlists_estimate"]
  };
}

function compactListeningStats(stats: Awaited<ReturnType<typeof getTopItems>>) {
  return {
    artists: {
      ...stats.artists,
      items: stats.artists.items.map(artist => ({ id: artist.id, name: artist.name }))
    },
    tracks: {
      ...stats.tracks,
      items: stats.tracks.items.map(track => ({
        id: track.id,
        name: track.name,
        artists: track.artists.map(artist => ({ id: artist.id, name: artist.name })),
        album: { id: track.album.id, name: track.album.name }
      }))
    },
    recentTracks: {
      ...stats.recentTracks,
      items: stats.recentTracks.items.map(item => ({
        played_at: item.played_at,
        track: item.track ? {
          id: item.track.id,
          name: item.track.name,
          artists: item.track.artists.map(artist => ({ id: artist.id, name: artist.name })),
          album: { id: item.track.album.id, name: item.track.album.name }
        } : undefined
      }))
    }
  };
}

function recentTrackLimit(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") throw new Error("A track limit from 1 to 50 is required.");
  const limit = (input as { limit?: unknown }).limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Track limit must be an integer from 1 to 50.");
  return { limit };
}

function formatGroundedSpotifyResult(name: string, data: unknown): string {
  if (name === "get_most_recent_artist") {
    const result = data as { artistNames?: string[]; trackName?: string; playedAt?: string };
    if (!result.artistNames?.length) return "Spotify did not provide any recently played tracks.";
    const timestamp = result.playedAt ? ` at ${result.playedAt}` : "";
    return `The most recently played artist${result.artistNames.length > 1 ? "s are" : " is"} ${result.artistNames.join(", ")}, from the track ${result.trackName ?? "Unknown track"}${timestamp}.`;
  }
  if (name === "get_favorite_genre") {
    const result = data as { genres?: Array<{ name: string }>; artistsConsidered?: number; artistsWithGenres?: number };
    if (!result.genres?.length) return "Spotify did not provide enough top-artist genre metadata to estimate a favorite genre.";
    return `Based on long-term top-artist genre metadata, your listening preferences seem to lean towards ${result.genres.slice(0, 3).map(genre => genre.name).join(", ")}. This is a deterministic estimate from ${result.artistsWithGenres ?? 0} of ${result.artistsConsidered ?? 0} artists, not an explicitly defined Spotify favorite genre.`;
  }
  if (name === "get_most_recent_playlist") {
    const result = data as { available?: boolean; playlistName?: string; playedAt?: string };
    return result.available && result.playlistName
      ? `Your most recently played playlist appears to be ${result.playlistName}${result.playedAt ? ` at ${result.playedAt}` : ""}.`
      : "I can see your recently played tracks, but Spotify has not provided enough playlist playback context to identify which playlist they came from.";
  }
  const result = data as { items?: Array<{ track: { name: string; artists: Array<{ name: string }>; album: { name: string } }; played_at?: string }> };
  if (!result.items?.length) return "Spotify did not provide any recently played tracks.";
  return `### Recently Played Tracks\n\n${result.items.map((item, index) => `${index + 1}. **${item.track.name}** — ${item.track.artists.map(artist => artist.name).join(", ")} · ${item.track.album.name}${item.played_at ? ` · ${item.played_at}` : ""}`).join("\n")}`;
}

function createMessage(role: AIMessage["role"], content: string, toolCall?: AIMessage["toolCall"], toolResult?: AIMessage["toolResult"]): AIMessage {
  return { id: crypto.randomUUID(), role, content, createdAt: new Date().toISOString(), ...(toolCall ? { toolCall } : {}), ...(toolResult ? { toolResult } : {}) };
}

function activityFor(name: string): string {
  if (name === "get_spotify_profile") return "Looking up your Spotify profile...";
  if (name === "get_spotify_playlists") return "Looking up your Spotify playlists...";
  if (name === "get_most_played_playlists_estimate") return "Estimating playlist activity from available listening history...";
  return "Looking up your listening statistics...";
}

function routeRequest(content: string): AIToolCall[] | undefined {
  const value = content.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ").trim();
  const calls = (names: string[]) => names.map(name => ({ id: crypto.randomUUID(), name, input: {} }));
  const profile = /\b(profile|who am i|logged in|connected to spotify|spotify username|account)\b/.test(value);
  const playlistCount = /\b(how many|total number|number of|count|total)\b/.test(value) && /\bplaylist/.test(value);
  const playlists = /\b(show|list|what|which|tell me about)\b.*\bplaylist/.test(value) || /\bmy playlists\b/.test(value);
  const mostPlayedPlaylists = /\b(most played|listen to most|most listened)\b.*\bplaylist/.test(value);
  const recent = /\b(recently played|most recent|most recently played|last (?:\d+|one|two|three|four|five|six|seven|eight|nine|ten))\b/.test(value);
  const recentArtist = /\b(most recently listened artist|most recently played artist|artist .*recently|recently .*artist)\b/.test(value);
  const favoriteGenre = /\b(favorite|favourite|preferred|best)\s+genre\b/.test(value);
  const recentPlaylist = /\b(most recent|most recently played|recently played)\s+playlist\b/.test(value);
  const top = /\b(top artists|top tracks|favorite artist|most played artist|most listened)\b/.test(value);
  if (mostPlayedPlaylists) return calls(["get_most_played_playlists_estimate"]);
  if (favoriteGenre) return calls(["get_favorite_genre"]);
  if (recentPlaylist) return calls(["get_most_recent_playlist"]);
  if (profile && (playlistCount || playlists)) return calls(["get_spotify_profile", "get_spotify_playlists"]);
  if (profile) return calls(["get_spotify_profile"]);
  if (playlistCount || playlists) return calls(["get_spotify_playlists"]);
  if (recentArtist) return calls(["get_most_recent_artist"]);
  if (recent) return [{ id: crypto.randomUUID(), name: "get_recently_played_tracks", input: { limit: extractRecentLimit(value) } }];
  if (top) return calls(["get_listening_stats"]);
  return undefined;
}

function extractRecentLimit(value: string): number {
  const match = value.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/);
  if (!match) return 5;
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  return Math.max(1, Math.min(50, Number(match[1]) || words[match[1]] || 5));
}
