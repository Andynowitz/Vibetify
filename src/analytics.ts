export type PlayedTrack = { played_at: string; track: { id: string; duration_ms: number } };
export type PlayedArtistTrack = PlayedTrack & { track: { artists: Array<{ id: string }> } };
export type SearchResultType = "track" | "artist" | "album" | "playlist";

export function filterByQuery<T extends { name: string }>(items: T[], query: string): T[] {
  const normalized = query.trim().toLowerCase();
  return normalized ? items.filter(item => item.name.toLowerCase().includes(normalized)) : items;
}

export function filterTracksByQuery<T extends { name: string; album: { name: string }; artists: Array<{ name: string }> }>(tracks: T[], query: string): T[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return tracks;
  return tracks.filter(track => `${track.name} ${track.album.name} ${track.artists.map(artist => artist.name).join(" ")}`.toLowerCase().includes(normalized));
}

export function classifySearchResult(type: string): SearchResultType {
  return type === "artist" || type === "album" || type === "playlist" ? type : "track";
}

export function estimateListeningHours(items: PlayedTrack[]): number | undefined {
  const seen = new Set<string>();
  const milliseconds = (Array.isArray(items) ? items : []).reduce((total, item) => {
    if (!item?.track?.id || !Number.isFinite(item.track.duration_ms) || !item.played_at) return total;
    const key = `${item.track.id}-${item.played_at}`;
    if (seen.has(key)) return total;
    seen.add(key);
    return total + item.track.duration_ms;
  }, 0);
  return milliseconds ? milliseconds / 3_600_000 : undefined;
}

export function mostCommonGenre(genres: string[][]): string | undefined {
  const counts = new Map<string, number>();
  (Array.isArray(genres) ? genres : []).flat().filter(genre => typeof genre === "string" && genre.length > 0).forEach(genre => counts.set(genre, (counts.get(genre) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export function sortPlaylistsByRecentActivity<T extends { id: string }>(
  playlists: T[],
  recentContexts: Array<{ context?: { uri?: string }; played_at: string }>
): T[] {
  const lastPlayed = new Map<string, number>();
  recentContexts.forEach(item => {
    const uri = item.context?.uri;
    if (!uri?.startsWith("spotify:playlist:")) return;
    const id = uri.slice("spotify:playlist:".length);
    const timestamp = Date.parse(item.played_at);
    if (!Number.isNaN(timestamp) && timestamp > (lastPlayed.get(id) ?? 0)) lastPlayed.set(id, timestamp);
  });
  return [...playlists].sort((a, b) => (lastPlayed.get(b.id) ?? 0) - (lastPlayed.get(a.id) ?? 0));
}

export function estimateArtistListeningMinutes(items: PlayedArtistTrack[]): Map<string, number> {
  const seen = new Set<string>();
  const minutes = new Map<string, number>();
  (Array.isArray(items) ? items : []).forEach(item => {
    if (!item?.track?.id || !item.played_at || !Number.isFinite(item.track.duration_ms) || !Array.isArray(item.track.artists)) return;
    const eventKey = `${item.track.id}-${item.played_at}`;
    if (seen.has(eventKey)) return;
    seen.add(eventKey);
    const duration = item.track.duration_ms / 60000;
    item.track.artists.filter(artist => artist?.id).forEach(artist => minutes.set(artist.id, (minutes.get(artist.id) ?? 0) + duration));
  });
  return minutes;
}

export function formatListeningMinutes(minutes: number | undefined): string {
  if (!minutes || minutes < 1) return "—";
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return hours ? `${hours}h ${remainder}m` : `${remainder}m`;
}
