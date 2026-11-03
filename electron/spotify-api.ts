import { getSpotifyAccessToken, refreshSpotifyAccessToken } from "./spotify-auth";
import { getSpotifyRequestDiagnostics, invalidateSpotifyCache, requestSpotify } from "./spotify-request-manager";
import { getSpotifyMockConfig, mockSpotifyRequest } from "./spotify-mock";

export type SpotifyImage = { url: string; height?: number; width?: number };
export type SpotifyArtist = { id: string; name: string; genres?: string[]; images?: SpotifyImage[]; external_urls?: { spotify?: string } };
export type SpotifyTrack = { id: string; name: string; duration_ms: number; artists: SpotifyArtist[]; album: { id?: string; name: string; images?: SpotifyImage[]; external_urls?: { spotify?: string } }; external_urls?: { spotify?: string } };
export type SpotifyAlbum = { id: string; name: string; album_type?: string; release_date?: string; total_tracks?: number; artists: SpotifyArtist[]; images?: SpotifyImage[]; tracks?: SpotifyPage<SpotifyTrack>; external_urls?: { spotify?: string } };
export type SpotifyPlaylist = { id: string; name: string; description?: string | null; images?: SpotifyImage[]; owner?: { display_name?: string; id?: string }; external_urls?: { spotify?: string }; tracks?: { total: number } };
export type SpotifyPlaylistItem = { added_at?: string; track?: SpotifyTrack };
export type SpotifyPage<T> = { items: T[]; next: string | null; total: number; limit: number; offset: number };
export type SavedTrack = { added_at: string; track: SpotifyTrack };
export type RecentTrack = { played_at: string; track: SpotifyTrack; context?: { uri?: string; type?: string } };
export type RecentTracksResult = { items: RecentTrack[]; requested: number; available: number };
export type MostRecentArtistResult = { artistNames: string[]; trackName?: string; playedAt?: string };
export type FavoriteGenreResult = { genres: Array<{ name: string; score: number }>; artistsConsidered: number; artistsWithGenres: number; timeRange: string };
export type MostRecentPlaylistResult = { playlistName?: string; playlistId?: string; playedAt?: string; trackName?: string; available: boolean };
export function playlistIdFromPlaybackContext(context: RecentTrack["context"] | null): string | undefined {
  const uri = context?.uri;
  return typeof uri === "string" && context?.type === "playlist" ? uri.match(/^spotify:playlist:([^:]+)$/)?.[1] : undefined;
}
export type DashboardData = { playlists: SpotifyPage<SpotifyPlaylist>; likedTracks: SpotifyPage<SavedTrack>; recentTracks: SpotifyPage<RecentTrack>; topArtists: SpotifyPage<SpotifyArtist>; topTracks: SpotifyPage<SpotifyTrack> };
export type PlaylistListeningEstimate = {
  available: boolean;
  basis: "recently-played-sample";
  historyRecordsConsidered: number;
  playlistsConsidered: number;
  windowDescription: string;
  rankings: Array<{ playlistId: string; playlistName: string; matchedPlays: number; matchedHistoryRecords: number }>;
  limitation?: string;
};

type RawPlaylist = Omit<SpotifyPlaylist, "tracks"> & { tracks?: { total?: number }; items?: { total?: number } };
type RawPlaylistPage = { items?: Array<{ added_at?: string; item?: SpotifyTrack; track?: SpotifyTrack }>; next?: string | null; total?: number; limit?: number; offset?: number };

export function normalizePlaylist(raw: RawPlaylist): SpotifyPlaylist {
  const total = raw.items?.total ?? raw.tracks?.total;
  return { ...raw, tracks: typeof total === "number" ? { total } : undefined };
}

export function normalizePlaylistItems(raw: RawPlaylistPage): SpotifyPage<SpotifyPlaylistItem> {
  return {
    items: (raw.items ?? []).map(item => ({ added_at: item.added_at, track: item.item ?? item.track })).filter(item => Boolean(item.track)),
    next: raw.next ?? null,
    total: raw.total ?? raw.items?.length ?? 0,
    limit: raw.limit ?? raw.items?.length ?? 0,
    offset: raw.offset ?? 0
  };
}

