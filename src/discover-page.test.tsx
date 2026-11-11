// @vitest-environment jsdom
import React, { StrictMode } from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App, { ErrorBoundary } from "./App";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const emptyPage = { items: [] as unknown[], total: 0, limit: 20, offset: 0, next: null };
const profile = { id: "listener", displayName: "Listener" };

const trackItem = {
  id: "track-billie-jean",
  name: "Billie Jean",
  duration_ms: 293933,
  artists: [{ id: "artist-mj", name: "Michael Jackson", images: [{ url: "https://images.example.com/mj.jpg" }] }],
  album: { id: "album-thriller", name: "Thriller", images: [{ url: "https://images.example.com/thriller.jpg" }] }
};

// `/albums/{id}` returns tracks without the album property, so TrackList must not assume it.
const albumTrackItem = {
  id: "track-billie-jean",
  name: "Billie Jean",
  duration_ms: 293933,
  artists: [{ id: "artist-mj", name: "Michael Jackson" }]
};

// Spotify search responses can contain null slots and items without the properties the UI needs.
const partialSearchPayload = {
  tracks: { items: [null, { id: "track-partial", name: "Partial track", artists: null, album: null }], total: 2, limit: 10, offset: 0, next: null },
  artists: { items: [null, { id: "artist-partial", name: "Partial artist" }], total: 2, limit: 10, offset: 0, next: null },
  albums: { items: [null, { id: "album-partial", name: "Partial album", artists: [] }], total: 2, limit: 10, offset: 0, next: null },
  playlists: { items: [null], total: 1, limit: 10, offset: 0, next: null }
};

const searchPayload = {
  tracks: { items: [trackItem], total: 1, limit: 10, offset: 0, next: null },
  artists: { items: [{ id: "artist-mj", name: "Michael Jackson", genres: ["pop"], images: [{ url: "https://images.example.com/mj.jpg" }] }], total: 1, limit: 10, offset: 0, next: null },
  albums: { items: [{ id: "album-thriller", name: "Thriller", release_date: "1982-11-30", total_tracks: 9, artists: [{ id: "artist-mj", name: "Michael Jackson" }], images: [{ url: "https://images.example.com/thriller.jpg" }] }], total: 1, limit: 10, offset: 0, next: null },
  playlists: { items: [{ id: "playlist-essentials", name: "Michael Jackson Essentials", owner: { display_name: "Spotify" }, tracks: { total: 50 } }], total: 1, limit: 10, offset: 0, next: null }
};

type SpotifyMock = Record<string, ReturnType<typeof vi.fn>>;

function installVibetify(overrides: Partial<SpotifyMock> = {}): SpotifyMock {
  const spotify: SpotifyMock = {
    getState: vi.fn(async () => ({ connected: true, profile })),
    onComplete: vi.fn(() => () => undefined),
    onError: vi.fn(() => () => undefined),
    mockConfig: vi.fn(async () => ({ enabled: false, status: "200", delayMs: 0 })),
    setMockConfig: vi.fn(async () => ({ enabled: false, status: "200", delayMs: 0 })),
    dashboard: vi.fn(async () => emptyPage),
    recentlyPlayed: vi.fn(async () => emptyPage),
    topArtists: vi.fn(async () => emptyPage),
    topTracks: vi.fn(async () => emptyPage),
    playlists: vi.fn(async () => emptyPage),
    library: vi.fn(async () => emptyPage),
    topItems: vi.fn(async () => ({ artists: emptyPage, tracks: emptyPage, recentTracks: emptyPage })),
    search: vi.fn(async () => searchPayload),
    playlist: vi.fn(async () => ({ id: "playlist-essentials", name: "Michael Jackson Essentials", owner: { display_name: "Spotify" }, tracks: { total: 1 }, items: { items: [{ track: trackItem }], total: 1, limit: 50, offset: 0, next: null } })),
    track: vi.fn(async () => trackItem),
    album: vi.fn(async () => ({ ...searchPayload.albums.items[0], tracks: { items: [albumTrackItem], total: 1, limit: 20, offset: 0, next: null } })),
    artist: vi.fn(async () => ({ ...searchPayload.artists.items[0], albums: { items: searchPayload.albums.items, total: 1, limit: 20, offset: 0, next: null } })),
    savedStatus: vi.fn(async () => []),
    updateSaved: vi.fn(async () => undefined),
    diagnostics: vi.fn(async () => ({})),
    resetDiagnostics: vi.fn(async () => ({})),
    begin: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    ...overrides
  };
  (window as unknown as { vibetify: unknown }).vibetify = {
    openExternal: vi.fn(async () => undefined),
    spotify,
    ai: {
      status: vi.fn(async () => ({ provider: "mock", label: "Mock AI", tools: [] })),
      listConversations: vi.fn(async () => []),
      getConversation: vi.fn(async () => undefined),
      newConversation: vi.fn(async () => ({ id: "c", title: "t", createdAt: "", updatedAt: "", messages: [] })),
      deleteConversation: vi.fn(async () => undefined),
      send: vi.fn(async () => ({ conversation: { id: "c", title: "t", createdAt: "", updatedAt: "", messages: [] }, toolActivity: [] }))
    }
  };
  return spotify;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  try {
    act(() => root.unmount());
  } catch {
    // The root is already detached when React gave up on an uncaught render error.
  }
  container.remove();
});

