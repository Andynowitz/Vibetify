import type { SpotifyAlbum, SpotifyArtist, SpotifyPage, SpotifyPlaylist, SpotifyPlaylistItem, SpotifyTrack } from "./spotify-api";

export type SpotifyMockStatus = "200" | "401" | "403" | "429" | "QUOTA_EXCEEDED" | "500" | "network";
export type SpotifyMockConfig = { enabled: boolean; status: SpotifyMockStatus; delayMs: number };
export const mockProfile = { id: "mock-user", displayName: "Mock Listener", accountId: "mock-account", imageUrl: "https://i.scdn.co/image/mock-avatar", spotifyUrl: "https://open.spotify.com/user/mock-user" };

let config: SpotifyMockConfig = {
  enabled: process.env.VITE_SPOTIFY_MOCK_MODE === "true",
  status: "200",
  delayMs: 20
};
const artists: SpotifyArtist[] = [
  { id: "artist-aurora", name: "Aurora Lane", genres: ["indie pop"], images: [{ url: "https://images.example.com/aurora.jpg" }] },
  { id: "artist-night", name: "The Night Signals", genres: ["alternative"], images: [{ url: "https://images.example.com/night.jpg" }] },
  { id: "artist-sunday", name: "Sunday Static", genres: ["dream pop"], images: [{ url: "https://images.example.com/sunday.jpg" }] },
  { id: "artist-cassette", name: "Cassette Hearts", genres: ["synthpop"], images: [{ url: "https://images.example.com/cassette.jpg" }] }
];
const tracks: SpotifyTrack[] = Array.from({ length: 20 }, (_, index) => {
  const artist = artists[index % artists.length];
  return {
    id: `track-${index + 1}`,
    name: ["Midnight Echo", "Golden Hour", "Paper Satellites", "Static Hearts", "Afterglow"][index % 5],
    duration_ms: 180000 + index * 7000,
    artists: [artist],
    album: { id: `album-${(index % 4) + 1}`, name: ["Neon Seasons", "Signal Fires", "Soft Focus", "Late Checkout"][index % 4], images: artist.images },
    external_urls: { spotify: `https://open.spotify.com/track/track-${index + 1}` }
  };
});
const albums: SpotifyAlbum[] = artists.map((artist, index) => ({
  id: `album-${index + 1}`,
  name: ["Neon Seasons", "Signal Fires", "Soft Focus", "Late Checkout"][index],
  artists: [artist],
  album_type: "album",
  release_date: `202${index + 2}-0${index + 1}-15`,
  total_tracks: 5,
  images: artist.images,
  tracks: { items: tracks.filter(track => track.artists[0].id === artist.id), total: 5, limit: 5, offset: 0, next: null }
}));
const playlists: SpotifyPlaylist[] = Array.from({ length: 8 }, (_, index) => ({
  id: `playlist-${index + 1}`,
  name: ["Morning Focus", "Late Night Drives", "Discover Weekly Archive", "Indie Rotation", "Weekend Energy", "Quiet Hours", "Fresh Finds", "All-Time Favorites"][index],
  description: "A curated mock playlist for offline development.",
  owner: { display_name: mockProfile.displayName, id: mockProfile.id },
  images: [{ url: `https://images.example.com/playlist-${index + 1}.jpg` }],
  external_urls: { spotify: `https://open.spotify.com/playlist/playlist-${index + 1}` },
  tracks: { total: 5 + (index % 4) }
}));
const likedIds = new Set(["track-1", "track-3", "track-5", "track-8", "track-13", "track-18"]);
const recent = tracks.slice(0, 10).map((track, index) => ({ played_at: new Date(Date.now() - index * 3600000).toISOString(), track, context: { type: "playlist", uri: `spotify:playlist:playlist-${(index % 8) + 1}` } }));

export function getSpotifyMockConfig(): SpotifyMockConfig { return { ...config }; }
export function setSpotifyMockConfig(next: Partial<SpotifyMockConfig>): SpotifyMockConfig {
  config = { ...config, ...next, delayMs: Math.max(0, Math.min(5000, Math.floor(next.delayMs ?? config.delayMs))) };
  return getSpotifyMockConfig();
}

