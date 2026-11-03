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
    dashboard: (clientId: string, refresh = false): Promise<unknown> => ipcRenderer.invoke("spotify:dashboard", clientId, refresh),
    recentlyPlayed: (clientId: string, refresh = false): Promise<unknown> => ipcRenderer.invoke("spotify:recently-played", clientId, refresh),
    topArtists: (clientId: string, timeRange: string, refresh = false): Promise<unknown> => ipcRenderer.invoke("spotify:top-artists", { clientId, timeRange, refresh }),
    topTracks: (clientId: string, timeRange: string, refresh = false): Promise<unknown> => ipcRenderer.invoke("spotify:top-tracks", { clientId, timeRange, refresh }),
    playlists: (clientId: string, offset = 0, refresh = false): Promise<unknown> => ipcRenderer.invoke("spotify:playlists", { clientId, offset, refresh }),
    library: (clientId: string): Promise<unknown> => ipcRenderer.invoke("spotify:library", clientId),
    topItems: (clientId: string, timeRange: string, refresh = false): Promise<unknown> => ipcRenderer.invoke("spotify:top-items", { clientId, timeRange, refresh }),
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
  },
  ai: {
    status: (): Promise<{ provider: string; label: string; tools: string[] }> => ipcRenderer.invoke("ai:status"),
    listConversations: (): Promise<AIConversationSummary[]> => ipcRenderer.invoke("ai:list-conversations"),
    getConversation: (id: string): Promise<AIConversation | undefined> => ipcRenderer.invoke("ai:get-conversation", id),
    newConversation: (): Promise<AIConversation> => ipcRenderer.invoke("ai:new-conversation"),
    deleteConversation: (id: string): Promise<void> => ipcRenderer.invoke("ai:delete-conversation", id),
    send: (clientId: string, conversationId: string, content: string): Promise<{ conversation: AIConversation; toolActivity: string[] }> => ipcRenderer.invoke("ai:send", { clientId, conversationId, content })
  }
});

type SpotifyProfile = { id: string; accountId?: string; displayName: string; imageUrl?: string; spotifyUrl?: string };
type SpotifyAuthState = { connected: boolean; profile?: SpotifyProfile; error?: string };
type AIConversationMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: string };
type AIConversation = { id: string; title: string; createdAt: string; updatedAt: string; messages: AIConversationMessage[] };
type AIConversationSummary = Omit<AIConversation, "messages"> & { messages: [] };
