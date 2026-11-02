import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAlbum, getArtist, getDashboardData, getPlaylist, getSavedStatus, getSpotifyPlaylists, getTopItems, getTrack, searchSpotify, updateSavedTracks } from "./spotify-api";
import { clearSpotifyRequestState, getSpotifyRequestDiagnostics } from "./spotify-request-manager";
import { getSpotifyMockConfig, setSpotifyMockConfig } from "./spotify-mock";

describe("Spotify mock mode", () => {
  beforeEach(() => {
    clearSpotifyRequestState();
    setSpotifyMockConfig({ enabled: true, status: "200", delayMs: 0 });
  });

  it("supports realistic navigation without calling fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const clientId = "mock-client";
    await getDashboardData(clientId);
    await getSpotifyPlaylists(clientId, 0);
    await getPlaylist(clientId, "playlist-1");
    await getSavedStatus(clientId, ["track-1", "track-2", "track-1"]);
    await searchSpotify(clientId, "midnight", "track,artist,album,playlist");
    await searchSpotify(clientId, "golden", "track,artist,album,playlist");
    await getArtist(clientId, "artist-aurora");
    await getAlbum(clientId, "album-1");
    await getTrack(clientId, "track-1");
    await getTopItems(clientId, "short_term");
    await getDashboardData(clientId);
    await updateSavedTracks(clientId, ["track-2"], true);
    expect(fetchSpy).not.toHaveBeenCalled();
    const diagnostics = getSpotifyRequestDiagnostics();
    expect(diagnostics.maximumObservedConcurrency).toBeLessThanOrEqual(2);
    expect(diagnostics.cacheHits).toBeGreaterThan(0);
    expect(diagnostics.sessionRequests).toBeGreaterThan(0);
    fetchSpy.mockRestore();
  });

  it("simulates quota errors without retrying", async () => {
    setSpotifyMockConfig({ status: "QUOTA_EXCEEDED", delayMs: 0 });
    await expect(getTrack("mock-client", "quota-track")).rejects.toMatchObject({ status: 429, reason: "QUOTA_EXCEEDED" });
    const diagnostics = getSpotifyRequestDiagnostics();
    expect(diagnostics.retries).toBe(0);
    expect(diagnostics.failedRequests).toBe(1);
  });

  it("supports all configured response classes", async () => {
    for (const status of ["401", "403", "500", "network"] as const) {
      clearSpotifyRequestState();
      setSpotifyMockConfig({ status });
      await expect(getTrack("mock-client", `track-${status}`)).rejects.toBeInstanceOf(Error);
    }
    expect(getSpotifyMockConfig().enabled).toBe(true);
  });
});
