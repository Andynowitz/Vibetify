import type { AIProvider, AIProviderRequest, AIProviderResponse } from "./types";

export class MockAIProvider implements AIProvider {
  readonly id = "mock";

  async respond(request: AIProviderRequest): Promise<AIProviderResponse> {
    const latestUserIndex = findLastIndex(request.messages, message => message.role === "user");
    const latestUser = latestUserIndex >= 0 ? request.messages[latestUserIndex].content : "";
    const normalized = normalize(latestUser);
    const currentToolResult = [...request.messages.slice(latestUserIndex + 1)].reverse().find(message => message.role === "tool");
    if (currentToolResult?.toolResult?.ok) return { type: "message", content: formatToolResult(currentToolResult.toolResult.name, currentToolResult.toolResult.data, normalized) };

    const intents = classifyIntent(normalized);
    if (intents?.length) {
      if (intents.length > 1) return { type: "tool_calls", calls: intents.map(name => ({ id: crypto.randomUUID(), name, input: {} })) };
      return { type: "tool_call", call: { id: crypto.randomUUID(), name: intents[0], input: intents[0] === "get_spotify_playlists" ? { limit: 8 } : {} } };
    }

    const previous = findPreviousResults(request.messages, latestUserIndex);
    if (isFollowUp(normalized, "playlist") && previous.playlists) return { type: "message", content: formatToolResult("get_spotify_playlists", previous.playlists, normalized) };
    if (isFollowUp(normalized, "artist") && previous.stats) return { type: "message", content: formatToolResult("get_listening_stats", previous.stats, normalized) };
    return { type: "message", content: "I can't answer that yet. I can currently help you explore your Spotify profile, playlists and listening statistics." };
  }
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ").trim();
}

function classifyIntent(value: string): Array<"get_spotify_profile" | "get_spotify_playlists" | "get_listening_stats" | "get_most_played_playlists_estimate" | "get_favorite_genre" | "get_most_recent_playlist"> {
  if (/\b(most played|listen to most|most listened)\b.*\bplaylist/.test(value)) return ["get_most_played_playlists_estimate"];
  if (/\b(favorite|favourite|preferred|best)\s+genre\b/.test(value)) return ["get_favorite_genre"];
  if (/\b(most recent|most recently played|recently played)\s+playlist\b/.test(value)) return ["get_most_recent_playlist"];
  const profile = /\b(who am i connected to|who am i logged in as|spotify username|show me my profile|what account am i using|connected to spotify|my spotify profile)\b/.test(value);
  const playlist = /\b(playlists?|playlist library)\b/.test(value);
  const count = /\b(how many|total number|number of|count|total)\b/.test(value) && playlist;
  if (profile && (playlist || count)) return ["get_spotify_profile", "get_spotify_playlists"];
  if (profile) return ["get_spotify_profile"];
  if (playlist && !/\b(more about them|tell me more)\b/.test(value)) return ["get_spotify_playlists"];
  if (/\b(recently played|most recent|last five|last 5|what have i been listening to|favorite artist|most listened to artist|artists do i listen to the most|top artists?|favorite tracks?|top tracks?)\b/.test(value)) return ["get_listening_stats"];
  return [];
}

function isFollowUp(value: string, subject: "playlist" | "artist"): boolean {
  return /\b(tell me more|what else|more about|how many|which ones)\b/.test(value) && (subject === "playlist" ? /\b(playlists?|them)\b/.test(value) : /\b(artist|them)\b/.test(value));
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) if (predicate(items[index])) return index;
  return -1;
}

function findPreviousResults(messages: AIProviderRequest["messages"], latestUserIndex: number): { playlists?: unknown; stats?: unknown } {
  const results = messages.slice(0, latestUserIndex).filter(message => message.role === "tool" && message.toolResult?.ok);
  return {
    playlists: results.reverse().find(message => message.toolResult?.name === "get_spotify_playlists")?.toolResult?.data,
    stats: results.find(message => message.toolResult?.name === "get_listening_stats")?.toolResult?.data
  };
}

function formatToolResult(name: string, data: unknown, request = ""): string {
  if (name === "get_spotify_profile") {
    const profile = data as { displayName?: string };
    return profile.displayName ? `You're currently connected to Spotify as ${profile.displayName}. Your Spotify account is connected and ready to use.` : "You're currently connected to Spotify.";
  }
  if (name === "get_spotify_playlists") {
    const playlists = data as { items?: Array<{ name: string; tracks?: { total: number } }>; total?: number };
    const items = playlists.items ?? [];
    if (!items.length) return "I could not find any playlists.";
    const names = items.slice(0, 3).map(item => item.name).join(", ");
    const suffix = items.length > 3 ? ` and ${items.length - 3} more` : "";
    return request.includes("more about") || request.includes("tell me more")
      ? `Your playlists include ${names}${suffix}. Together they offer different listening options for different moods and activities.`
      : `You have ${playlists.total ?? items.length} playlists in your library. They include ${names}${suffix}.`;
  }
  if (name === "get_most_played_playlists_estimate") {
    const estimate = data as { available?: boolean; rankings?: Array<{ playlistName: string; matchedPlays: number }>; historyRecordsConsidered?: number; playlistsConsidered?: number; limitation?: string };
    if (!estimate.available || !estimate.rankings?.length) return estimate.limitation ?? "Spotify did not provide enough data to estimate playlist activity.";
    return `Based on ${estimate.historyRecordsConsidered ?? 0} available recently played records across ${estimate.playlistsConsidered ?? 0} sampled playlists, the estimated playlist activity is ${estimate.rankings.slice(0, 3).map(item => `${item.playlistName} (${item.matchedPlays} matching plays)`).join(", ")}. This is an estimate, not an official Spotify playlist play count or lifetime ranking.`;
  }
  const stats = data as { artists?: { items?: Array<{ name: string }> }; tracks?: { items?: Array<{ name: string }> }; recentTracks?: { items?: Array<{ track: { name: string; artists: Array<{ name: string }> } }> } };
  const artists = stats.artists?.items ?? [];
  const tracks = stats.tracks?.items ?? [];
  if (request.includes("favorite artist") || request.includes("most listened") || request.includes("top artist")) {
    return artists[0]?.name ? `Your top artist is ${artists[0].name}, based on the available Spotify listening ranking.` : "Spotify did not provide a top artist.";
  }
  const recent = stats.recentTracks?.items ?? [];
  if (request.includes("recent")) {
    return recent.length
      ? `Your five most recently played tracks are ${recent.slice(0, 5).map(item => `${item.track.name} by ${item.track.artists.map(artist => artist.name).join(", ")}`).join("; ")}.`
      : "Spotify did not provide any recently played tracks.";
  }
  return `Your top artists are ${artists.slice(0, 3).map(item => item.name).join(", ") || "unavailable"}. Your top tracks include ${tracks.slice(0, 3).map(item => item.name).join(", ") || "unavailable"}.`;
}
