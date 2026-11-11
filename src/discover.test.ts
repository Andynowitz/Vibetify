import { describe, expect, it } from "vitest";
import { countSearchResults, normalizeSearchItems, normalizeSearchResults, searchArtistNames, searchErrorMessage } from "./discover";

describe("normalizeSearchResults", () => {
  it("keeps usable entries and groups them by result type", () => {
    const results = normalizeSearchResults({
      tracks: { items: [{ id: "t1", name: "Billie Jean" }] },
      artists: { items: [{ id: "a1", name: "Michael Jackson" }] },
      albums: { items: [{ id: "al1", name: "Thriller" }] },
      playlists: { items: [{ id: "p1", name: "Essentials" }] }
    });
    expect(results.tracks.map(item => item.id)).toEqual(["t1"]);
    expect(results.artists.map(item => item.id)).toEqual(["a1"]);
    expect(results.albums.map(item => item.id)).toEqual(["al1"]);
    expect(results.playlists.map(item => item.id)).toEqual(["p1"]);
    expect(countSearchResults(results)).toBe(4);
  });

  it("drops null and malformed entries instead of leaving them for rendering", () => {
    const results = normalizeSearchResults({
      tracks: { items: [null, undefined, "track", { name: "Missing id" }, { id: "t1" }, { id: "t1", name: "  " }, { id: "t2", name: "Valid" }] },
      artists: { items: [null] },
      albums: { items: null },
      playlists: {}
    });
    expect(results.tracks.map(item => item.id)).toEqual(["t2"]);
    expect(results.artists).toEqual([]);
    expect(results.albums).toEqual([]);
    expect(results.playlists).toEqual([]);
  });

  it("removes duplicate ids so React keys stay unique", () => {
    const items = normalizeSearchItems({ items: [{ id: "same", name: "First" }, { id: "same", name: "Second" }] });
    expect(items).toEqual([{ id: "same", name: "First" }]);
  });

  it("tolerates payloads that are not search responses", () => {
    expect(countSearchResults(normalizeSearchResults(undefined))).toBe(0);
    expect(countSearchResults(normalizeSearchResults(null))).toBe(0);
    expect(countSearchResults(normalizeSearchResults("error"))).toBe(0);
    expect(countSearchResults(normalizeSearchResults({ tracks: [] }))).toBe(0);
  });
});

describe("search result presentation helpers", () => {
  it("joins artist names while skipping unavailable artists", () => {
    expect(searchArtistNames({ id: "t1", name: "Track", artists: [{ name: "A" }, null, {}, { name: "B" }] })).toBe("A, B");
    expect(searchArtistNames({ id: "t1", name: "Track", artists: null })).toBe("");
    expect(searchArtistNames({ id: "t1", name: "Track" })).toBe("");
  });

  it("surfaces the received error message even when it is not an Error instance", () => {
    expect(searchErrorMessage(new Error("Spotify request failed (403)."), "fallback")).toBe("Spotify request failed (403).");
    expect(searchErrorMessage({ message: "Error invoking remote method 'spotify:search'" }, "fallback")).toBe("Error invoking remote method 'spotify:search'");
    expect(searchErrorMessage("quota exceeded", "fallback")).toBe("quota exceeded");
    expect(searchErrorMessage({ code: 1 }, "fallback")).toBe("fallback");
    expect(searchErrorMessage(undefined, "fallback")).toBe("fallback");
  });
});
