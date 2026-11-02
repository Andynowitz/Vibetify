import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { beginSpotifyAuthorization, disconnectSpotify, getAuthState } from "./spotify-auth";
import { getAlbum, getArtist, getDashboardData, getPlaylist, getSavedStatus, getSpotifyPlaylists, getTopItems, getTrack, searchSpotify, updateSavedTracks } from "./spotify-api";

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);

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

app.whenReady().then(() => {
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
  ipcMain.handle("spotify:begin", (event, payload: unknown) => {
    if (!payload || typeof payload !== "object") throw new Error("Invalid Spotify authorization request.");
    const { clientId, redirectUri } = payload as { clientId?: unknown; redirectUri?: unknown };
    if (typeof clientId !== "string" || typeof redirectUri !== "string") throw new Error("Invalid Spotify authorization configuration.");
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) throw new Error("The Vibetify window is unavailable.");
    return beginSpotifyAuthorization(senderWindow, clientId, redirectUri);
  });
  ipcMain.handle("spotify:dashboard", (_event, clientId: unknown) => {
    if (typeof clientId !== "string" || !clientId.trim()) throw new Error("Spotify Client ID is not configured.");
    return getDashboardData(clientId);
  });
  ipcMain.handle("spotify:playlists", (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") throw new Error("Invalid playlist request.");
    const { clientId, offset } = payload as { clientId?: unknown; offset?: unknown };
    if (typeof clientId !== "string") throw new Error("Spotify Client ID is not configured.");
    return getSpotifyPlaylists(clientId, typeof offset === "number" ? offset : 0);
  });
  ipcMain.handle("spotify:top-items", (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") throw new Error("Invalid listening stats request.");
    const { clientId, timeRange } = payload as { clientId?: unknown; timeRange?: unknown };
    if (typeof clientId !== "string") throw new Error("Spotify Client ID is not configured.");
    return getTopItems(clientId, typeof timeRange === "string" ? timeRange : "short_term");
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
