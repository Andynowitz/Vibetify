/// <reference types="vite/client" />
export {};

interface ImportMetaEnv {
  readonly VITE_SPOTIFY_CLIENT_ID?: string;
  readonly VITE_SPOTIFY_REDIRECT_URI?: string;
  readonly VITE_SPOTIFY_MOCK_MODE?: string;
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  type SpotifyProfile = {
    id: string;
    accountId?: string;
    displayName: string;
    imageUrl?: string;
    spotifyUrl?: string;
  };
  type AIConversationMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: string };
  type AIConversation = { id: string; title: string; createdAt: string; updatedAt: string; messages: AIConversationMessage[] };
  type AIConversationSummary = Omit<AIConversation, "messages"> & { messages: [] };

  interface Window {
    vibetify: {
      openExternal(url: string): Promise<void>;
      spotify: {
        begin(clientId: string, redirectUri: string): Promise<void>;
        getState(clientId: string): Promise<{ connected: boolean; profile?: SpotifyProfile; error?: string }>;
        disconnect(): Promise<void>;
        diagnostics(): Promise<unknown>;
        resetDiagnostics(): Promise<unknown>;
        mockConfig(): Promise<{ enabled: boolean; status: string; delayMs: number }>;
        setMockConfig(config: { enabled?: boolean; status?: string; delayMs?: number }): Promise<{ enabled: boolean; status: string; delayMs: number }>;
        dashboard(clientId: string, refresh?: boolean): Promise<unknown>;
        recentlyPlayed(clientId: string, refresh?: boolean): Promise<unknown>;
        topArtists(clientId: string, timeRange: string, refresh?: boolean): Promise<unknown>;
        topTracks(clientId: string, timeRange: string, refresh?: boolean): Promise<unknown>;
        playlists(clientId: string, offset?: number, refresh?: boolean): Promise<unknown>;
        library(clientId: string): Promise<unknown>;
        topItems(clientId: string, timeRange: string, refresh?: boolean): Promise<unknown>;
        search(clientId: string, query: string, type: string, offset?: number): Promise<unknown>;
        playlist(clientId: string, id: string): Promise<unknown>;
        track(clientId: string, id: string): Promise<unknown>;
        album(clientId: string, id: string): Promise<unknown>;
        artist(clientId: string, id: string): Promise<unknown>;
        savedStatus(clientId: string, ids: string[]): Promise<boolean[]>;
        updateSaved(clientId: string, ids: string[], saved: boolean): Promise<void>;
        onComplete(callback: (profile: SpotifyProfile) => void): () => void;
        onError(callback: (message: string) => void): () => void;
      };
      ai: {
        status(): Promise<{ provider: string; label: string; model?: string; available?: boolean; modelInstalled?: boolean; tools: string[] }>;
        listConversations(): Promise<AIConversationSummary[]>;
        getConversation(id: string): Promise<AIConversation | undefined>;
        newConversation(): Promise<AIConversation>;
        deleteConversation(id: string): Promise<void>;
        send(clientId: string, conversationId: string, content: string): Promise<{ conversation: AIConversation; toolActivity: string[] }>;
      };
    };
  }
}