async function flush(ms = 0) {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, ms));
  });
}

function clickByText(text: string) {
  const target = [...container.querySelectorAll("button")].find(button => button.textContent?.trim() === text);
  expect(target, `button ${text}`).toBeTruthy();
  act(() => target!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function click(selector: string) {
  const target = container.querySelector<HTMLButtonElement>(selector);
  expect(target, selector).toBeTruthy();
  act(() => target!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function type(value: string) {
  const input = container.querySelector<HTMLInputElement>(".discover-search input");
  expect(input, "discover search input").toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function pressEnter() {
  const input = container.querySelector<HTMLInputElement>(".discover-search input");
  act(() => { input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
}

async function renderApp(overrides: Partial<SpotifyMock> = {}) {
  const spotify = installVibetify(overrides);
  await act(async () => root.render(<StrictMode><App /></StrictMode>));
  await flush();
  return spotify;
}

async function openDiscover(overrides: Partial<SpotifyMock> = {}) {
  const spotify = await renderApp(overrides);
  clickByText("Discover");
  return spotify;
}

const resultCount = () => container.querySelectorAll(".search-result").length;
const groupTitles = () => [...container.querySelectorAll(".result-group h2")].map(heading => heading.textContent);
const resultNames = () => [...container.querySelectorAll(".search-result b")].map(node => node.textContent);

describe("Discover search", () => {
  it("groups Spotify results for tracks, artists, albums, and playlists", async () => {
    const spotify = await openDiscover();
    type("Michael");
    await flush(650);

    expect(spotify.search).toHaveBeenCalledWith(expect.any(String), "Michael", "track,artist,album,playlist");
    expect(resultCount()).toBe(4);
    expect(groupTitles()).toEqual(["Songs", "Artists", "Albums", "Playlists"]);
    expect(resultNames()).toEqual(["Billie Jean", "Michael Jackson", "Thriller", "Michael Jackson Essentials"]);
  });

  it("searches immediately when Enter is pressed instead of waiting for the debounce", async () => {
    const spotify = await openDiscover();
    type("Michael");
    await flush(20);
    pressEnter();
    await flush(20);

    expect(spotify.search).toHaveBeenCalledTimes(1);
    expect(resultCount()).toBe(4);

    await flush(650);
    expect(spotify.search).toHaveBeenCalledTimes(1);
  });

  it("keeps the window and the remaining results alive when entries are null or incomplete", async () => {
    await openDiscover({ search: vi.fn(async () => partialSearchPayload) });
    type("Michael");
    await flush(650);

    expect(container.querySelector(".app-shell")).not.toBeNull();
    expect(container.querySelector(".error-state")).toBeNull();
    expect(resultCount()).toBe(3);
    expect(resultNames()).toEqual(["Partial track", "Partial artist", "Partial album"]);
    expect(container.querySelector(".result-track small:last-child")?.textContent).toBe("");
    expect(container.querySelector(".result-album small:last-child")?.textContent).toBe("");
  });

  it("shows the Spotify error instead of an empty page when the search fails", async () => {
    await openDiscover({ search: vi.fn(async () => { throw new Error("Spotify request failed (429): rate limited."); }) });
    type("Michael");
    await flush(650);

    expect(container.querySelector(".error-state")?.textContent).toContain("Spotify request failed (429): rate limited.");
    expect(container.querySelector(".error-state h3")).toBeNull();
    expect(container.querySelector(".app-shell")).not.toBeNull();
    expect(resultCount()).toBe(0);
  });

  it("clears results when the query is cleared", async () => {
    const spotify = await openDiscover();
    type("Michael");
    await flush(650);
    expect(resultCount()).toBe(4);

    type("");
    await flush(650);

    expect(resultCount()).toBe(0);
    expect(spotify.search).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".empty-state")?.textContent).toContain("Type at least 2 characters to search Spotify.");
  });

  it("shows a loading state while the search is in flight", async () => {
    let resolveSearch: (value: unknown) => void = () => undefined;
    const pending = new Promise<unknown>(resolve => { resolveSearch = resolve; });
    const spotify = await openDiscover({ search: vi.fn(() => pending) });
    type("Michael");
    await flush(520);

    expect(spotify.search).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".loading-state")?.textContent).toBe("Searching Spotify…");

    await act(async () => {
      resolveSearch(searchPayload);
      await pending;
    });
    expect(resultCount()).toBe(4);
  });

  it("shows an empty state when Spotify has no matches", async () => {
    await openDiscover({ search: vi.fn(async () => ({ tracks: { items: [] }, artists: { items: [] }, albums: { items: [] }, playlists: { items: [] } })) });
    type("zzzzz");
    await flush(650);
    expect(container.querySelector(".empty-state")?.textContent).toContain("No Spotify results found.");
  });

  it("does not request Spotify for queries shorter than two characters", async () => {
    const spotify = await openDiscover();
    type("M");
    await flush(650);
    expect(spotify.search).not.toHaveBeenCalled();
    expect(container.querySelector(".empty-state")?.textContent).toContain("Type at least 2 characters to search Spotify.");
  });
});

describe("Discover result navigation", () => {
  async function searchAndOpen(selector: string, overrides: Partial<SpotifyMock> = {}) {
    await openDiscover(overrides);
    type("Michael");
    await flush(650);
    click(selector);
    await flush(20);
  }

  it("opens track details", async () => {
    await searchAndOpen(".result-track");
    expect(container.querySelector(".entity-hero h1")?.textContent).toBe("Billie Jean");
    expect(container.querySelector(".entity-hero .subtitle")?.textContent).toBe("Thriller · 4:53");
  });

  it("opens album details whose tracks have no album field", async () => {
    await searchAndOpen(".result-album");
    expect(container.querySelector(".entity-hero h1")?.textContent).toBe("Thriller");
    expect(container.querySelector(".app-shell")).not.toBeNull();
    expect(container.querySelectorAll(".track-list .track-row")).toHaveLength(1);
    expect(container.querySelector(".track-info small")?.textContent).toBe("Michael Jackson · Unknown album");
    expect(container.querySelector(".track-duration")?.textContent).toBe("4:53");
  });

  it("opens artist details with their albums", async () => {
    await searchAndOpen(".result-artist");
    expect(container.querySelector(".entity-hero h1")?.textContent).toBe("Michael Jackson");
    expect(container.querySelectorAll(".album-card")).toHaveLength(1);
  });

  it("opens playlist details", async () => {
    const spotify = await openDiscover();
    type("Michael");
    await flush(650);
    click(".result-playlist");
    await flush(20);

    expect(spotify.playlist).toHaveBeenCalledWith(expect.any(String), "playlist-essentials");
    expect(container.querySelector(".detail-hero h1")?.textContent).toBe("Michael Jackson Essentials");
    expect(container.querySelectorAll(".track-list .track-row")).toHaveLength(1);
  });

  it("shows the unavailable state when a playlist has no items payload", async () => {
    await searchAndOpen(".result-playlist", { playlist: vi.fn(async () => ({ id: "playlist-essentials", name: "Michael Jackson Essentials", tracks: { total: 5 } })) });
    expect(container.querySelector(".detail-hero h1")?.textContent).toBe("Michael Jackson Essentials");
    expect(container.querySelector(".empty-state")?.textContent).toContain("Playlist tracks are unavailable");
  });

  it("shows a detail error instead of loading forever when a detail request fails", async () => {
    await searchAndOpen(".result-track", { track: vi.fn(async () => { throw new Error("Spotify request failed (403)."); }) });
    expect(container.querySelector(".error-state")?.textContent).toContain("Spotify request failed (403).");
    expect(container.querySelector(".app-shell")).not.toBeNull();
  });
});

describe("ErrorBoundary", () => {
  it("contains render errors so the window keeps working", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    function Broken(): React.ReactElement { throw new Error("unexpected payload"); }

    await act(async () => root.render(<ErrorBoundary><Broken /></ErrorBoundary>));

    expect(container.querySelector(".error-state h3")?.textContent).toBe("This page could not be displayed");
    expect(container.querySelector(".error-state button")?.textContent).toBe("Try again");
    consoleError.mockRestore();
  });

  it("renders children when nothing throws", async () => {
    await act(async () => root.render(<ErrorBoundary><p>ok</p></ErrorBoundary>));
    expect(container.textContent).toBe("ok");
  });
});
