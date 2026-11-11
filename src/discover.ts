export type SearchImage = { url?: string };
export type SearchArtistRef = { id?: string; name?: string; images?: SearchImage[] };
export type SearchItem = {
  id: string;
  name: string;
  images?: SearchImage[] | null;
  artists?: Array<SearchArtistRef | null> | null;
  album?: { name?: string; images?: SearchImage[] | null } | null;
  owner?: { display_name?: string | null } | null;
};

export type SearchResults = {
  tracks: SearchItem[];
  artists: SearchItem[];
  albums: SearchItem[];
  playlists: SearchItem[];
};

export const SEARCH_TYPES = "track,artist,album,playlist";
export const MIN_SEARCH_LENGTH = 2;
export const SEARCH_DEBOUNCE_MS = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Spotify omits or nulls entries for items that are unavailable in a market, and paginated
 * payloads can contain `null` slots. Every entry that reaches the UI has to be renderable,
 * so unusable entries are dropped instead of being mapped into components.
 */
export function normalizeSearchItems<T extends SearchItem = SearchItem>(section: unknown): T[] {
  if (!isRecord(section) || !Array.isArray(section.items)) return [];
  const seen = new Set<string>();
  const items: T[] = [];
  for (const candidate of section.items) {
    if (!isRecord(candidate)) continue;
    const { id, name } = candidate;
    if (typeof id !== "string" || !id || typeof name !== "string" || !name.trim()) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    items.push(candidate as unknown as T);
  }
  return items;
}

export function normalizeSearchResults(raw: unknown): SearchResults {
  const root = isRecord(raw) ? raw : {};
  return {
    tracks: normalizeSearchItems(root.tracks),
    artists: normalizeSearchItems(root.artists),
    albums: normalizeSearchItems(root.albums),
    playlists: normalizeSearchItems(root.playlists)
  };
}

export function countSearchResults(results: SearchResults): number {
  return results.tracks.length + results.artists.length + results.albums.length + results.playlists.length;
}

export function searchArtistNames(item: SearchItem): string {
  const artists = Array.isArray(item.artists) ? item.artists : [];
  return artists
    .map(artist => artist?.name)
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
    .join(", ");
}

/**
 * Errors rejected across the Electron context bridge are not always `instanceof Error`,
 * so the message is read structurally to keep the real cause visible.
 */
export function searchErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  if (isRecord(error) && typeof error.message === "string" && error.message.trim()) return error.message;
  return fallback;
}
