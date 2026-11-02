import { describe, expect, it } from "vitest";
import { classifySearchResult, estimateArtistListeningMinutes, estimateListeningHours, filterByQuery, filterTracksByQuery, formatListeningMinutes, mostCommonGenre, sortPlaylistsByRecentActivity } from "./analytics";

describe("Spotify dashboard analytics", () => {
  it("estimates listening hours without double-counting events", () => {
    const event = { played_at: "2026-11-02T10:00:00Z", track: { id: "a", duration_ms: 3_600_000 } };
    expect(estimateListeningHours([event, event])).toBe(1);
    expect(estimateListeningHours([])).toBeUndefined();
  });

  it("derives the most common artist genre", () => {
    expect(mostCommonGenre([["indie pop", "rock"], ["indie pop"], []])).toBe("indie pop");
    expect(mostCommonGenre([])).toBeUndefined();
  });

  it("sorts playlists only from confirmed playlist context", () => {
    const playlists = [{ id: "old" }, { id: "recent" }, { id: "none" }];
    const sorted = sortPlaylistsByRecentActivity(playlists, [
      { played_at: "2026-11-01T10:00:00Z", context: { uri: "spotify:playlist:old" } },
      { played_at: "2026-11-02T10:00:00Z", context: { uri: "spotify:playlist:recent" } }
    ]);
    expect(sorted.map(item => item.id)).toEqual(["recent", "old", "none"]);
  });

  it("aggregates artist listening time across multi-artist tracks once per event", () => {
    const event = { played_at: "2026-11-02T10:00:00Z", track: { id: "a", duration_ms: 120000, artists: [{ id: "one" }, { id: "two" }] } };
    const totals = estimateArtistListeningMinutes([event, event]);
    expect(totals.get("one")).toBe(2);
    expect(totals.get("two")).toBe(2);
    expect(formatListeningMinutes(155)).toBe("2h 35m");
    expect(formatListeningMinutes(undefined)).toBe("—");
  });

  it("ignores incomplete history instead of throwing", () => {
    expect(estimateArtistListeningMinutes([{} as never, { played_at: "invalid", track: { id: "x", duration_ms: NaN, artists: [] } }])).toEqual(new Map());
    expect(estimateListeningHours([{} as never])).toBeUndefined();
  });

  it("filters playlist and track searches locally without changing order", () => {
    const tracks = [
      { name: "One", album: { name: "Blue" }, artists: [{ name: "Alpha" }] },
      { name: "Two", album: { name: "Red" }, artists: [{ name: "Beta" }] }
    ];
    expect(filterByQuery([{ name: "Alpha Mix" }, { name: "Beta Mix" }], "alpha").map(item => item.name)).toEqual(["Alpha Mix"]);
    expect(filterTracksByQuery(tracks, "beta")).toEqual([tracks[1]]);
  });

  it("classifies all unified discovery result types", () => {
    expect(["track", "artist", "album", "playlist"].map(classifySearchResult)).toEqual(["track", "artist", "album", "playlist"]);
    expect(classifySearchResult("unknown")).toBe("track");
  });
});
