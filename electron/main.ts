import { app, BrowserWindow, ipcMain, shell } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { beginSpotifyAuthorization, disconnectSpotify, getAuthState } from "./spotify-auth";
import { getAlbum, getArtist, getDashboardData, getPlaylist, getRecentlyPlayed, getSavedStatus, getSavedTracks, getSpotifyDiagnostics, getSpotifyPlaylists, getTopArtists, getTopItems, getTopTracks, getTrack, searchSpotify, updateSavedTracks } from "./spotify-api";
import { getSpotifyMockConfig, setSpotifyMockConfig } from "./spotify-mock";
import { clearSpotifyRequestState, restoreSpotifyCooldown, setSpotifyCooldownPersistence } from "./spotify-request-manager";
import { ConversationManager } from "./ai/conversation-manager";
import { createAIService } from "./ai/orchestrator";
import { BackendAIProvider } from "./ai/backend-provider";
import type { Conversation } from "./ai/types";

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const aiProviderMode = process.env.AI_PROVIDER ?? "mock";
const backendProviderMode = process.env.AI_BACKEND_PROVIDER ?? "openai";
const aiBackendUrl = process.env.AI_BACKEND_URL;
let aiAccessToken = process.env.AI_ACCESS_TOKEN;
let aiAccessTokenExpiresAt = aiAccessToken ? Date.now() + 14 * 60_000 : 0;

async function getAIBackendToken(): Promise<string> {
  if (aiAccessToken && aiAccessTokenExpiresAt > Date.now() + 30_000) return aiAccessToken;
  const bootstrap = process.env.AI_BOOTSTRAP_TOKEN;
  if (!aiBackendUrl || !bootstrap) throw new Error("Real AI is not configured. Set AI_BACKEND_URL and AI_BOOTSTRAP_TOKEN.");
  const response = await fetch(`${aiBackendUrl.replace(/\/$/, "")}/v1/auth/token`, { method: "POST", headers: { "X-Bootstrap-Token": bootstrap } });
  if (!response.ok) throw new Error("The AI backend could not authorize this application.");
  const body = await response.json() as { accessToken?: unknown };
  if (typeof body.accessToken !== "string") throw new Error("The AI backend returned an invalid access token.");
  aiAccessToken = body.accessToken;
  aiAccessTokenExpiresAt = Date.now() + 14 * 60_000;
  return body.accessToken;
}

function createConfiguredAIProvider() {
  if (aiProviderMode !== "real") return undefined;
  if (!aiBackendUrl) throw new Error("Real AI is not configured. Set AI_BACKEND_URL.");
  return new BackendAIProvider(aiBackendUrl, getAIBackendToken);
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    center: true,
    backgroundColor: "#0e0b13",
    title: "Vibetify",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (isDevelopment) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL as string);
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    void window.loadFile(path.join(__dirname, "../dist/index.html"));
  }
  return window;
}