function page<T>(items: T[], limit = 20): SpotifyPage<T> {
  return { items, total: items.length, limit, offset: 0, next: null };
}
function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? undefined : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}
function findId(path: string, prefix: string): string | undefined {
  return path.split("/")[2] ?? (path.startsWith(prefix) ? path.slice(prefix.length) : undefined);
}
function playlistItems(id: string): SpotifyPlaylistItem[] {
  const offset = Math.max(0, Number(new URLSearchParams(id.split("?")[1] ?? "").get("offset") ?? 0));
  return tracks.slice(offset, offset + 5).map((track, index) => ({ added_at: new Date(Date.now() - index * 86400000).toISOString(), track }));
}

export async function mockSpotifyRequest(url: string, method: string, requestBody?: string): Promise<Response> {
  if (!config.enabled) throw new Error("Spotify mock mode is disabled.");
  if (config.delayMs) await new Promise(resolve => setTimeout(resolve, config.delayMs));
  if (config.status === "network") throw new Error("Mock network error.");
  if (config.status !== "200") {
    const body = config.status === "QUOTA_EXCEEDED" ? { error: { reason: "QUOTA_EXCEEDED", message: "Mock quota exhausted." } } : { error: { reason: "MOCK_ERROR", message: `Mock HTTP ${config.status}.` } };
    return response(config.status === "QUOTA_EXCEEDED" ? 429 : Number(config.status), body, config.status === "429" || config.status === "QUOTA_EXCEEDED" ? { "retry-after": "1" } : {});
  }
  const parsed = new URL(url);
  const path = parsed.pathname.replace("/v1", "");
  if (path === "/me") return response(200, mockProfile);
  if (path === "/me/playlists") return response(200, page(playlists));
  if (path === "/me/tracks") return response(200, page(tracks.filter(track => likedIds.has(track.id)).map(track => ({ added_at: new Date().toISOString(), track }))));
  if (path === "/me/player/recently-played") return response(200, page(recent));
  if (path === "/me/top/artists") return response(200, page(artists));
  if (path === "/me/top/tracks") return response(200, page(tracks.slice(0, 10)));
  if (path === "/me/library/contains") return response(200, (parsed.searchParams.get("uris") ?? "").split(",").filter(Boolean).map(uri => likedIds.has(uri.replace("spotify:track:", ""))));
  if (path === "/me/library" && (method === "PUT" || method === "DELETE")) {
    const requested = (() => {
      try { return JSON.parse(requestBody ?? "{}") as { uris?: unknown[] }; } catch { return {}; }
    })();
    const ids = Array.isArray(requested.uris) ? requested.uris.filter((uri): uri is string => typeof uri === "string").map(uri => uri.replace("spotify:track:", "")) : [];
    ids.forEach(id => method === "PUT" ? likedIds.add(id) : likedIds.delete(id));
    return response(204, "");
  }
  if (path === "/search") {
    const query = (parsed.searchParams.get("q") ?? "").toLowerCase();
    return response(200, { tracks: page(tracks.filter(track => track.name.toLowerCase().includes(query) || track.artists[0].name.toLowerCase().includes(query)).slice(0, 10)), artists: page(artists.filter(artist => artist.name.toLowerCase().includes(query))), albums: page(albums.filter(album => album.name.toLowerCase().includes(query))), playlists: page(playlists.filter(playlist => playlist.name.toLowerCase().includes(query))) });
  }
  if (path.startsWith("/playlists/") && path.endsWith("/items")) return response(200, { ...page(playlistItems(path.slice("/playlists/".length))), items: playlistItems(path.slice("/playlists/".length)) });
  if (path.startsWith("/playlists/")) {
    const id = findId(path, "/playlists/");
    return response(200, { ...playlists.find(playlist => playlist.id === id) ?? playlists[0], items: { total: 5 } });
  }
  if (path.startsWith("/tracks/")) return response(200, tracks.find(track => track.id === findId(path, "/tracks/")) ?? tracks[0]);
  if (path.startsWith("/albums/")) return response(200, albums.find(album => album.id === findId(path, "/albums/")) ?? albums[0]);
  if (path.startsWith("/artists/") && path.endsWith("/albums")) return response(200, page(albums));
  if (path.startsWith("/artists/")) return response(200, artists.find(artist => artist.id === findId(path, "/artists/")) ?? artists[0]);
  return response(404, { error: { reason: "MOCK_NOT_FOUND" } });
}