export async function spotifyApiRequest<T>(clientId: string, endpoint: string, init?: RequestInit, options: { refresh?: boolean } = {}): Promise<T> {
  const url = endpoint.startsWith("http") ? endpoint : `https://api.spotify.com/v1${endpoint}`;
  const method = init?.method ?? "GET";
  const key = `${method}:${url}:${typeof init?.body === "string" ? init.body : ""}`;
  const cacheTtlMs = method === "GET"
    ? endpoint.includes("/search?") ? 30_000
      : endpoint === "/me" ? 900_000
        : endpoint.includes("/me/playlists") ? 300_000
          : endpoint.includes("/me/library/contains") ? 300_000
            : endpoint.includes("/me/player/recently-played") ? 600_000
              : endpoint.includes("/artists/") || endpoint.includes("/albums/") || endpoint.includes("/tracks/") ? 86_400_000
                : 300_000
    : undefined;
  return requestSpotify<T>(key, async () => {
    if (getSpotifyMockConfig().enabled) return mockSpotifyRequest(url, method, typeof init?.body === "string" ? init.body : undefined);
    let token = await getSpotifyAccessToken(clientId);
    let response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } });
    if (response.status === 401) {
      token = await refreshSpotifyAccessToken(clientId);
      response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } });
    }
    return response;
  }, {
    cacheTtlMs,
    feature: endpoint.startsWith("/search") ? "discover-search"
      : endpoint.includes("/me/playlists") ? "playlists"
        : endpoint.includes("/me/library") ? "saved-tracks"
          : endpoint.includes("/recently-played") ? "listening-stats"
            : endpoint === "/me" ? "profile"
              : endpoint.startsWith("/playlists/") ? "playlist-detail"
                : endpoint.startsWith("/artists/") ? "artist-detail"
                  : endpoint.startsWith("/albums/") ? "album-detail"
                    : endpoint.startsWith("/tracks/") ? "track-detail"
                      : "spotify-api",
    priority: endpoint === "/me" || endpoint.includes("/me/playlists") ? "essential" : "optional",
    method,
    refresh: options.refresh,
    parse: async response => response.status === 204 ? undefined as T : await response.json() as T
  });
}

export function getSpotifyDiagnostics() {
  return getSpotifyRequestDiagnostics();
}

function emptyPage<T>(limit = 20): SpotifyPage<T> {
  return { items: [], next: null, total: 0, limit, offset: 0 };
}

export async function getDashboardData(clientId: string, refresh = false): Promise<DashboardData> {
  const limit = 20;
  const playlists = await spotifyApiRequest<SpotifyPage<SpotifyPlaylist>>(clientId, `/me/playlists?limit=${limit}`, undefined, { refresh });
  const optional = async <T>(endpoint: string, fallback: T): Promise<T> => {
    try { return await spotifyApiRequest<T>(clientId, endpoint, undefined, { refresh }); }
    catch (error) {
      console.warn(JSON.stringify({ component: "spotify-api", event: "optional-failure", endpoint, error: error instanceof Error ? error.message : "unknown" }));
      return fallback;
    }
  };
  const recentTracks = await optional(`/me/player/recently-played?limit=${limit}`, emptyPage<RecentTrack>(limit));
  const topArtists = await optional(`/me/top/artists?time_range=short_term&limit=${limit}`, emptyPage<SpotifyArtist>(limit));
  const topTracks = await optional(`/me/top/tracks?time_range=short_term&limit=${limit}`, emptyPage<SpotifyTrack>(limit));
  return { playlists: { ...playlists, items: playlists.items.map(normalizePlaylist) }, likedTracks: emptyPage<SavedTrack>(limit), recentTracks, topArtists, topTracks };
}

