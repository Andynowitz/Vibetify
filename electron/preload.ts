import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("vibetify", {
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("app:open-external", url),
  spotify: {
    begin: (clientId: string, redirectUri: string): Promise<void> => ipcRenderer.invoke("spotify:begin", { clientId, redirectUri }),
    getState: (clientId: string): Promise<SpotifyAuthState> => ipcRenderer.invoke("spotify:get-state", clientId),
    disconnect: (): Promise<void> => ipcRenderer.invoke("spotify:disconnect"),
    diagnostics: (): Promise<unknown> => ipcRenderer.invoke("spotify:diagnostics"),
    resetDiagnostics: (): Promise<unknown> => ipcRenderer.invoke("spotify:diagnostics-reset"),
    mockConfig: (): Promise<unknown> => ipcRenderer.invoke("spotify:mock-config"),
    setMockConfig: (config: unknown): Promise<unknown> => ipcRenderer.invoke("spotify:mock-config", config),
    dashboard: (clientId: string): Promise<unknown> => ipcRenderer.invoke("spotify:dashboard", clientId),
    playlists: (clientId: string, offset = 0): Promise<unknown> => ipcRenderer.invoke("spotify:playlists", { clientId, offset }),
    library: (clientId: string): Promise<unknown> => ipcRenderer.invoke("spotify:library", clientId),
    topItems: (clientId: string, timeRange: string): Promise<unknown> => ipcRenderer.invoke("spotify:top-items", { clientId, timeRange }),
    search: (clientId: string, query: string, type: string, offset = 0): Promise<unknown> => ipcRenderer.invoke("spotify:search", { clientId, query, type, offset }),
    playlist: (clientId: string, id: string): Promise<unknown> => ipcRenderer.invoke("spotify:playlist", { clientId, id }),
    track: (clientId: string, id: string): Promise<unknown> => ipcRenderer.invoke("spotify:track", { clientId, id }),
    album: (clientId: string, id: string): Promise<unknown> => ipcRenderer.invoke("spotify:album", { clientId, id }),
    artist: (clientId: string, id: string): Promise<unknown> => ipcRenderer.invoke("spotify:artist", { clientId, id }),
    savedStatus: (clientId: string, ids: string[]): Promise<boolean[]> => ipcRenderer.invoke("spotify:saved-status", { clientId, ids }),
    updateSaved: (clientId: string, ids: string[], saved: boolean): Promise<void> => ipcRenderer.invoke("spotify:update-saved", { clientId, ids, saved }),
    onComplete: (callback: (profile: SpotifyProfile) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, profile: SpotifyProfile) => callback(profile);
      ipcRenderer.on("spotify:auth-complete", listener);
      return () => ipcRenderer.removeListener("spotify:auth-complete", listener);
    },
    onError: (callback: (message: string) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, message: string) => callback(message);
      ipcRenderer.on("spotify:auth-error", listener);
      return () => ipcRenderer.removeListener("spotify:auth-error", listener);
    }
  }
});

type SpotifyProfile = { id: string; accountId?: string; displayName: string; imageUrl?: string; spotifyUrl?: string };
type SpotifyAuthState = { connected: boolean; profile?: SpotifyProfile; error?: string };
