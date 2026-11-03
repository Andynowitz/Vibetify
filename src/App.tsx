import { Component, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import {
  Activity, ArrowLeft, BarChart3, Bot, ChevronRight, CircleUserRound, Compass, Disc3, ExternalLink,
  Heart, LayoutDashboard, ListMusic, LockKeyhole, Menu, Play, RefreshCw, Search, Settings as SettingsIcon, WandSparkles, X
} from "lucide-react";
import { classifySearchResult, estimateArtistListeningMinutes, estimateListeningHours, filterByQuery, filterTracksByQuery, formatListeningMinutes, mostCommonGenre } from "./analytics";
import { isSpotifyConfigured, startSpotifyAuthorization } from "./spotify";
import { useSpotifyResource } from "./use-spotify-resource";
import type { Section } from "./types";
import { createOptimisticMessage, normalizeEscapedMarkdown } from "./chat";

type Image = { url: string };
type Artist = { id: string; name: string; genres?: string[]; images?: Image[]; external_urls?: { spotify?: string } };
type Track = { id: string; name: string; duration_ms: number; artists: Artist[]; album: { id?: string; name: string; images?: Image[]; external_urls?: { spotify?: string } }; external_urls?: { spotify?: string } };
type Album = { id: string; name: string; artists: Artist[]; images?: Image[]; release_date?: string; total_tracks?: number; tracks?: Page<Track> };
type Playlist = { id: string; name: string; description?: string | null; images?: Image[]; owner?: { display_name?: string }; external_urls?: { spotify?: string }; tracks?: { total: number } };
type Page<T> = { items: T[]; total: number; next: string | null };
type RecentPlay = { played_at: string; track: Track; context?: { uri?: string } };
type Route = { kind: Section | "playlist" | "track" | "album" | "artist"; id?: string };
type Profile = SpotifyProfile;
type MockConfig = { enabled: boolean; status: string; delayMs: number };
type Diagnostics = { sessionRequests: number; cacheHits: number; cacheMisses: number; duplicateRequestsPrevented: number; currentConcurrentRequests: number; maximumObservedConcurrency: number; queuedRequests: number; failedRequests: number; cooldownRejected: number; requestsByEndpoint: Record<string, number> };
const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? "";
const fetchRecentlyPlayed = (refresh: boolean) => window.vibetify.spotify.recentlyPlayed(clientId, refresh) as Promise<Page<RecentPlay>>;
const fetchTopArtists = (timeRange: string) => (refresh: boolean) => window.vibetify.spotify.topArtists(clientId, timeRange, refresh) as Promise<Page<Artist>>;
const fetchTopTracks = (timeRange: string) => (refresh: boolean) => window.vibetify.spotify.topTracks(clientId, timeRange, refresh) as Promise<Page<Track>>;
const fetchPlaylists = (refresh: boolean) => window.vibetify.spotify.playlists(clientId, 0, refresh) as Promise<Page<Playlist>>;
const nav: Array<{ id: Section; label: string; icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard }, { id: "assistant", label: "AI Assistant", icon: WandSparkles },
  { id: "playlists", label: "My Playlists", icon: ListMusic }, { id: "discover", label: "Discover", icon: Compass },
  { id: "library", label: "Your Library", icon: Heart }, { id: "stats", label: "Listening Stats", icon: BarChart3 }, { id: "settings", label: "Settings", icon: SettingsIcon }
];