export async function getSpotifyPlaylists(clientId: string, offset: number, refresh = false): Promise<SpotifyPage<SpotifyPlaylist>> {
  const page = await spotifyApiRequest<SpotifyPage<RawPlaylist>>(clientId, `/me/playlists?limit=20&offset=${Math.max(0, Math.floor(offset))}`, undefined, { refresh });
  return { ...page, items: page.items.map(normalizePlaylist) };
}

export async function getRecentlyPlayed(clientId: string, limit = 50, refresh = false): Promise<SpotifyPage<RecentTrack>> {
  const requested = Math.max(1, Math.min(50, Math.floor(limit)));
  return spotifyApiRequest<SpotifyPage<RecentTrack>>(clientId, `/me/player/recently-played?limit=${requested}`, undefined, { refresh });
}

export async function getRecentlyPlayedTracks(clientId: string, limit: number): Promise<RecentTracksResult> {
  const requested = Math.max(1, Math.min(50, Math.floor(limit)));
  const page = await getRecentlyPlayed(clientId, 50, false);
  const items = selectRecentTracks(page.items, requested);
  return { items, requested, available: page.items.length };
}

export function selectRecentTracks(items: RecentTrack[], limit: number): RecentTrack[] {
  const requested = Math.max(1, Math.min(50, Math.floor(limit)));
  return items
    .filter(item => item && item.track)
    .map((item, index) => ({ item, index, timestamp: Date.parse(item.played_at) }))
    .sort((left, right) => {
      const leftValid = Number.isFinite(left.timestamp);
      const rightValid = Number.isFinite(right.timestamp);
      if (leftValid && rightValid) return right.timestamp - left.timestamp || left.index - right.index;
      if (leftValid) return -1;
      if (rightValid) return 1;
      return left.index - right.index;
    })
    .slice(0, requested)
    .map(entry => entry.item);
}

export async function getMostRecentArtist(clientId: string): Promise<MostRecentArtistResult> {
  const recent = await getRecentlyPlayedTracks(clientId, 1);
  const newest = recent.items[0];
  return newest
    ? { artistNames: newest.track.artists.map(artist => artist.name), trackName: newest.track.name, playedAt: newest.played_at }
    : { artistNames: [] };
}

export async function getFavoriteGenre(clientId: string): Promise<FavoriteGenreResult> {
  const artists = (await getTopArtists(clientId, "long_term")).items;
  const scores = new Map<string, number>();
  let artistsWithGenres = 0;
  artists.forEach((artist, index) => {
    const genres = artist.genres ?? [];
    if (genres.length) artistsWithGenres += 1;
    const weight = artists.length - index;
    genres.forEach(genre => scores.set(genre, (scores.get(genre) ?? 0) + weight));
  });
  return {
    genres: [...scores.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([name, score]) => ({ name, score })),
    artistsConsidered: artists.length,
    artistsWithGenres,
    timeRange: "long_term"
  };
}

export async function getTopArtists(clientId: string, timeRange: string, refresh = false): Promise<SpotifyPage<SpotifyArtist>> {
  const range = new Set(["short_term", "medium_term", "long_term"]).has(timeRange) ? timeRange : "short_term";
  return spotifyApiRequest<SpotifyPage<SpotifyArtist>>(clientId, `/me/top/artists?time_range=${range}&limit=20`, undefined, { refresh });
}

export async function getTopTracks(clientId: string, timeRange: string, refresh = false): Promise<SpotifyPage<SpotifyTrack>> {
  const range = new Set(["short_term", "medium_term", "long_term"]).has(timeRange) ? timeRange : "short_term";
  return spotifyApiRequest<SpotifyPage<SpotifyTrack>>(clientId, `/me/top/tracks?time_range=${range}&limit=20`, undefined, { refresh });
}

export async function getMostRecentPlaylist(clientId: string): Promise<MostRecentPlaylistResult> {
  const recent = await getRecentlyPlayedTracks(clientId, 1);
  const entry = recent.items[0];
  const playlistId = playlistIdFromPlaybackContext(entry?.context);
  if (!entry || !playlistId) return { available: false, playedAt: entry?.played_at, trackName: entry?.track.name };
  const playlist = await spotifyApiRequest<{ id?: string; name?: string }>(clientId, `/playlists/${encodeURIComponent(playlistId)}?fields=id,name`);
  return { available: typeof playlist.name === "string", playlistId: playlist.id ?? playlistId, playlistName: playlist.name, playedAt: entry.played_at, trackName: entry.track.name };
}

