import { describe, expect, it } from "vitest";
import { chunkTrackIds, mapSavedTrackStatus, normalizePlaylist, normalizePlaylistItems } from "./spotify-api";

describe("Spotify playlist response normalization", () => {
  it("supports the February 2026 items count shape", () => {
    const playlist = normalizePlaylist({
      id: "playlist",
      name: "Mix",
      items: { total: 42 }
    });
    expect(playlist.tracks?.total).toBe(42);
  });

  it("supports current item fields and legacy track fields", () => {
    const current = normalizePlaylistItems({
      items: [{ added_at: "2026-11-02", item: { id: "one", name: "One", duration_ms: 1000, artists: [], album: { name: "Album" } } }],
      total: 2,
      limit: 1,
      offset: 0,
      next: "https://api.spotify.com/v1/playlists/p/items?offset=1"
    });
    const legacy = normalizePlaylistItems({
      items: [{ track: { id: "two", name: "Two", duration_ms: 1000, artists: [], album: { name: "Album" } } }]
    });
    expect(current.items[0].track?.id).toBe("one");
    expect(current.next).toContain("offset=1");
    expect(legacy.items[0].track?.id).toBe("two");
  });

  it("maps duplicate tracks to their original order and batches at forty", () => {
    const ids = Array.from({ length: 41 }, (_, index) => `track-${index}`).concat("track-0");
    const chunks = chunkTrackIds(ids, 40);
    expect(chunks.map(chunk => chunk.length)).toEqual([40, 2]);
    expect(mapSavedTrackStatus(["track-2", "track-2", "missing"], new Map([["track-2", true]]))).toEqual([true, true, false]);
  });
});