app.whenReady().then(async () => {
  const cooldownPath = path.join(app.getPath("userData"), "spotify-cooldown.json");
  setSpotifyCooldownPersistence(until => {
    void (until > Date.now()
      ? fs.mkdir(path.dirname(cooldownPath), { recursive: true }).then(() => fs.writeFile(cooldownPath, JSON.stringify({ until })))
      : fs.unlink(cooldownPath).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      })).catch(error => console.error(JSON.stringify({ component: "spotify-api", event: "cooldown-persist-failed", error: error instanceof Error ? error.message : "unknown" })));
  });
  try {
    const stored = JSON.parse(await fs.readFile(cooldownPath, "utf8")) as { until?: unknown };
    if (typeof stored.until === "number") restoreSpotifyCooldown(stored.until);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(JSON.stringify({ component: "spotify-api", event: "cooldown-restore-failed", error: error instanceof Error ? error.message : "unknown" }));
    }
  }
  const conversations = new ConversationManager(path.join(app.getPath("userData"), "ai-conversations.json"));
  const publicConversation = (conversation: Conversation) => ({
    ...conversation,
    messages: conversation.messages.filter(message => message.role !== "tool").map(message => ({ id: message.id, role: message.role, content: message.content, createdAt: message.createdAt }))
  });
  ipcMain.handle("app:open-external", (_event, url: unknown) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      throw new Error("Only HTTP(S) links can be opened.");
    }
    return shell.openExternal(url);
  });
  const window = createWindow();
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error(JSON.stringify({ component: "electron", event: "renderer-exited", reason: details.reason, exitCode: details.exitCode }));
  });
  window.on("closed", () => {
    console.info(JSON.stringify({ component: "electron", event: "window-closed" }));
  });
  ipcMain.handle("spotify:get-state", (_event, clientId: unknown) =>
    getAuthState(typeof clientId === "string" ? clientId : undefined));
  ipcMain.handle("spotify:disconnect", () => disconnectSpotify());
  ipcMain.handle("ai:status", async () => {
    const tools = ["get_spotify_profile", "get_spotify_playlists", "get_listening_stats"];
    if (aiProviderMode !== "real") return { provider: "mock", label: "Mock AI", tools };
    const fallback = { provider: backendProviderMode, label: backendProviderMode === "ollama" ? "Local AI (Qwen3 Coder 30B)" : "Real AI (OpenAI)", model: backendProviderMode === "ollama" ? (process.env.OLLAMA_MODEL ?? "qwen3-coder:30b") : (process.env.OPENAI_MODEL ?? "gpt-4.1-mini"), available: false, modelInstalled: false, tools };
    try {
      const provider = createConfiguredAIProvider();
      if (!(provider instanceof BackendAIProvider)) return fallback;
      const status = await provider.status();
      return { ...fallback, provider: status.provider, model: status.model, available: status.available, modelInstalled: status.modelInstalled };
    } catch {
      return fallback;
    }
  });
  ipcMain.handle("ai:list-conversations", async () => (await conversations.list()).map(publicConversation));
  ipcMain.handle("ai:get-conversation", async (_event, id: unknown) => {
    if (typeof id !== "string" || !id) throw new Error("Invalid conversation ID.");
    const conversation = await conversations.get(id);
    return conversation ? publicConversation(conversation) : undefined;
  });
  ipcMain.handle("ai:new-conversation", async () => publicConversation(await conversations.create()));
  ipcMain.handle("ai:delete-conversation", async (_event, id: unknown) => {
    if (typeof id !== "string" || !id) throw new Error("Invalid conversation ID.");
    await conversations.delete(id);
  });
  ipcMain.handle("ai:send", async (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") throw new Error("Invalid AI request.");
    const input = payload as { conversationId?: unknown; content?: unknown; clientId?: unknown };
    if (typeof input.conversationId !== "string" || typeof input.content !== "string" || !input.content.trim() || typeof input.clientId !== "string" || !input.clientId.trim()) throw new Error("Invalid AI request.");
    const service = createAIService(conversations, input.clientId, createConfiguredAIProvider());
    const result = await service.send(input.conversationId, input.content.trim());
    return { conversation: publicConversation(result.conversation), toolActivity: result.toolActivity };
  });
  if (isDevelopment) {
    ipcMain.handle("spotify:diagnostics", () => getSpotifyDiagnostics());
    ipcMain.handle("spotify:diagnostics-reset", () => { clearSpotifyRequestState(); return getSpotifyDiagnostics(); });
    ipcMain.handle("spotify:mock-config", (_event, next?: unknown) => {
      if (next === undefined) return getSpotifyMockConfig();
      if (!next || typeof next !== "object") throw new Error("Invalid Spotify mock configuration.");
      const input = next as { enabled?: unknown; status?: unknown; delayMs?: unknown };
      return setSpotifyMockConfig({
        ...(typeof input.enabled === "boolean" ? { enabled: input.enabled } : {}),
        ...(typeof input.status === "string" ? { status: input.status as ReturnType<typeof getSpotifyMockConfig>["status"] } : {}),
        ...(typeof input.delayMs === "number" ? { delayMs: input.delayMs } : {})
      });
    });
  }
  ipcMain.handle("spotify:begin", (event, payload: unknown) => {
    if (!payload || typeof payload !== "object") throw new Error("Invalid Spotify authorization request.");
    const { clientId, redirectUri } = payload as { clientId?: unknown; redirectUri?: unknown };
    if (typeof clientId !== "string" || typeof redirectUri !== "string") throw new Error("Invalid Spotify authorization configuration.");
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) throw new Error("The Vibetify window is unavailable.");
    return beginSpotifyAuthorization(senderWindow, clientId, redirectUri);
  });
  ipcMain.handle("spotify:dashboard", (_event, clientId: unknown, refresh?: unknown) => {
    if (typeof clientId !== "string" || !clientId.trim()) throw new Error("Spotify Client ID is not configured.");
    return getDashboardData(clientId, refresh === true);
  });
  ipcMain.handle("spotify:recently-played", (_event, clientId: unknown, refresh?: unknown) => {
    if (typeof clientId !== "string" || !clientId.trim()) throw new Error("Spotify Client ID is not configured.");
    return getRecentlyPlayed(clientId, 50, refresh === true);
  });
  ipcMain.handle("spotify:top-artists", (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") throw new Error("Invalid top artists request.");
    const { clientId, timeRange, refresh } = payload as { clientId?: unknown; timeRange?: unknown; refresh?: unknown };
    if (typeof clientId !== "string") throw new Error("Spotify Client ID is not configured.");
    return getTopArtists(clientId, typeof timeRange === "string" ? timeRange : "short_term", refresh === true);
  });
  ipcMain.handle("spotify:top-tracks", (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") throw new Error("Invalid top tracks request.");
    const { clientId, timeRange, refresh } = payload as { clientId?: unknown; timeRange?: unknown; refresh?: unknown };
    if (typeof clientId !== "string") throw new Error("Spotify Client ID is not configured.");
    return getTopTracks(clientId, typeof timeRange === "string" ? timeRange : "short_term", refresh === true);
  });
  ipcMain.handle("spotify:playlists", (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") throw new Error("Invalid playlist request.");
    const { clientId, offset, refresh } = payload as { clientId?: unknown; offset?: unknown; refresh?: unknown };
    if (typeof clientId !== "string") throw new Error("Spotify Client ID is not configured.");
    return getSpotifyPlaylists(clientId, typeof offset === "number" ? offset : 0, refresh === true);
  });
  ipcMain.handle("spotify:library", (_event, clientId: unknown) => {
    if (typeof clientId !== "string") throw new Error("Spotify Client ID is not configured.");
    return getSavedTracks(clientId);
  });
  ipcMain.handle("spotify:top-items", (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") throw new Error("Invalid listening stats request.");
    const { clientId, timeRange, refresh } = payload as { clientId?: unknown; timeRange?: unknown; refresh?: unknown };
    if (typeof clientId !== "string") throw new Error("Spotify Client ID is not configured.");
    return getTopItems(clientId, typeof timeRange === "string" ? timeRange : "short_term", refresh === true);
  });
  ipcMain.handle("spotify:search", (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") throw new Error("Invalid search request.");
    const { clientId, query, type, offset } = payload as { clientId?: unknown; query?: unknown; type?: unknown; offset?: unknown };
    if (typeof clientId !== "string" || typeof query !== "string") throw new Error("Invalid search request.");
    return searchSpotify(clientId, query, typeof type === "string" ? type : "track", typeof offset === "number" ? offset : 0);
  });
  ipcMain.handle("spotify:playlist", (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") throw new Error("Invalid playlist request.");
    const { clientId, id } = payload as { clientId?: unknown; id?: unknown };
    if (typeof clientId !== "string" || typeof id !== "string") throw new Error("Invalid playlist request.");
    return getPlaylist(clientId, id);
  });
  ipcMain.handle("spotify:track", (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") throw new Error("Invalid track request.");
    const { clientId, id } = payload as { clientId?: unknown; id?: unknown };
    if (typeof clientId !== "string" || typeof id !== "string") throw new Error("Invalid track request.");
    return getTrack(clientId, id);
  });
  ipcMain.handle("spotify:album", (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") throw new Error("Invalid album request.");
    const { clientId, id } = payload as { clientId?: unknown; id?: unknown };
    if (typeof clientId !== "string" || typeof id !== "string") throw new Error("Invalid album request.");
    return getAlbum(clientId, id);
  });
  ipcMain.handle("spotify:artist", (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") throw new Error("Invalid artist request.");
    const { clientId, id } = payload as { clientId?: unknown; id?: unknown };
    if (typeof clientId !== "string" || typeof id !== "string") throw new Error("Invalid artist request.");
    return getArtist(clientId, id);
  });
  ipcMain.handle("spotify:saved-status", (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") throw new Error("Invalid saved-track request.");
    const { clientId, ids } = payload as { clientId?: unknown; ids?: unknown };
    if (typeof clientId !== "string" || !Array.isArray(ids) || ids.some(id => typeof id !== "string")) throw new Error("Invalid saved-track request.");
    return getSavedStatus(clientId, ids);
  });
  ipcMain.handle("spotify:update-saved", (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") throw new Error("Invalid saved-track request.");
    const { clientId, ids, saved } = payload as { clientId?: unknown; ids?: unknown; saved?: unknown };
    if (typeof clientId !== "string" || !Array.isArray(ids) || ids.some(id => typeof id !== "string") || typeof saved !== "boolean") throw new Error("Invalid saved-track request.");
    return updateSavedTracks(clientId, ids, saved);
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error: unknown) => {
  console.error(JSON.stringify({ component: "electron", event: "startup-failure", error: error instanceof Error ? error.message : "unknown" }));
});

process.on("unhandledRejection", reason => {
  console.error(JSON.stringify({ component: "electron", event: "unhandled-rejection", error: reason instanceof Error ? reason.message : String(reason) }));
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