export async function getMostPlayedPlaylistsEstimate(clientId: string): Promise<PlaylistListeningEstimate> {
  const history = await spotifyApiRequest<SpotifyPage<RecentTrack>>(clientId, "/me/player/recently-played?limit=50");
  const playlists = await getSpotifyPlaylists(clientId, 0);
  const candidates = playlists.items.slice(0, 10);
  const timestamps = history.items.map(item => Date.parse(item.played_at)).filter(value => Number.isFinite(value));
  const windowDescription = timestamps.length
    ? `${new Date(Math.min(...timestamps)).toISOString()} to ${new Date(Math.max(...timestamps)).toISOString()}`
    : "the available Spotify recently-played history";
  if (!history.items.length || !candidates.length) {
    return {
      available: false,
      basis: "recently-played-sample",
      historyRecordsConsidered: history.items.length,
      playlistsConsidered: candidates.length,
      windowDescription,
      rankings: [],
      limitation: "Spotify did not provide enough recent-play history or playlists to estimate playlist activity."
    };
  }
  const recentByTrack = new Map<string, number>();
  history.items.forEach(item => recentByTrack.set(item.track.id, (recentByTrack.get(item.track.id) ?? 0) + 1));
  const rankings: PlaylistListeningEstimate["rankings"] = [];
  for (const playlist of candidates) {
    const details = await getPlaylist(clientId, playlist.id);
    let matchedPlays = 0;
    let matchedHistoryRecords = 0;
    const seenTracks = new Set<string>();
    for (const item of details.items.items) {
      const trackId = item.track?.id;
      if (!trackId || seenTracks.has(trackId)) continue;
      seenTracks.add(trackId);
      const plays = recentByTrack.get(trackId) ?? 0;
      matchedPlays += plays;
      if (plays > 0) matchedHistoryRecords += plays;
    }
    if (matchedPlays > 0) rankings.push({ playlistId: playlist.id, playlistName: playlist.name, matchedPlays, matchedHistoryRecords });
  }
  rankings.sort((left, right) => right.matchedPlays - left.matchedPlays || left.playlistName.localeCompare(right.playlistName));
  return {
    available: rankings.length > 0,
    basis: "recently-played-sample",
    historyRecordsConsidered: history.items.length,
    playlistsConsidered: candidates.length,
    windowDescription,
    rankings,
    limitation: rankings.length ? "This is an estimate from the sampled recent-play history, not an official Spotify playlist play count or lifetime ranking. A track appearing in multiple playlists contributes to each matching playlist." : "None of the sampled recently played tracks matched the sampled playlist contents."
  };
}

export async function getSavedTracks(clientId: string): Promise<SpotifyPage<SavedTrack>> {
  return spotifyApiRequest<SpotifyPage<SavedTrack>>(clientId, "/me/tracks?limit=20");
}

export async function getPlaylist(clientId: string, id: string): Promise<SpotifyPlaylist & { items: SpotifyPage<SpotifyPlaylistItem> }> {
  const encoded = encodeURIComponent(id);
  const rawPlaylist = await spotifyApiRequest<RawPlaylist>(clientId, `/playlists/${encoded}?fields=id,name,description,images,owner,external_urls,tracks(total),items(total)`);
  const pages: SpotifyPlaylistItem[] = [];
  let endpoint: string | null = `/playlists/${encoded}/items?limit=50&offset=0`;
  let total = 0;
  let limit = 50;
  let offset = 0;
  while (endpoint) {
    const page = normalizePlaylistItems(await spotifyApiRequest<RawPlaylistPage>(clientId, endpoint));
    pages.push(...page.items);
    total = page.total;
    limit = page.limit;
    offset = page.offset;
    endpoint = page.next;
  }
  return { ...normalizePlaylist(rawPlaylist), items: { items: pages, next: null, total, limit, offset } };
}