function App() {
  const [route, setRoute] = useState<Route>({ kind: "dashboard" });
  const [history, setHistory] = useState<Route[]>([]);
  const [profile, setProfile] = useState<Profile>();
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [mockConfig, setMockConfig] = useState<MockConfig>();
  const [diagnostics, setDiagnostics] = useState<Diagnostics>();
  const connected = Boolean(profile);
  const development = import.meta.env.DEV;
  const navigate = (next: Route) => { setHistory(previous => [...previous, route]); setRoute(next); };
  const goBack = () => { setHistory(previous => { const next = [...previous]; setRoute(next.pop() ?? { kind: "dashboard" }); return next; }); };
  useEffect(() => {
    let active = true;
    void window.vibetify.spotify.getState(clientId).then(state => { if (active) { setProfile(state.profile); setError(state.error ?? ""); } });
    const done = window.vibetify.spotify.onComplete(p => { setProfile(p); setError(""); setConnecting(false); });
    const failed = window.vibetify.spotify.onError(message => { setError(message); setConnecting(false); });
    return () => { active = false; done(); failed(); };
  }, []);
  useEffect(() => {
    if (!development) return;
    void window.vibetify.spotify.mockConfig().then(setMockConfig);
  }, [development]);
  const updateMockMode = async (enabled: boolean) => {
    const next = await window.vibetify.spotify.setMockConfig({ enabled });
    setMockConfig(next);
    const state = await window.vibetify.spotify.getState(clientId);
    setProfile(state.profile);
    setError(state.error ?? "");
  };
  const updateMockConfig = async (nextConfig: { status?: string; delayMs?: number }) => setMockConfig(await window.vibetify.spotify.setMockConfig(nextConfig));
  const refreshDiagnostics = async () => setDiagnostics(await window.vibetify.spotify.diagnostics() as Diagnostics);
  const resetDiagnostics = async () => setDiagnostics(await window.vibetify.spotify.resetDiagnostics() as Diagnostics);
  const toggleSaved = async (id: string, saved: boolean) => {
    setSavedIds(current => { const next = new Set(current); saved ? next.add(id) : next.delete(id); return next; });
    try { await window.vibetify.spotify.updateSaved(clientId, [id], saved); }
    catch (e) { setSavedIds(current => { const next = new Set(current); saved ? next.delete(id) : next.add(id); return next; }); setError(e instanceof Error ? e.message : "Could not update your library."); }
  };
  const connect = async () => { setConnecting(true); setError(""); try { await startSpotifyAuthorization(); } catch (e) { setConnecting(false); setError(e instanceof Error ? e.message : "Could not connect Spotify."); } };
  const disconnect = async () => { await window.vibetify.spotify.disconnect(); setProfile(undefined); setSavedIds(new Set()); };
  const selectSection = (kind: Section) => { setHistory([]); setRoute({ kind }); setMobileNav(false); };
  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? "open" : ""}`}><div className="brand"><div className="brand-mark"><Activity size={19} /></div><strong>vibetify</strong><button className="mobile-close" onClick={() => setMobileNav(false)}><X size={18} /></button></div><p className="eyebrow">WORKSPACE</p><nav>{nav.slice(0, 3).map(item => <NavItem key={item.id} item={item} active={route.kind} onSelect={selectSection} />)}</nav><p className="eyebrow music-label">YOUR MUSIC</p><nav>{nav.slice(3).map(item => <NavItem key={item.id} item={item} active={route.kind} onSelect={selectSection} />)}</nav><div className="sidebar-bottom"><div className={`connection-mini ${connected ? "connected" : ""}`}><span className="status-dot" />{connected ? "Spotify connected" : "Spotify not connected"}</div><button className="profile" onClick={() => selectSection("settings")}><span className="avatar">{profile?.imageUrl ? <img src={profile.imageUrl} alt="" /> : "?"}</span><span><b>{profile?.displayName ?? "Not connected"}</b><small>{profile?.id ?? "Connect Spotify"}</small></span><ChevronRight size={15} /></button></div></aside>
    {mobileNav && <button className="backdrop" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}
    <main className="main-content"><header className="topbar"><button className="menu-button" onClick={() => setMobileNav(true)}><Menu size={20} /></button><div className="topbar-search"><Search size={16} /><span>Search your music...</span></div><div className="topbar-actions">{mockConfig?.enabled && <span className="desktop-badge">Mock Spotify data</span>}<span className="desktop-badge"><Disc3 size={15} /> Windows desktop</span><button className="icon-button"><CircleUserRound size={20} /></button></div></header><div className="page">
      {route.kind === "dashboard" && <Dashboard profile={profile} connected={connected} navigate={navigate} savedIds={savedIds} setSavedIds={setSavedIds} toggleSaved={toggleSaved} />}
      {route.kind === "assistant" && <Assistant connected={connected} />}
      {route.kind === "playlists" && <Playlists clientId={clientId} connected={connected} navigate={navigate} />}
      {route.kind === "playlist" && route.id && <PlaylistDetail clientId={clientId} id={route.id} savedIds={savedIds} setSavedIds={setSavedIds} toggleSaved={toggleSaved} goBack={goBack} navigate={navigate} />}
      {route.kind === "discover" && <Discover clientId={clientId} connected={connected} navigate={navigate} savedIds={savedIds} toggleSaved={toggleSaved} />}
      {route.kind === "library" && <Library clientId={clientId} connected={connected} navigate={navigate} savedIds={savedIds} setSavedIds={setSavedIds} toggleSaved={toggleSaved} />}
      {route.kind === "stats" && <ErrorBoundary><Stats clientId={clientId} connected={connected} navigate={navigate} savedIds={savedIds} setSavedIds={setSavedIds} toggleSaved={toggleSaved} /></ErrorBoundary>}
      {route.kind === "track" && route.id && <TrackDetail clientId={clientId} id={route.id} goBack={goBack} navigate={navigate} savedIds={savedIds} toggleSaved={toggleSaved} />}
      {route.kind === "album" && route.id && <AlbumDetail clientId={clientId} id={route.id} goBack={goBack} navigate={navigate} savedIds={savedIds} setSavedIds={setSavedIds} toggleSaved={toggleSaved} />}
      {route.kind === "artist" && route.id && <ArtistDetail clientId={clientId} id={route.id} goBack={goBack} navigate={navigate} />}
      {route.kind === "settings" && <Settings connected={connected} profile={profile} connecting={connecting} error={error} configured={isSpotifyConfigured()} onConnect={() => void connect()} onDisconnect={() => void disconnect()} mockConfig={mockConfig} diagnostics={diagnostics} onMockChange={updateMockMode} onMockConfigChange={updateMockConfig} onRefreshDiagnostics={() => void refreshDiagnostics()} onResetDiagnostics={() => void resetDiagnostics()} />}
    </div></main>
  </div>;
}

function NavItem({ item, active, onSelect }: { item: typeof nav[number]; active: Route["kind"]; onSelect: (s: Section) => void }) { const Icon = item.icon; return <button className={`nav-item ${active === item.id ? "active" : ""}`} onClick={() => onSelect(item.id)}><Icon size={17} /><span>{item.label}</span>{item.id === "assistant" && <i />}</button>; }
function Header({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: React.ReactNode }) { return <div className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="subtitle">{subtitle}</p></div>{action}</div>; }
function State({ loading, error, connected, children }: { loading: boolean; error?: string; connected: boolean; children: React.ReactNode }) { if (!connected) return <div className="empty-state"><Disc3 size={28} /><h3>Connect Spotify to see your music</h3><p>Your playlists, listening history, and library will appear here after authorization.</p></div>; if (loading) return <div className="loading-state">Loading your Spotify data…</div>; if (error) return <div className="error-state">{error}</div>; return <>{children}</>; }
function Dashboard({ profile, connected, navigate, savedIds, setSavedIds, toggleSaved }: { profile?: Profile; connected: boolean; navigate: (r: Route) => void; savedIds: Set<string>; setSavedIds: React.Dispatch<React.SetStateAction<Set<string>>>; toggleSaved: (id: string, saved: boolean) => Promise<void> }) {
  const recent = useSpotifyResource("recent", fetchRecentlyPlayed, connected, { staleAfterMs: 5 * 60_000 });
  const topArtists = useSpotifyResource("top-artists:short_term", fetchTopArtists("short_term"), connected, { staleAfterMs: 5 * 60_000 });
  const topTracks = useSpotifyResource("top-tracks:short_term", fetchTopTracks("short_term"), connected, { staleAfterMs: 5 * 60_000 });
  const playlists = useSpotifyResource("playlists", fetchPlaylists, connected, { staleAfterMs: 5 * 60_000 });
  const resources = [recent, topArtists, topTracks, playlists];
  const ready = recent.data && topArtists.data && topTracks.data && playlists.data;
  const firstError = resources.find(resource => resource.error)?.error;
  const loading = !ready && !firstError;
  const refreshing = resources.some(resource => resource.phase === "refreshing");
  const refreshAll = () => resources.forEach(resource => resource.refresh());
  const genre = useMemo(() => mostCommonGenre(topArtists.data?.items.map(a => a.genres ?? []) ?? []), [topArtists.data]);
  const hours = recent.data ? estimateListeningHours(recent.data.items) : undefined;
  return <div className="content-stack"><Header eyebrow="YOUR LISTENING" title={`Good evening, ${profile?.displayName ?? "there"}.`} subtitle="Your real Spotify listening, in one place." action={<RefreshButton onClick={refreshAll} refreshing={loading || refreshing} label="Refresh dashboard" />} /><State loading={loading} error={ready ? undefined : firstError} connected={connected}>{ready && <>{firstError && <div className="refresh-error">{firstError}</div>}<div className="stat-grid"><Stat value={hours ? `${hours.toFixed(1)}h` : "—"} label="recent listening estimate" icon={<Activity size={18} />} /><Stat value={topTracks.data!.items[0]?.name ?? "—"} label="top track · short term" icon={<Play size={18} />} /><Stat value={genre ?? "Unavailable"} label="favorite genre · top artists" icon={<Disc3 size={18} />} /></div><SectionTitle title="Your playlists" action="View all" onClick={() => navigate({ kind: "playlists" })} onRefresh={playlists.refresh} refreshing={playlists.phase === "refreshing"} updatedAt={playlists.updatedAt} /><div className="playlist-grid">{playlists.data!.items.slice(0, 3).map(p => <PlaylistCard key={p.id} playlist={p} onOpen={() => navigate({ kind: "playlist", id: p.id })} />)}</div><div className="two-column"><div className="panel"><SectionTitle title="Recently played" action="View library" onClick={() => navigate({ kind: "library" })} onRefresh={recent.refresh} refreshing={recent.phase === "refreshing"} updatedAt={recent.updatedAt} /><TrackList tracks={recent.data!.items.slice(0, 20).map(x => x.track)} navigate={navigate} savedIds={savedIds} setSavedIds={setSavedIds} toggleSaved={toggleSaved} /></div><div className="panel"><SectionTitle title="Top artists" action="Stats" onClick={() => navigate({ kind: "stats" })} onRefresh={topArtists.refresh} refreshing={topArtists.phase === "refreshing"} updatedAt={topArtists.updatedAt} />{topArtists.data!.items.slice(0, 5).map((a, i) => <ArtistRow key={a.id} artist={a} rank={i + 1} onOpen={() => navigate({ kind: "artist", id: a.id })} />)}</div></div></>}</State></div>;
}
function Playlists({ clientId, connected, navigate }: { clientId: string; connected: boolean; navigate: (r: Route) => void }) {
  const [page, setPage] = useState<Page<Playlist>>(); const [query, setQuery] = useState(""); const [error, setError] = useState(""); const [loading, setLoading] = useState(connected); const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => { if (!connected) return; void window.vibetify.spotify.playlists(clientId).then(x => { const data = x as Page<Playlist>; setPage(data); }).catch(e => setError(e instanceof Error ? e.message : "Could not load playlists.")).finally(() => setLoading(false)); }, [clientId, connected]);
  const loadMore = async () => { if (!page?.next) return; setLoadingMore(true); try { const next = await window.vibetify.spotify.playlists(clientId, page.items.length) as Page<Playlist>; setPage(current => current ? { ...next, items: [...current.items, ...next.items] } : next); } catch (e) { setError(e instanceof Error ? e.message : "Could not load more playlists."); } finally { setLoadingMore(false); } };
  const filtered = page ? filterByQuery(page.items, query) : [];
  return <div className="content-stack"><Header eyebrow="YOUR COLLECTION" title="My playlists" subtitle="Recently played playlists first when Spotify history provides playlist context." /><div className="local-search"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search your playlists" />{query && <button onClick={() => setQuery("")} aria-label="Clear playlist search"><X size={15} /></button>}</div><State loading={loading} error={error} connected={connected}>{page && <>{filtered.length ? <div className="playlist-grid wide">{filtered.map(p => <PlaylistCard key={p.id} playlist={p} onOpen={() => navigate({ kind: "playlist", id: p.id })} />)}</div> : <div className="empty-state"><Search size={25} /><p>No playlists match “{query}”.</p><button className="link-button" onClick={() => setQuery("")}>Clear search</button></div>}{!query && page.next && <button className="load-more" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? "Loading…" : "Load more playlists"}</button>}</>}</State></div>;
}
function PlaylistDetail({ clientId, id, goBack, navigate, savedIds, setSavedIds, toggleSaved }: { clientId: string; id: string; goBack: () => void; navigate: (r: Route) => void; savedIds: Set<string>; setSavedIds: React.Dispatch<React.SetStateAction<Set<string>>>; toggleSaved: (id: string, saved: boolean) => Promise<void> }) {
  const [playlist, setPlaylist] = useState<(Playlist & { items?: Page<{ added_at?: string; track?: Track }> })>(); const [error, setError] = useState(""); const [query, setQuery] = useState("");
  useEffect(() => { void window.vibetify.spotify.playlist(clientId, id).then(x => setPlaylist(x as typeof playlist)).catch(e => setError(e instanceof Error ? e.message : "Could not load playlist.")); }, [clientId, id]);
  if (error) return <DetailShell goBack={goBack}><div className="error-state">{error}</div></DetailShell>;
  if (!playlist) return <DetailShell goBack={goBack}><div className="loading-state">Loading playlist…</div></DetailShell>;
  const items = playlist.items?.items.map(item => item.track).filter((t): t is Track => Boolean(t)) ?? [];
  const filteredItems = filterTracksByQuery(items, query);
  const trackCount = playlist.tracks?.total;
  const inaccessible = !playlist.items || (trackCount !== undefined && trackCount > 0 && items.length === 0);
  return <DetailShell goBack={goBack}><div className="detail-hero"><img src={playlist.images?.[0]?.url} alt="" /><div><p className="eyebrow">PLAYLIST</p><h1>{playlist.name}</h1><p className="subtitle">{playlist.description || "No description"} · {playlist.owner?.display_name ?? "Spotify"} · {trackCount === undefined ? "Track count unavailable" : `${trackCount} tracks`}</p></div></div>{inaccessible ? <div className="empty-state"><h3>Playlist tracks are unavailable</h3><p>Spotify did not provide access to this playlist's contents.</p></div> : <><div className="local-search"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search tracks, artists, or albums" />{query && <button onClick={() => setQuery("")} aria-label="Clear track search"><X size={15} /></button>}</div>{filteredItems.length ? <TrackList tracks={filteredItems} navigate={navigate} savedIds={savedIds} setSavedIds={setSavedIds} toggleSaved={toggleSaved} /> : <div className="empty-state"><Search size={25} /><p>No tracks match “{query}”.</p><button className="link-button" onClick={() => setQuery("")}>Clear search</button></div>}</>}</DetailShell>;
}
function Discover({ clientId, connected, navigate, savedIds, toggleSaved }: { clientId: string; connected: boolean; navigate: (r: Route) => void; savedIds: Set<string>; toggleSaved: (id: string, saved: boolean) => Promise<void> }) {
  const [query, setQuery] = useState(""); const [result, setResult] = useState<any>(); const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  const searchVersion = useRef(0);
  useEffect(() => {
    const version = ++searchVersion.current;
    const timer = setTimeout(() => {
      if (query.trim().length < 2 || !connected) { setResult(undefined); setLoading(false); return; }
      setLoading(true);
      setError("");
      void window.vibetify.spotify.search(clientId, query, "track,artist,album,playlist")
        .then(value => { if (version === searchVersion.current) setResult(value); })
        .catch(e => { if (version === searchVersion.current) setError(e instanceof Error ? e.message : "Search failed."); })
        .finally(() => { if (version === searchVersion.current) setLoading(false); });
    }, 500);
    return () => clearTimeout(timer);
  }, [clientId, query, connected]);
  const tracks = result?.tracks?.items ?? []; const artists = result?.artists?.items ?? []; const albums = result?.albums?.items ?? []; const playlists = result?.playlists?.items ?? [];
  return <div className="content-stack"><Header eyebrow="SPOTIFY CATALOG" title="Discover" subtitle="Search Spotify tracks, artists, albums, and playlists together." /><div className="discover-search"><Search size={17} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder={connected ? "Search everything on Spotify..." : "Connect Spotify first"} />{query && <button onClick={() => setQuery("")} aria-label="Clear search"><X size={15} /></button>}</div><State loading={loading} error={error} connected={connected}>{query.trim().length < 2 ? <div className="empty-state"><Search size={25} /><p>Type at least 2 characters to search Spotify.</p></div> : !tracks.length && !artists.length && !albums.length && !playlists.length ? <div className="empty-state"><Search size={25} /><p>No Spotify results found.</p></div> : <div className="unified-results"><ResultGroup title="Songs" className="track-results">{tracks.map((item: any) => <SearchResult key={`track-${item.id}`} item={item} type="track" navigate={navigate} savedIds={savedIds} toggleSaved={toggleSaved} />)}</ResultGroup><ResultGroup title="Artists" className="result-cards">{artists.map((item: any) => <SearchResult key={`artist-${item.id}`} item={item} type="artist" navigate={navigate} savedIds={savedIds} toggleSaved={toggleSaved} />)}</ResultGroup><ResultGroup title="Albums" className="result-cards">{albums.map((item: any) => <SearchResult key={`album-${item.id}`} item={item} type="album" navigate={navigate} savedIds={savedIds} toggleSaved={toggleSaved} />)}</ResultGroup><ResultGroup title="Playlists" className="result-cards">{playlists.map((item: any) => <SearchResult key={`playlist-${item.id}`} item={item} type="playlist" navigate={navigate} savedIds={savedIds} toggleSaved={toggleSaved} />)}</ResultGroup></div>}</State></div>;
}
function ResultGroup({ title, className, children }: { title: string; className: string; children: React.ReactNode }) { return <section className="result-group"><SectionTitle title={title} action="" /><div className={className}>{children}</div></section>; }
function Library({ clientId, connected, navigate, savedIds, setSavedIds, toggleSaved }: { clientId: string; connected: boolean; navigate: (r: Route) => void; savedIds: Set<string>; setSavedIds: React.Dispatch<React.SetStateAction<Set<string>>>; toggleSaved: (id: string, saved: boolean) => Promise<void> }) { const [page, setPage] = useState<Page<{ added_at: string; track: Track }>>(); const [error, setError] = useState(""); useEffect(() => { if (!connected) return; void window.vibetify.spotify.library(clientId).then(x => { const result = x as Page<{ added_at: string; track: Track }>; setPage(result); setSavedIds(current => { const next = new Set(current); result.items.forEach(item => next.add(item.track.id)); return next; }); }).catch(e => setError(e instanceof Error ? e.message : "Could not load library.")); }, [clientId, connected]); return <div className="content-stack"><Header eyebrow="YOUR MUSIC" title="Liked songs" subtitle="Saved tracks from your Spotify library." /><State loading={!page && !error} error={error} connected={connected}>{page && <div className="panel"><SectionTitle title={`${page.total} liked songs`} action="" /><TrackList tracks={page.items.map(x => x.track)} navigate={navigate} savedIds={savedIds} setSavedIds={setSavedIds} toggleSaved={toggleSaved} /></div>}</State></div>; }
function Stats({ clientId, connected, navigate, savedIds, setSavedIds, toggleSaved }: { clientId: string; connected: boolean; navigate: (r: Route) => void; savedIds: Set<string>; setSavedIds: React.Dispatch<React.SetStateAction<Set<string>>>; toggleSaved: (id: string, saved: boolean) => Promise<void> }) {
  const [range, setRange] = useState("short_term");
  const artists = useSpotifyResource(`top-artists:${range}`, fetchTopArtists(range), connected, { staleAfterMs: 5 * 60_000 });
  const tracks = useSpotifyResource(`top-tracks:${range}`, fetchTopTracks(range), connected, { staleAfterMs: 5 * 60_000 });
  const recent = useSpotifyResource("recent", fetchRecentlyPlayed, connected, { staleAfterMs: 5 * 60_000 });
  const resources = [artists, tracks, recent];
  const ready = artists.data && tracks.data && recent.data;
  const firstError = resources.find(resource => resource.error)?.error;
  const loading = !ready && !firstError;
  const refreshing = resources.some(resource => resource.phase === "refreshing");
  const refreshAll = () => resources.forEach(resource => resource.refresh());
  const listening = useMemo(() => estimateArtistListeningMinutes(recent.data?.items ?? []), [recent.data]);
  return <div className="content-stack"><Header eyebrow="YOUR LISTENING" title="Listening stats" subtitle="Rankings from Spotify. Listening time is estimated from the available recent-play history." action={<div className="header-actions"><select className="range-select" value={range} onChange={e => setRange(e.target.value)}><option value="short_term">Last 4 weeks</option><option value="medium_term">Last 6 months</option><option value="long_term">Last year</option></select><RefreshButton onClick={refreshAll} refreshing={loading || refreshing} label="Refresh listening stats" /></div>} /><State loading={loading} error={ready ? undefined : firstError} connected={connected}>{ready && <>{firstError && <div className="refresh-error">{firstError}</div>}<div className="two-column"><div className="panel"><SectionTitle title="Top artists" onRefresh={artists.refresh} refreshing={artists.phase === "refreshing"} updatedAt={artists.updatedAt} />{artists.data!.items.map((a, i) => <div className="artist-stat-row" key={a.id}><ArtistRow artist={a} rank={i + 1} listeningTime={formatListeningMinutes(listening.get(a.id))} onOpen={() => navigate({ kind: "artist", id: a.id })} /></div>)}</div><div className="panel"><SectionTitle title="Top tracks" onRefresh={tracks.refresh} refreshing={tracks.phase === "refreshing"} updatedAt={tracks.updatedAt} /><TrackList tracks={tracks.data!.items} navigate={navigate} savedIds={savedIds} setSavedIds={setSavedIds} toggleSaved={toggleSaved} /></div></div></>}</State></div>;
}
class ErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError(): { hasError: boolean } { return { hasError: true }; }
  render() { return this.state.hasError ? <div className="error-state"><h3>Listening Stats could not be displayed</h3><p>Spotify returned incomplete data. Please try again.</p></div> : this.props.children; }
}
function DetailShell({ goBack, children }: { goBack: () => void; children: React.ReactNode }) { return <div className="content-stack"><button className="back-button" onClick={goBack}><ArrowLeft size={16} /> Back</button>{children}</div>; }
function TrackDetail({ clientId, id, goBack, navigate, savedIds, toggleSaved }: { clientId: string; id: string; goBack: () => void; navigate: (r: Route) => void; savedIds: Set<string>; toggleSaved: (id: string, saved: boolean) => Promise<void> }) { const [track, setTrack] = useState<Track>(); useEffect(() => { void window.vibetify.spotify.track(clientId, id).then(x => setTrack(x as Track)); }, [clientId, id]); if (!track) return <DetailShell goBack={goBack}><div className="loading-state">Loading track…</div></DetailShell>; return <DetailShell goBack={goBack}><div className="entity-hero"><img src={track.album.images?.[0]?.url} alt="" /><div><p className="eyebrow">TRACK</p><h1>{track.name}</h1><button className="link-button" onClick={() => navigate({ kind: "artist", id: track.artists[0].id })}>{track.artists.map(a => a.name).join(", ")}</button><p className="subtitle">{track.album.name} · {formatDuration(track.duration_ms)}</p></div></div><HeartButton id={track.id} saved={savedIds.has(track.id)} toggleSaved={toggleSaved} /></DetailShell>; }
function AlbumDetail({ clientId, id, goBack, navigate, savedIds, setSavedIds, toggleSaved }: { clientId: string; id: string; goBack: () => void; navigate: (r: Route) => void; savedIds: Set<string>; setSavedIds: React.Dispatch<React.SetStateAction<Set<string>>>; toggleSaved: (id: string, saved: boolean) => Promise<void> }) { const [album, setAlbum] = useState<Album>(); useEffect(() => { void window.vibetify.spotify.album(clientId, id).then(x => setAlbum(x as Album)); }, [clientId, id]); if (!album) return <DetailShell goBack={goBack}><div className="loading-state">Loading album…</div></DetailShell>; return <DetailShell goBack={goBack}><div className="entity-hero"><img src={album.images?.[0]?.url} alt="" /><div><p className="eyebrow">ALBUM</p><h1>{album.name}</h1><button className="link-button" onClick={() => navigate({ kind: "artist", id: album.artists[0].id })}>{album.artists.map(a => a.name).join(", ")}</button><p className="subtitle">{album.release_date ?? "Release date unavailable"} · {album.total_tracks ?? album.tracks?.total ?? 0} tracks</p></div></div><TrackList tracks={album.tracks?.items ?? []} navigate={navigate} savedIds={savedIds} setSavedIds={setSavedIds} toggleSaved={toggleSaved} /></DetailShell>; }
function ArtistDetail({ clientId, id, goBack, navigate }: { clientId: string; id: string; goBack: () => void; navigate: (r: Route) => void }) { const [artist, setArtist] = useState<Artist & { albums?: Page<Album> }>(); useEffect(() => { void window.vibetify.spotify.artist(clientId, id).then(x => setArtist(x as typeof artist)); }, [clientId, id]); if (!artist) return <DetailShell goBack={goBack}><div className="loading-state">Loading artist…</div></DetailShell>; return <DetailShell goBack={goBack}><div className="entity-hero artist-hero"><img src={artist.images?.[0]?.url} alt="" /><div><p className="eyebrow">ARTIST</p><h1>{artist.name}</h1><p className="subtitle">{artist.genres?.join(" · ") || "Genre metadata unavailable"}</p></div></div><SectionTitle title="Albums and singles" action="" /><div className="playlist-grid wide">{artist.albums?.items.map(album => <button className="album-card" key={album.id} onClick={() => navigate({ kind: "album", id: album.id })}><img src={album.images?.[0]?.url} alt="" /><b>{album.name}</b><small>{album.release_date ?? "Unknown date"}</small></button>)}</div></DetailShell>; }
function SearchResult({ item, type, navigate, savedIds, toggleSaved }: { item: any; type: string; navigate: (r: Route) => void; savedIds: Set<string>; toggleSaved: (id: string, saved: boolean) => Promise<void> }) { const image = item.images?.[0]?.url ?? item.album?.images?.[0]?.url; const resultType = classifySearchResult(type); const target: Route = resultType === "track" ? { kind: "track", id: item.id } : resultType === "artist" ? { kind: "artist", id: item.id } : resultType === "album" ? { kind: "album", id: item.id } : { kind: "playlist", id: item.id }; const details = resultType === "track" ? `${item.artists?.map((a: Artist) => a.name).join(", ")} · ${item.album?.name ?? ""}` : resultType === "album" ? item.artists?.map((a: Artist) => a.name).join(", ") : resultType === "playlist" ? `by ${item.owner?.display_name ?? "Spotify"}` : "Spotify artist"; return <button className={`search-result result-${resultType}`} onClick={() => navigate(target)}><img src={image} alt="" /><span><small className="result-type">{resultType.toUpperCase()}</small><b>{item.name}</b><small>{details}</small></span>{resultType === "track" && <HeartButton id={item.id} saved={savedIds.has(item.id)} toggleSaved={toggleSaved} />}</button>; }
function ArtistRow({ artist, rank, listeningTime, onOpen }: { artist: Artist; rank: number; listeningTime?: string; onOpen: () => void }) { return <button className="artist-row" onClick={onOpen}><b>{rank}</b><img src={artist.images?.[0]?.url} alt="" /><span>{artist.name}</span>{listeningTime && <small>{listeningTime}</small>}</button>; }
function HeartButton({ id, saved, toggleSaved }: { id: string; saved: boolean; toggleSaved: (id: string, saved: boolean) => Promise<void> }) { const [busy, setBusy] = useState(false); return <button className={`heart-button ${saved ? "saved" : ""}`} disabled={busy} onClick={e => { e.stopPropagation(); setBusy(true); void toggleSaved(id, !saved).finally(() => setBusy(false)); }} aria-label={saved ? "Remove from liked songs" : "Save to liked songs"}><Heart size={16} fill={saved ? "currentColor" : "none"} /></button>; }
function TrackList({ tracks, navigate, savedIds, setSavedIds, toggleSaved }: { tracks: Track[]; navigate: (r: Route) => void; savedIds: Set<string>; setSavedIds: React.Dispatch<React.SetStateAction<Set<string>>>; toggleSaved: (id: string, saved: boolean) => Promise<void> }) {
  useEffect(() => {
    const ids = [...new Set(tracks.map(track => track.id))];
    if (!ids.length || !clientId) return;
    void window.vibetify.spotify.savedStatus(clientId, ids).then(status => setSavedIds(current => { const next = new Set(current); ids.forEach((id, index) => status[index] ? next.add(id) : next.delete(id)); return next; })).catch(() => undefined);
  }, [tracks, setSavedIds]);
  return <div className="track-list">{tracks.map((track, i) => <div className="track-row" key={`${track.id}-${i}`}><button className="track-main" onClick={() => navigate({ kind: "track", id: track.id })}><div className="track-art" style={{ backgroundImage: track.album.images?.[0]?.url ? `url(${track.album.images[0].url})` : undefined }}>♪</div><div className="track-info"><b>{track.name}</b><small>{track.artists.map(a => a.name).join(", ")} · {track.album.name}</small></div></button><span className="track-duration">{formatDuration(track.duration_ms)}</span><HeartButton id={track.id} saved={savedIds.has(track.id)} toggleSaved={toggleSaved} /></div>)}</div>;
}
function Settings({ connected, profile, connecting, error, configured, onConnect, onDisconnect, mockConfig, diagnostics, onMockChange, onMockConfigChange, onRefreshDiagnostics, onResetDiagnostics }: { connected: boolean; profile?: Profile; connecting: boolean; error: string; configured: boolean; onConnect: () => void; onDisconnect: () => void; mockConfig?: MockConfig; diagnostics?: Diagnostics; onMockChange: (enabled: boolean) => Promise<void>; onMockConfigChange: (config: { status?: string; delayMs?: number }) => Promise<void>; onRefreshDiagnostics: () => void; onResetDiagnostics: () => void }) {
  return <div className="content-stack settings-page"><Header eyebrow="PREFERENCES" title="Settings" subtitle="Your Spotify connection and development tools." /><div className="settings-card"><div className="settings-icon green">{profile?.imageUrl ? <img className="settings-avatar" src={profile.imageUrl} alt="" /> : <LockKeyhole size={18} />}</div><div><h3>{connected ? profile?.displayName : "Spotify connection"}</h3><p>{connected ? `Connected account · ${profile?.id}` : configured ? "Ready to connect your Spotify account." : "Add VITE_SPOTIFY_CLIENT_ID to enable OAuth."}</p>{error && <p className="settings-error">{error}</p>}</div>{connected ? <button className="outline-button danger" onClick={onDisconnect}>Disconnect</button> : <button className="outline-button" disabled={!configured || connecting} onClick={onConnect}>{connecting ? "Waiting for Spotify..." : "Connect Spotify"}</button>}</div>{mockConfig && <><div className="settings-card"><div><h3>Offline Spotify Mock Mode</h3><p>{mockConfig.enabled ? "Mock data is active. No Spotify API requests are sent." : "Real Spotify API mode is active."}</p>{mockConfig.enabled && <div><label>Response <select value={mockConfig.status} onChange={event => void onMockConfigChange({ status: event.target.value })}><option value="200">200 OK</option><option value="401">401 Unauthorized</option><option value="403">403 Forbidden</option><option value="429">429 Rate limited</option><option value="QUOTA_EXCEEDED">QUOTA_EXCEEDED</option><option value="500">500 Server error</option><option value="network">Network error</option></select></label><label> Delay <input type="number" min="0" max="5000" value={mockConfig.delayMs} onChange={event => void onMockConfigChange({ delayMs: Number(event.target.value) })} /> ms</label></div>}</div><button className="outline-button" onClick={() => void onMockChange(!mockConfig.enabled)}>{mockConfig.enabled ? "Use real API" : "Use mock data"}</button></div><div className="settings-card"><div><h3>Request diagnostics</h3>{diagnostics ? <p>{diagnostics.sessionRequests} requests · {diagnostics.cacheHits} cache hits · {diagnostics.cacheMisses} misses · {diagnostics.duplicateRequestsPrevented} deduplicated · concurrency {diagnostics.currentConcurrentRequests}/{diagnostics.maximumObservedConcurrency} · {diagnostics.queuedRequests} queued · {diagnostics.failedRequests} failed · {diagnostics.cooldownRejected} cooldown-waited</p> : <p>Inspect simulated navigation traffic from the main process.</p>}{diagnostics && <small>{Object.entries(diagnostics.requestsByEndpoint).map(([endpoint, count]) => `${endpoint}: ${count}`).join(" · ")}</small>}</div><button className="outline-button" onClick={onRefreshDiagnostics}>Refresh</button><button className="outline-button" onClick={onResetDiagnostics}>Reset</button></div></>}</div>;
}
function Assistant({ connected }: { connected: boolean }) {
  const [conversations, setConversations] = useState<AIConversationSummary[]>([]);
  const [conversation, setConversation] = useState<AIConversation>();
  const [prompt, setPrompt] = useState("");
  const [activity, setActivity] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastPrompt, setLastPrompt] = useState("");
  const [status, setStatus] = useState<{ label: string; model?: string; available?: boolean; modelInstalled?: boolean }>();
  const chatLogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void Promise.all([window.vibetify.ai.status(), window.vibetify.ai.listConversations()]).then(async ([nextStatus, list]) => {
      setStatus(nextStatus);
      setConversations(list);
      const current = list[0] ? await window.vibetify.ai.getConversation(list[0].id) : await window.vibetify.ai.newConversation();
      if (current) setConversation(current);
    }).catch(e => setError(e instanceof Error ? e.message : "Could not load the assistant."));
  }, []);
  const startConversation = async () => {
    try { setError(""); const next = await window.vibetify.ai.newConversation(); setConversation(next); setConversations(await window.vibetify.ai.listConversations()); } catch (e) { setError(e instanceof Error ? e.message : "Could not start a conversation."); }
  };
  const deleteConversation = async (id: string) => {
    try {
      await window.vibetify.ai.deleteConversation(id);
      const list = await window.vibetify.ai.listConversations();
      setConversations(list);
      const next = list[0] ? await window.vibetify.ai.getConversation(list[0].id) : await window.vibetify.ai.newConversation();
      if (next) setConversation(next);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not delete the conversation."); }
  };
  const selectConversation = async (id: string) => {
    try { const selected = await window.vibetify.ai.getConversation(id); if (selected) setConversation(selected); } catch (e) { setError(e instanceof Error ? e.message : "Could not load the conversation."); }
  };
  const send = async (value = prompt) => {
    const text = value.trim();
    if (!text || !conversation || loading) return;
    setPrompt(""); setError(""); setLoading(true); setActivity([]);
    setLastPrompt(text);
    setConversation(current => current ? { ...current, updatedAt: new Date().toISOString(), messages: [...current.messages, createOptimisticMessage(text)] } : current);
    try {
      const result = await window.vibetify.ai.send(clientId, conversation.id, text);
      setConversation(result.conversation);
      setActivity(result.toolActivity);
      setConversations(await window.vibetify.ai.listConversations());
    } catch (e) { setError(e instanceof Error ? e.message : "The assistant could not complete that request."); } finally { setLoading(false); }
  };
  useEffect(() => {
    const log = chatLogRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [conversation?.messages.length, loading, activity.length]);
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } };
  return <div className="assistant-page"><Header eyebrow="AI ASSISTANT" title="Make something memorable." subtitle="Ask about your Spotify profile, playlists, or listening statistics." action={<button className="secondary-button" onClick={() => void startConversation()}>New conversation</button>} /><div className="assistant-layout"><aside className="conversation-list"><div className="assistant-status"><span className={`status-dot ${status?.available === false ? "disconnected" : "connected"}`} />{status?.label ?? "Mock AI"}{status?.model ? ` · ${status.model}` : ""}</div>{status?.available === false && <div className="assistant-note">The configured AI backend is unavailable. Start it and retry.</div>}{status?.modelInstalled === false && <div className="assistant-note">The configured Ollama model is not installed.</div>}{conversations.map(item => <div className="conversation-row" key={item.id}><button className={`conversation-item ${item.id === conversation?.id ? "active" : ""}`} onClick={() => void selectConversation(item.id)}>{item.title}</button><button className="conversation-delete" onClick={() => void deleteConversation(item.id)} aria-label={`Delete ${item.title}`}>×</button></div>)}</aside><section className="assistant-panel"><div className="chat-log" ref={chatLogRef}>{conversation?.messages.length ? conversation.messages.map(message => <div className={`message ${message.role}`} key={message.id}><div className="message-icon">{message.role === "assistant" ? <Bot size={17} /> : <CircleUserRound size={17} />}</div>{message.role === "assistant" ? <MarkdownMessage content={message.content} /> : <p>{message.content}</p>}</div>) : <div className="assistant-empty"><Bot size={28} /><p>Try “Show me my Spotify playlists.”</p></div>}{activity.map(item => <div className="tool-activity" key={item}>{item}</div>)}{loading && <div className="tool-activity thinking-indicator"><span />Thinking...</div>}</div>{error && <div className="error-state">{error} {lastPrompt && <button className="link-button retry-button" onClick={() => void send(lastPrompt)}>Retry</button>}</div>}{!connected && <div className="assistant-note">Connect Spotify to use Spotify tools. Mock Spotify mode can be used for development.</div>}<div className="chat-input"><input value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={handleKeyDown} placeholder="Ask anything about your music..." disabled={loading} /><button disabled={(!prompt.trim() && !lastPrompt) || loading} onClick={() => void send(lastPrompt || prompt)} aria-label="Send message">↑</button></div></section></div></div>;
}
function MarkdownMessage({ content }: { content: string }) {
  return <div className="message-content"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>{normalizeEscapedMarkdown(content)}</ReactMarkdown></div>;
}
function SectionTitle({ title, action, onClick, onRefresh, refreshing, updatedAt }: { title: string; action?: string; onClick?: () => void; onRefresh?: () => void; refreshing?: boolean; updatedAt?: number }) { return <div className="section-title"><h2>{title}</h2><div className="section-title-actions">{updatedAt !== undefined && <UpdatedText updatedAt={updatedAt} />}{onRefresh && <RefreshButton onClick={onRefresh} refreshing={Boolean(refreshing)} label={`Refresh ${title}`} />}{action && <button onClick={onClick}>{action}</button>}</div></div>; }
function RefreshButton({ onClick, refreshing, label }: { onClick: () => void; refreshing: boolean; label: string }) { return <button className="icon-button refresh-button" onClick={onClick} disabled={refreshing} aria-label={label} title={label}><RefreshCw size={15} className={refreshing ? "spin" : ""} /></button>; }
function UpdatedText({ updatedAt }: { updatedAt?: number }) { return updatedAt ? <span className="updated-text">{formatUpdated(updatedAt)}</span> : null; }
function formatUpdated(updatedAt: number): string { const elapsed = Date.now() - updatedAt; if (elapsed < 60_000) return "Updated just now"; if (elapsed < 3_600_000) return `Updated ${Math.max(1, Math.floor(elapsed / 60_000))} minutes ago`; return `Updated at ${new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`; }
function Stat({ value, label, icon }: { value: string; label: string; icon: React.ReactNode }) { return <div className="stat panel"><span>{icon}</span><div><strong>{value}</strong><small>{label}</small></div></div>; }
function PlaylistCard({ playlist, onOpen }: { playlist: Playlist; onOpen: () => void }) { return <button className="playlist-card" onClick={onOpen}><div className="playlist-art" style={{ backgroundImage: playlist.images?.[0]?.url ? `url(${playlist.images[0].url})` : undefined }}><b>{playlist.images?.[0]?.url ? "" : "♪"}</b><span><Play size={14} fill="currentColor" /></span></div><h3>{playlist.name}</h3><p>{playlist.tracks?.total ?? 0} tracks · {playlist.owner?.display_name ?? "Spotify"}</p></button>; }
function formatDuration(ms: number): string { return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`; }

export default App;