export async function getTrack(clientId: string, id: string): Promise<SpotifyTrack> { return spotifyApiRequest(clientId, `/tracks/${encodeURIComponent(id)}`); }
export async function getAlbum(clientId: string, id: string): Promise<SpotifyAlbum> { return spotifyApiRequest(clientId, `/albums/${encodeURIComponent(id)}`); }
export async function getArtist(clientId: string, id: string): Promise<SpotifyArtist & { albums?: SpotifyPage<SpotifyAlbum> }> {
  const [artist, albums] = await Promise.all([
    spotifyApiRequest<SpotifyArtist>(clientId, `/artists/${encodeURIComponent(id)}`),
    spotifyApiRequest<SpotifyPage<SpotifyAlbum>>(clientId, `/artists/${encodeURIComponent(id)}/albums?include_groups=album,single&limit=20`)
  ]);
  return { ...artist, albums };
}

export function chunkTrackIds(ids: string[], size = 40): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) chunks.push(ids.slice(index, index + size));
  return chunks;
}

export function mapSavedTrackStatus(ids: string[], statusByUniqueId: Map<string, boolean>): boolean[] {
  return ids.map(id => statusByUniqueId.get(id) ?? false);
}

export async function getSavedStatus(clientId: string, ids: string[]): Promise<boolean[]> {
  const validIds = [...new Set(ids.filter(id => typeof id === "string" && id.trim()).map(id => id.trim()))];
  if (!validIds.length) return ids.map(() => false);
  const statuses = new Map<string, boolean>();
  for (const batch of chunkTrackIds(validIds, 40)) {
    const response = await spotifyApiRequest<unknown>(clientId, `/me/library/contains?uris=${batch.map(id => encodeURIComponent(`spotify:track:${id}`)).join(",")}`);
    if (Array.isArray(response)) batch.forEach((id, index) => statuses.set(id, response[index] === true));
  }
  return mapSavedTrackStatus(ids, statuses);
}

export async function updateSavedTracks(clientId: string, ids: string[], saved: boolean): Promise<void> {
  if (!ids.length) return;
  await spotifyApiRequest<unknown>(clientId, "/me/library", {
    method: saved ? "PUT" : "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uris: ids.map(id => `spotify:track:${id}`) })
  });
  invalidateSpotifyCache("GET:https://api.spotify.com/v1/me/library/contains");
  invalidateSpotifyCache("GET:https://api.spotify.com/v1/me/tracks");
}

export async function searchSpotify(clientId: string, query: string, type: string, offset = 0): Promise<unknown> {
  if (!query.trim()) throw new Error("Search query cannot be empty.");
  const allowed = new Set(["track", "artist", "album", "playlist"]);
  const requestedTypes = type.split(",").filter(value => allowed.has(value));
  const searchTypes = requestedTypes.length ? requestedTypes.join(",") : "track";
  return spotifyApiRequest(clientId, `/search?q=${encodeURIComponent(query.trim())}&type=${searchTypes}&limit=10&offset=${Math.max(0, Math.floor(offset))}`);
}

export async function getTopItems(clientId: string, timeRange: string, refresh = false): Promise<{ artists: SpotifyPage<SpotifyArtist>; tracks: SpotifyPage<SpotifyTrack>; recentTracks: SpotifyPage<RecentTrack> }> {
  const range = new Set(["short_term", "medium_term", "long_term"]).has(timeRange) ? timeRange : "short_term";
  const [artists, tracks, recentTracks] = await Promise.all([
    spotifyApiRequest<SpotifyPage<SpotifyArtist>>(clientId, `/me/top/artists?time_range=${range}&limit=20`, undefined, { refresh }),
    spotifyApiRequest<SpotifyPage<SpotifyTrack>>(clientId, `/me/top/tracks?time_range=${range}&limit=20`, undefined, { refresh }),
    getRecentlyPlayed(clientId, 50, refresh)
  ]);
  return { artists, tracks, recentTracks };
}
